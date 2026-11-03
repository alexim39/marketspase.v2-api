import { ConflictException, ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { createRecordEntity } from '../domain/Reservation.entity.js';
import { buildProspectAccess } from '../../crm/application/Prospect.access.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { sendEmail } from '../../../services/emailService.js';

// Default prospect guard (same rule as the prospect slice): owner, upline
// (ancestor chain) or admin. Overridable via deps for tests.
const defaultRecordAccess = () => buildProspectAccess({
  findProspectById: (id) => ProspectModel.findById(id).select('partnerId').lean().catch(() => null),
  findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean().catch(() => null),
});

/**
 * POST /v1/reservations/record — record a code, routed to its credit holder.
 *
 * - No prospectId: self-record, beneficiary = session (today, untouched).
 * - prospectId: beneficiary = the prospect's OWNER (derived server-side),
 *   actor recorded separately — so an upline promoting for a downline can
 *   never silently take the credit.
 * - onBehalfOf: explicit intent, must equal the prospect's owner (400
 *   otherwise); requires a prospect (400 without one).
 * Strangers fail closed (404, never confirming the prospect exists).
 */
export class RecordReservationUseCase {
  /** @param {{reservations, access?}} deps */
  constructor({ reservations, access = null }) {
    this.reservations = reservations;
    this.access = access ?? defaultRecordAccess();
  }

  async execute({ referrerId, code, prospectId = null, onBehalfOf = null }) {
    const entity = createRecordEntity({ code, prospectId, onBehalfOf });
    let beneficiaryId = String(referrerId);
    let recordedBy = null;
    if (entity.onBehalfOf && !entity.prospectId) {
      throw new ValidationException('onBehalfOf requires a prospect');
    }
    if (entity.prospectId) {
      const { ownerId } = await this.access.requireSupport(referrerId, entity.prospectId);
      if (entity.onBehalfOf && entity.onBehalfOf !== ownerId) {
        throw new ValidationException('onBehalfOf must match the prospect owner');
      }
      beneficiaryId = entity.onBehalfOf ?? ownerId;
      if (beneficiaryId !== String(referrerId)) recordedBy = String(referrerId);
    }
    return this.reservations.record({
      ...entity, partnerId: beneficiaryId, ...(recordedBy ? { recordedBy } : {}),
    });
  }
}

/** GET /v1/reservations/mine — codes this partner recorded. */
export class ListMyReservationsUseCase {
  /** @param {{reservations}} deps */
  constructor({ reservations }) {
    this.reservations = reservations;
  }

  async execute({ referrerId, limit = 50, status = null }) {
    if (status && status !== 'All' && !REVIEW_STATUSES.includes(status)) {
      throw new ValidationException('Invalid status filter');
    }
    const items = await this.reservations.listByPartner(referrerId, limit, status);
    // Resolve "activated for" names (same pattern as the admin queue).
    const prospectIds = [...new Set(items.map((r) => r.prospectId).filter(Boolean).map(String))];
    let prospectLabels = {};
    if (prospectIds.length > 0) {
      const prospects = await ProspectModel.find({ _id: { $in: prospectIds } })
        .select('prospectName prospectSurname prospectPhone').lean().catch(() => []);
      prospectLabels = Object.fromEntries((prospects ?? []).map((p) => [String(p._id), {
        name: [p.prospectName, p.prospectSurname].filter(Boolean).join(' ') || 'Unnamed',
        phone: p.prospectPhone ?? '',
      }]));
    }
    return {
      items: items.map((r) => ({
        id: String(r.id),
        code: r.code,
        status: r.status,
        prospectId: r.prospectId ?? null,
        recordedBy: r.recordedBy ?? null,
        prospect: r.prospectId ? (prospectLabels[String(r.prospectId)] ?? { name: 'Unknown', phone: '' }) : null,
        createdAt: r.createdAt ?? null,
      })),
      total: items.length,
    };
  }
}

const REVIEW_STATUSES = ['Pending', 'Approved', 'Rejected', 'Used'];

/** GET /v1/reservations/queue — admin review of legacy Pending codes. */
export class ListReviewQueueUseCase {
  /** @param {{reservations}} deps */
  constructor({ reservations }) {
    this.reservations = reservations;
  }

  async execute({ status = 'Pending', limit = 50, skip = 0, q = '', sort = 'oldest' }) {
    if (!REVIEW_STATUSES.includes(status) && status !== 'All') {
      throw new ValidationException('Invalid status filter');
    }
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const sk = Math.max(Number(skip) || 0, 0);
    const dir = sort === 'newest' ? -1 : 1;
    const [{ items, total }, summary] = await Promise.all([
      this.reservations.listByStatus(status, lim, sk, q, dir),
      this.reservations.statusSummary().catch(() => null),
    ]);
    // NOTE: filter raw values BEFORE String() — String(null) is the
    // truthy string 'null', which poisons the $in cast and blanks EVERY
    // label via the catch fallback. That was the empty-column bug.
    // Go further: keep only 24-hex ids — legacy rows also store the
    // literal strings 'undefined'/'null' as partnerId.
    const cleanIds = (vals) => [...new Set(
      vals.filter(Boolean).map(String).filter((x) => /^[a-f0-9]{24}$/i.test(x)),
    )];
    const partnerIds = cleanIds(items.map((r) => r.partnerId));
    const prospectIds = cleanIds(items.map((r) => r.prospectId));
    const codes = [...new Set(items.map((r) => String(r.code ?? '')).filter(Boolean))];
    const [partners, prospects, consumers] = await Promise.all([
      partnerIds.length > 0
        ? PartnersModel.find({ _id: { $in: partnerIds } }).select('username name surname').lean().catch(() => [])
        : [],
      prospectIds.length > 0
        ? ProspectModel.find({ _id: { $in: prospectIds } }).select('prospectName prospectSurname prospectPhone').lean().catch(() => [])
        : [],
      // Consumer: the partner account holding this code at signup (Used codes
      // always resolve; Approved codes resolve once consumed).
      codes.length > 0
        ? PartnersModel.find({ reservationCode: { $in: codes } }).select('username name surname reservationCode').lean().catch(() => [])
        : [],
    ]);
    const partnerLabels = Object.fromEntries((partners ?? []).map((p) => [String(p._id), {
      username: p.username,
      name: [p.name, p.surname].filter(Boolean).join(' ') || p.username,
    }]));
    const prospectLabels = Object.fromEntries((prospects ?? []).map((p) => [String(p._id), {
      name: [p.prospectName, p.prospectSurname].filter(Boolean).join(' ') || 'Unnamed',
      phone: p.prospectPhone ?? '',
    }]));
    const consumerLabels = Object.fromEntries((consumers ?? []).map((p) => [String(p.reservationCode), {
      username: p.username,
      name: [p.name, p.surname].filter(Boolean).join(' ') || p.username,
    }]));
    // Upline-chain fallback: for ownerless codes held by a partner, walk
    // the holder's full ancestor chain (bounded, cycle-safe). Shown
    // qualified in the UI (nearest first — never presented as the recorder).
    const chainByHolder = {};
    {
      const holderIds = cleanIds((consumers ?? []).map((p) => p._id));
      const holderDocs = holderIds.length > 0
        ? await PartnersModel.find({ _id: { $in: holderIds } }).select('partnerOf').lean().catch(() => [])
        : [];
      const nodes = new Map();
      // Record EVERYTHING fetched (holders appear as ancestors too);
      // `visited` only stops re-expansion, so overlapping chains and
      // cycles terminate without losing labels.
      const visited = new Set();
      let frontier = cleanIds(holderDocs.map((h) => h.partnerOf));
      for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
        const docs = await PartnersModel.find({ _id: { $in: frontier } })
          .select('username name surname partnerOf').lean().catch(() => []);
        const next = [];
        for (const doc of docs) {
          const id = String(doc._id);
          if (!nodes.has(id)) nodes.set(id, doc);
          if (visited.has(id)) continue;
          visited.add(id);
          if (doc.partnerOf) next.push(String(doc.partnerOf));
        }
        frontier = cleanIds(next);
      }
      const labelOf = (n) => ({
        username: n.username,
        name: [n.name, n.surname].filter(Boolean).join(' ') || n.username,
      });
      for (const h of holderDocs) {
        const chain = [];
        const localSeen = new Set([String(h._id)]);
        let cur = h.partnerOf ? String(h.partnerOf) : null;
        while (cur && !localSeen.has(cur) && chain.length < 10) {
          localSeen.add(cur);
          const node = nodes.get(cur);
          if (!node) break;
          chain.push(labelOf(node));
          cur = node.partnerOf ? String(node.partnerOf) : null;
        }
        if (chain.length > 0) chainByHolder[String(h._id)] = chain;
      }
    }
    const holderByCode = Object.fromEntries((consumers ?? []).map((p) => [String(p.reservationCode), p]));
    return {
      items: items.map((r) => {
        // Guard the poisoning case again one level up: legacy rows store
        // the literal strings 'undefined'/'null' as partnerId.
        const rawRef = r.partnerId && !['undefined', 'null', ''].includes(String(r.partnerId))
          ? String(r.partnerId)
          : null;
        const resolved = rawRef ? partnerLabels[rawRef] : null;
        const holder = holderByCode[String(r.code)] ?? null;
        const chain = holder ? (chainByHolder[String(holder._id)] ?? []) : [];
        const [nearest, ...rest] = chain;
        // Standing admin rule: the Issuer column shows the UPLINE of the
        // For-column user, so it tallies 1:1 with the tree's parent links.
        // A dangling "Former member" placeholder never shadows a real chain.
        // The recorder (when different) rides along as `recordedBy`.
        const issuer = !chain.length
          ? (resolved ?? (rawRef
            ? { username: rawRef.slice(-6), name: 'Former member' }
            : null))
          : null;
        const recordedBy = chain.length && resolved && resolved.username !== nearest.username
          ? { username: resolved.username, name: resolved.name }
          : null;
        return {
          id: String(r.id ?? r._id),
          code: r.code,
          status: r.status,
          createdAt: r.createdAt ?? null,
          issuer,
          prospect: r.prospectId ? (prospectLabels[String(r.prospectId)] ?? { name: 'Unknown', phone: '' }) : null,
          consumer: consumerLabels[String(r.code)] ?? null,
          // Chain shows whenever uplines were found for the holder.
          // Primary = nearest upline; the rest of the chain rides along.
          issuerUpline: nearest ? {
            username: nearest.username,
            name: nearest.name,
            holderUsername: holder?.username ?? null,
            chain,
          } : null,
          recordedBy,
        };
      }),
      total,
      summary,
    };
  }
}

/**
 * DELETE — hard delete with lifecycle guards. Pending/Rejected go
 * freely; Approved only while no partner account holds the code; Used is
 * history and never deletable (409 either way). With `ownerId`, the row
 * must belong to the requester (partner self-service; 403 otherwise).
 */
export class DeleteReservationUseCase {
  /** @param {{reservations}} deps */
  constructor({ reservations }) {
    this.reservations = reservations;
  }

  async execute({ reservationId, ownerId = null }) {
    const existing = await this.reservations.findById(reservationId);
    if (!existing) throw new NotFoundException('Reservation code not found');
    if (ownerId && String(existing.partnerId) !== String(ownerId)) {
      throw new ForbiddenException('You can only delete codes you recorded');
    }
    if (existing.status === 'Used') {
      throw new ConflictException('Used codes are history and cannot be deleted');
    }
    if (existing.status === 'Approved') {
      const held = await PartnersModel.exists({ reservationCode: existing.code }).catch(() => null);
      if (held) throw new ConflictException('Code is held by a partner account and cannot be deleted');
    }
    return this.reservations.hardDelete(reservationId);
  }
}

/** PATCH /v1/reservations/:id — admin moves a code between review states. */
export class DecideReservationUseCase {
  /** @param {{reservations}} deps */
  constructor({ reservations }) {
    this.reservations = reservations;
  }

  async execute({ reservationId, status }) {
    // Used is terminal (signup history); everything else moves freely so
    // admins can re-queue (→Pending) or kill (→Rejected) any live code.
    const TRANSITIONS = {
      Pending: ['Approved', 'Rejected'],
      Approved: ['Pending', 'Rejected'],
      Rejected: ['Pending', 'Approved'],
      Used: [],
    };
    if (!Object.values(TRANSITIONS).flat().includes(status)) {
      throw new ValidationException('Invalid status');
    }
    const existing = await this.reservations.findById(reservationId);
    if (!existing) throw new NotFoundException('Reservation code not found');
    const from = existing.status;
    if (!(TRANSITIONS[from] ?? []).includes(status)) {
      throw new ConflictException(
        from === 'Used'
          ? 'Used codes are history and cannot be moved'
          : `Cannot move code from ${from} to ${status}`,
      );
    }
    const updated = await this.reservations.decide(reservationId, status, [from]);
    // Null = raced out of the expected state between the two reads.
    if (!updated) throw new ConflictException(`Code is no longer ${from}`);
    // Best-effort issuer notice — never fails the decision.
    const moveNote = status === 'Approved'
      ? { title: `Code ${updated.code} approved — ready to use`, body: 'The reservation code is now usable at signup.', subject: 'Reservation code approved' }
      : status === 'Rejected'
        ? { title: `Code ${updated.code} was not approved`, body: 'The reservation code was rejected and can no longer be used.', subject: 'Reservation code not approved' }
        : { title: `Code ${updated.code} is back under review`, body: 'The reservation code is pending admin review again.', subject: 'Reservation code under review' };
    try {
      const stored = new MongoStoredNotificationStore();
      await new NotifyUseCase({ stored }).execute({
        recipientId: String(updated.partnerId),
        category: 'team',
        priority: status === 'Rejected' ? 'high' : 'medium',
        title: moveNote.title,
        body: moveNote.body,
        icon: 'confirmation_number',
        link: '/dashboard/mentorship/partners/my-partners',
        key: `reservation:${updated.id ?? reservationId}:${status}:${Date.now()}`,
      }).catch(() => null);
      const issuer = await PartnersModel.findById(updated.partnerId).select('email').lean().catch(() => null);
      if (issuer?.email) {
        await sendEmail(
          issuer.email,
          moveNote.subject,
          `<p>Code <strong>${updated.code}</strong> was ${status.toLowerCase()}.</p>`,
        ).catch(() => null);
      }
    } catch { /* notify never fails the decision */ }
    return updated;
  }
}
