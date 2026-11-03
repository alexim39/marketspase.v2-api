import {
  ConflictException, ForbiddenException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { LEVELS, LEVEL_LABELS, NOMINATION_APPROVALS_REQUIRED, RANK, STALE_CONFIRM_MS, TRAINING_CONFIRM_KEYS, TRAINING_KEY_LABELS, CONFIRMABLE_KEYS, CONFIRM_KEY_LABELS, confirmed, formatLatency, forecastJourney, medianOf, resolveProgression } from '../domain/Progression.levels.js';
import { PROGRESSION_EVENTS, promotedPayload, trainingDecidedPayload, trainingRequestedPayload, trainingTrackCompletedPayload } from '../domain/ProgressionEvents.js';
import { adminBootstrapEmails, lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

const DAY = 86400000;

/**
 * Live signals from source aggregates (never stored).
 * Bounded: downline BFS is depth- + cap-limited like everywhere else.
 * Leadership legs (`prospects`, `community`, `events`, `reports`) are
 * optional — absent deps degrade to zero (skills gate unmet, never a
 * crash), so old constructions and unit fakes keep working.
 */
export async function assembleSignals(
  partnerId,
  { network, orders, progress, prospects, community, eventStore, reports },
  now = new Date(),
) {
  const end = new Date(now);
  const start30 = new Date(end.getTime() - 30 * DAY);
  const start60 = new Date(end.getTime() - 60 * DAY);
  const start90 = new Date(end.getTime() - 90 * DAY);
  const safe = (promise, fallback) => Promise.resolve(promise).then((v) => v ?? fallback, () => fallback);
  const [{ ids: downline }] = await Promise.all([collectDownlineIds(network, partnerId)]);
  const [recruits, cur, prev, active, levels, touched, posts, rsvps, authored, decisions, pendingRows] = await Promise.all([
    network.countChildren(partnerId),
    orders.volumeBetween(partnerId, start30, end),
    orders.volumeBetween(partnerId, start60, start30),
    orders.activeMemberCount(downline, start30, end),
    progress.levelsFor(downline.slice(0, 2000)),
    safe(prospects?.countTouchedSince?.(partnerId, start30), 0),
    safe(community?.countPostsByAuthorSince?.(partnerId, start30), 0),
    safe(eventStore?.countRsvpsSince?.(partnerId, start90), 0),
    safe(reports?.listByAuthor?.(partnerId, 50), []),
    safe(progress.decisionsByApprover?.(partnerId, start90), []),
    safe(progress.listPendingConfirmations?.(downline.slice(0, 2000), CONFIRMABLE_KEYS, 200), []),
  ]);
  const counts = {};
  for (const lvl of Object.values(levels)) counts[lvl] = (counts[lvl] ?? 0) + 1;
  const reportsSubmitted = (authored ?? []).filter((r) => {
    const t = new Date(r.createdAt ?? 0).getTime();
    return !Number.isNaN(t) && t >= end.getTime() - 60 * DAY;
  }).length;
  // Responsiveness: own decision latencies plus stale backlog among direct
  // reports only (parentId match — deeper uplines own deeper members).
  const decisionLatencies = (decisions ?? [])
    .map((d) => new Date(d.confirmedAt).getTime() - new Date(d.at).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  let directStale = 0;
  if ((pendingRows ?? []).length > 0 && network?.findNodesByIds) {
    try {
      const nodes = await network.findNodesByIds(pendingRows.map((r) => r.partnerId));
      const parents = Object.fromEntries(nodes.map((nd) => [String(nd.id), nd.parentId ? String(nd.parentId) : null]));
      for (const r of pendingRows) {
        if (parents[String(r.partnerId)] !== String(partnerId)) continue;
        for (const k of CONFIRMABLE_KEYS) {
          const s = r[k];
          if (s?.done === true && !s.confirmedAt && end.getTime() - new Date(s.at ?? end).getTime() > STALE_CONFIRM_MS) {
            directStale += 1;
          }
        }
      }
    } catch { /* responsiveness degrades to observed decisions only */ }
  }
  const responsiveMedian = medianOf(decisionLatencies);
  return {
    recruits,
    activeDownline: active,
    downlineTotal: downline.length,
    maintenanceOk: cur.total > 0 && prev.total > 0,
    kingsmen: (counts.kingsman ?? 0) + (counts.ecl ?? 0) + (counts.cell_leader ?? 0) + (counts.g_leader ?? 0) + (counts.g8 ?? 0),
    ecls: (counts.ecl ?? 0) + (counts.cell_leader ?? 0) + (counts.g_leader ?? 0) + (counts.g8 ?? 0),
    kingsmenExact: counts.kingsman ?? 0,
    eclsExact: counts.ecl ?? 0,
    touchedProspects: touched,
    communityPosts: posts,
    eventRsvps: rsvps,
    reportsSubmitted,
    responsive: { medianMs: responsiveMedian, decided: decisionLatencies.length, directStale },
  };
}

const STAMPS = ['ipo', 'qsg', 'smo', 'fullTime', 'office', 'onboardingSession', 'qualifiedConfirmed', 'appointment', 'maintenance'];

const toMilestones = (doc = {}) => {
  const m = {};
  for (const k of STAMPS) if (doc[k] !== undefined) m[k] = doc[k];
  if (doc.accounts !== undefined) m.accounts = doc.accounts;
  if (doc.maintenance !== undefined && m.maintenance === undefined) m.maintenance = doc.maintenance;
  if (doc.officeAddress !== undefined) m.officeAddress = doc.officeAddress;
  if (doc.g8Request !== undefined) m.g8Request = doc.g8Request;
  if (doc.nomination !== undefined) m.nomination = doc.nomination;
  if (doc.appointedBy !== undefined) m.appointedBy = doc.appointedBy;
  return m;
};

/** Parse + validate a milestone patch (keys outside the whitelist are dropped). */
export const buildMilestonePatch = (input = {}) => {
  const patch = {};
  for (const k of STAMPS) {
    // maintenance carries evidence (ref/month) — handled in the dedicated
    // block below with dotted $sets, never a whole-object overwrite.
    if (k === 'maintenance') continue;
    if (input[k] === undefined) continue;
    const done = input[k]?.done ?? input[k];
    if (typeof done !== 'boolean') throw new ValidationException(`Invalid ${k}`);
    patch[k] = { done, at: done ? new Date() : null };
  }
  if (input.accounts !== undefined) {
    const raw = typeof input.accounts === 'object' && input.accounts !== null ? input.accounts : { count: input.accounts };
    const count = Number(raw.count ?? 0);
    if (!Number.isInteger(count) || count < 0 || count > 1000) throw new ValidationException('Invalid accounts');
    const refs = Array.isArray(raw.refs)
      ? raw.refs.map((r) => String(r ?? '').trim().slice(0, 100)).filter(Boolean).slice(0, 10)
      : [];
    const maintenanceRef = String(raw.maintenanceRef ?? '').trim().slice(0, 100);
    const maintenanceMonth = String(raw.maintenanceMonth ?? '').trim().slice(0, 7);
    if (maintenanceMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(maintenanceMonth)) throw new ValidationException('Invalid maintenance month (YYYY-MM)');
    if (count >= 1 && refs.length === 0) throw new ValidationException('At least one DTC account reference is required as evidence');
    patch['accounts.count'] = count;
    patch['accounts.refs'] = refs;
    patch['accounts.maintenanceRef'] = maintenanceRef;
    patch['accounts.maintenanceMonth'] = maintenanceMonth;
    // Submitting evidence (re)opens the confirmation — upline must verify.
    patch['accounts.done'] = count >= 1;
    patch['accounts.at'] = count >= 1 ? new Date() : null;
    patch['accounts.confirmedBy'] = null;
    patch['accounts.confirmedAt'] = null;
  }
  if (input.maintenance !== undefined) {
    const raw = typeof input.maintenance === 'object' && input.maintenance !== null ? input.maintenance : { done: input.maintenance };
    const done = raw.done ?? (raw.ref ? true : false);
    if (typeof done !== 'boolean') throw new ValidationException('Invalid maintenance');
    const ref = String(raw.ref ?? '').trim().slice(0, 100);
    const month = String(raw.month ?? '').trim().slice(0, 7);
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationException('Invalid maintenance month (YYYY-MM)');
    if (done === true && !ref) throw new ValidationException('DTC receipt / order reference is required as evidence');
    patch['maintenance.done'] = done;
    patch['maintenance.at'] = done ? new Date() : null;
    patch['maintenance.ref'] = done ? ref : '';
    patch['maintenance.month'] = done ? month : '';
    patch['maintenance.confirmedBy'] = null;
    patch['maintenance.confirmedAt'] = null;
  }
  if (input.officeAddress !== undefined) {
    const addr = String(input.officeAddress ?? '').trim().slice(0, 200);
    patch.officeAddress = addr;
  }
  // Office without an address is incomplete — the upline needs somewhere
  // to verify. Enforced here so the gate never sees a bare self-tap.
  if (patch.office?.done === true) {
    const addr = String(input.officeAddress ?? input.office?.address ?? '').trim();
    if (!addr) throw new ValidationException('Office address is required to register an office');
    patch.officeAddress = addr.slice(0, 200);
  }
  if (input.g8Request !== undefined) {
    const status = input.g8Request?.status ?? input.g8Request;
    if (!['none', 'submitted', 'approved'].includes(status)) throw new ValidationException('Invalid g8Request');
    patch['g8Request.status'] = status;
    patch['g8Request.at'] = status === 'none' ? null : new Date();
  }
  if (Object.keys(patch).length === 0) throw new ValidationException('Nothing to update');
  return patch;
};

/** My journey: derived level, next gate, promotion detection (recognition hook). */
export class GetMyProgressionUseCase {
  /** @param {{progress, network, orders, recognition, events?}} deps (recognition optional — auto-posts promotions; events optional — promotion fan-out) */
  constructor({ progress, network, orders, recognition, events = null }) {
    Object.assign(this, { progress, network, orders, recognition, events });
  }

  async execute({ partnerId, now = new Date(), readOnly = false }) {
    const doc = await this.progress.ensure(partnerId);
    const signals = await assembleSignals(partnerId, this, now);
    const resolved = resolveProgression(signals, toMilestones(doc), doc.level ?? 'partner');
    let promoted = null;
    // Read-only coaching reads (upline/admin viewing a member) never
    // mutate the ladder, post recognition, or fan out events.
    if (!readOnly && RANK(resolved.level) > RANK(doc.level ?? 'partner')) {
      const from = doc.level ?? 'partner';
      await this.progress.setLevel(partnerId, resolved.level);
      promoted = { from, to: resolved.level };
      // Community recognition — best-effort, never fails the read.
      if (this.recognition) {
        try {
          const node = await this.network.findNode(partnerId);
          const name = node
            ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
            : 'A partner';
          await this.recognition.promotion(partnerId, from, resolved.level, name);
        } catch { /* recognition is celebratory, not critical */ }
      }
      // Promotion fan-out (member + upline notified) — best-effort, never fails the read.
      if (this.events) {
        try {
          const node = await this.network?.findNode?.(partnerId).catch(() => null);
          const name = node
            ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
            : null;
          await this.events.emit(
            PROGRESSION_EVENTS.PROMOTED,
            promotedPayload({
              partnerId,
              from,
              to: resolved.level,
              toLabel: LEVEL_LABELS[resolved.level] ?? resolved.level,
              memberName: name,
              uplineId: node?.parentId ?? null,
            }),
          ).catch(() => null);
        } catch { /* fan-out is celebratory, not critical */ }
      }
    }
    // Journey forecast — 30d recruit pace, best-effort, never fails the read.
    let forecast = null;
    try {
      const end = new Date(now);
      const start30 = new Date(end.getTime() - 30 * DAY);
      const pace = typeof this.orders?.recruitsBetween === 'function'
        ? await this.orders.recruitsBetween(partnerId, start30, end).catch(() => null)
        : null;
      forecast = forecastJourney(signals, resolved.missing, pace, now);
    } catch { forecast = null; }
    return {
      level: resolved.level,
      levelLabel: LEVEL_LABELS[resolved.level],
      next: resolved.next,
      nextLabel: resolved.next ? LEVEL_LABELS[resolved.next] : null,
      percent: resolved.percent,
      completed: resolved.completed,
      missing: resolved.missing,
      remainingActions: resolved.remainingActions,
      milestones: toMilestones(doc),
      signals: { recruits: signals.recruits, activeDownline: signals.activeDownline, maintenanceOk: signals.maintenanceOk },
      promoted,
      forecast,
    };
  }

  /** Slim summary for the Action Center (no extra queries beyond GetMine). */
  async summarize({ partnerId, now = new Date() }) {
    const full = await this.execute({ partnerId, now });
    return {
      level: full.level, next: full.next, missing: full.missing.slice(0, 2),
      promoted: full.promoted, forecast: full.forecast ?? null,
    };
  }
}

export class UpdateMilestonesUseCase {
  /** @param {{progress, network?, events?}} deps (network/events optional — training auto-request hook) */
  constructor({ progress, network = null, events = null }) {
    Object.assign(this, { progress, network, events });
  }

  async execute({ partnerId, patch }) {
    const built = buildMilestonePatch(patch);
    const keys = Object.keys(built).map((k) => k.split('.')[0]);
    const before = await this.progress.findByPartner(partnerId).catch(() => null);
    const doc = await this.progress.upsertMilestones(partnerId, built, {
      at: new Date(),
      by: partnerId,
      key: keys.join(','),
    });
    // Training keys marked done through the generic path still enter
    // confirmation — otherwise the gate would sit unmet with no request
    // and no notification. Best-effort, never fails the write.
    if (this.events) {
      for (const key of CONFIRMABLE_KEYS) {
        const wasPending = before?.[key]?.done === true && !confirmed(before?.[key]);
        const justMarked = built[key]?.done === true || built[`${key}.done`] === true;
        if (justMarked && !wasPending) {
          try {
            const node = await this.network?.findNode?.(partnerId).catch(() => null);
            await this.events.emit(
              PROGRESSION_EVENTS.TRAINING_CONFIRM_REQUESTED,
              trainingRequestedPayload({
                partnerId,
                key,
                keyLabel: CONFIRM_KEY_LABELS[key] ?? TRAINING_KEY_LABELS[key] ?? key,
                memberName: node
                  ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
                  : null,
                uplineId: node?.parentId ?? null,
              }),
            ).catch(() => null);
          } catch { /* request fan-out never fails the write */ }
        }
      }
    }
    return { milestones: toMilestones(doc) };
  }
}

/** Member marks training done → pending upline confirmation (idempotent). */
export class RequestTrainingConfirmUseCase {
  /** @param {{progress, network?, events?}} deps */
  constructor({ progress, network = null, events = null }) {
    Object.assign(this, { progress, network, events });
  }

  async execute({ partnerId, key }) {
    if (!CONFIRMABLE_KEYS.includes(key)) throw new ValidationException('Invalid confirmation key');
    const before = await this.progress.findByPartner(partnerId).catch(() => null);
    const wasPending = before?.[key]?.done === true && !confirmed(before?.[key]);
    const doc = await this.progress.requestTrainingConfirm(partnerId, key);
    if (!wasPending && this.events) {
      try {
        const node = await this.network?.findNode?.(partnerId).catch(() => null);
        const stampAt = doc?.[key]?.at ? new Date(doc[key].at).getTime() : Date.now();
        await this.events.emit(
          PROGRESSION_EVENTS.TRAINING_CONFIRM_REQUESTED,
          trainingRequestedPayload({
            partnerId,
            key,
            keyLabel: CONFIRM_KEY_LABELS[key] ?? key,
            memberName: node
              ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
              : null,
            uplineId: node?.parentId ?? null,
            cycle: stampAt,
          }),
        ).catch(() => null);
      } catch { /* request fan-out never fails the write */ }
    }
    return { status: 'pending' };
  }
}

/** Upline (or admin/G8 role) decides a pending training confirmation. */
export class DecideTrainingConfirmUseCase {
  /** @param {{progress, network, events?}} deps */
  constructor({ progress, network, events = null }) {
    Object.assign(this, { progress, network, events });
  }

  async execute({ approverId, partnerId, key, approved, note = '' }) {
    if (!CONFIRMABLE_KEYS.includes(key)) throw new ValidationException('Invalid confirmation key');
    if (String(approverId) === String(partnerId)) throw new ForbiddenException('You cannot confirm your own training');
    const [memberNode, approverNode] = await Promise.all([
      this.network.findNode(partnerId),
      this.network.findNode(approverId),
    ]);
    if (!memberNode) throw new NotFoundException('Partner not found');
    if (!approverNode) throw new NotFoundException('Approver not found');
    const isDirectUpline = String(memberNode.parentId ?? '') === String(approverId);
    const approverRole = lenientRole(approverNode.role);
    if (!isDirectUpline && approverRole !== 'g8' && approverRole !== 'admin') {
      throw new ForbiddenException('Only their upline, a G8 Leader or an admin may confirm training');
    }
    const cleanNote = String(note ?? '').trim().slice(0, 500);
    if (approved !== true && !cleanNote) {
      throw new ValidationException('A reason is required when declining');
    }
    const doc = await this.progress.confirmTraining(partnerId, key, approverId, approved === true);
    if (!doc) throw new NotFoundException('No pending confirmation for this training');
    if (this.events) {
      try {
        // Approve keeps the request stamp (cycle = its `at`); decline
        // resets it, so fall back to now for the outcome key.
        const stampAt = doc?.[key]?.at ? new Date(doc[key].at).getTime() : Date.now();
        await this.events.emit(
          PROGRESSION_EVENTS.TRAINING_CONFIRM_DECIDED,
          trainingDecidedPayload({
            partnerId,
            key,
            keyLabel: CONFIRM_KEY_LABELS[key] ?? key,
            approved: approved === true,
            note: cleanNote,
            memberName: [memberNode.name, memberNode.surname].filter(Boolean).join(' ') || memberNode.username,
            cycle: stampAt,
          }),
        ).catch(() => null);
        // Full track now confirmed → celebrate once (member + upline).
        if (approved === true && TRAINING_CONFIRM_KEYS.every((k) => confirmed(doc[k]))) {          await this.events.emit(
            PROGRESSION_EVENTS.TRAINING_TRACK_COMPLETED,
            trainingTrackCompletedPayload({
              partnerId,
              memberName: [memberNode.name, memberNode.surname].filter(Boolean).join(' ') || memberNode.username,
            }),
          ).catch(() => null);
        }
      } catch { /* outcome fan-out never fails the decision */ }
    }
    return { status: approved === true ? 'confirmed' : 'declined' };
  }
}

/** Pending training confirmations across the requester's bounded downline. */
export class ListPendingConfirmationsUseCase {
  /** @param {{progress, network}} deps */
  constructor({ progress, network }) {
    Object.assign(this, { progress, network });
  }

  async execute({ requesterId, limit = 100 }) {
    const { ids } = await collectDownlineIds(this.network, requesterId);
    const rows = await this.progress.listPendingConfirmations(ids.slice(0, 2000), CONFIRMABLE_KEYS, limit);
    if (rows.length === 0) return { items: [], total: 0 };
    const nodes = await this.network.findNodesByIds(rows.map((r) => r.partnerId));
    const labels = Object.fromEntries(nodes.map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));
    const pendingKeysOf = (r) => CONFIRMABLE_KEYS
      .filter((k) => r[k]?.done === true && !confirmed(r[k]))
      .map((k) => ({ key: k, label: CONFIRM_KEY_LABELS[k] ?? k, requestedAt: r[k]?.at ?? r.updatedAt ?? null }));
    return {
      items: rows.map((r) => ({
        partnerId: String(r.partnerId),
        level: r.level ?? null,
        pending: pendingKeysOf(r),
        member: labels[String(r.partnerId)] ?? null,
      })),
      total: rows.length,
    };
  }
}

/**
 * Confirmation responsiveness: median time-to-decision plus pending/stale
 * counts across the requester's bounded downline, with per-member rows
 * and per-decider medians (grouped by who confirmed). Read-only rollup
 * over existing stamps — no new instrumentation. Pending backlog always
 * ships beside the median so cherry-picked approvals can't hide.
 */
export class GetConfirmationStatsUseCase {
  /** @param {{progress, network}} deps */
  constructor({ progress, network }) {
    Object.assign(this, { progress, network });
  }

  async execute({ requesterId, now = new Date() }) {
    const t = new Date(now).getTime();
    const { ids } = await collectDownlineIds(this.network, requesterId);
    const rows = await this.progress.listConfirmationStats(ids.slice(0, 2000), CONFIRMABLE_KEYS);
    const labelIds = new Set();
    for (const r of rows) {
      labelIds.add(String(r.partnerId));
      for (const k of TRAINING_CONFIRM_KEYS) {
        if (r[k]?.confirmedBy) labelIds.add(String(r[k].confirmedBy));
      }
    }
    const nodes = labelIds.size > 0
      ? await this.network.findNodesByIds([...labelIds])
      : [];
    const labels = Object.fromEntries(nodes.map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));

    const allLatencies = [];
    const byDecider = {};
    let pending = 0;
    let stale = 0;
    const perMember = rows.map((r) => {
      const pid = String(r.partnerId);
      const memberLatencies = [];
      let mPending = 0;
      let mStale = 0;
      for (const k of TRAINING_CONFIRM_KEYS) {
        const s = r[k];
        if (!s?.done) continue;
        if (s.confirmedAt && s.at) {
          const ms = new Date(s.confirmedAt).getTime() - new Date(s.at).getTime();
          if (ms >= 0) {
            memberLatencies.push(ms);
            allLatencies.push(ms);
            const by = String(s.confirmedBy ?? '');
            if (by) (byDecider[by] ??= []).push(ms);
          }
        } else if (!s.confirmedAt) {
          mPending += 1;
          pending += 1;
          if (t - new Date(s.at ?? t).getTime() > STALE_CONFIRM_MS) {
            mStale += 1;
            stale += 1;
          }
        }
      }
      return {
        partnerId: pid,
        level: r.level ?? null,
        member: labels[pid] ?? null,
        resolved: memberLatencies.length,
        pending: mPending,
        stale: mStale,
        medianMs: medianOf(memberLatencies),
        medianDisplay: formatLatency(medianOf(memberLatencies)),
      };
    });
    const perDecider = Object.entries(byDecider).map(([uplineId, latencies]) => ({
      uplineId,
      member: labels[uplineId] ?? null,
      resolved: latencies.length,
      medianMs: medianOf(latencies),
      medianDisplay: formatLatency(medianOf(latencies)),
    })).sort((a, b) => b.resolved - a.resolved);
    const medianMs = medianOf(allLatencies);
    return {
      overall: {
        medianMs,
        medianDisplay: formatLatency(medianMs),
        resolved: allLatencies.length,
        pending,
        stale,
      },
      perMember,
      perDecider,
    };
  }
}

/** Member requests G8 nomination (cell leaders and above). */
export class RequestNominationUseCase {
  /** @param {{progress, network, orders, mine}} deps */
  constructor({ progress, network, orders, mine }) {
    Object.assign(this, { progress, network, orders, mine });
  }

  async execute({ partnerId, note = '' }) {
    const journey = await this.mine.execute({ partnerId });
    if (RANK(journey.level) < RANK('cell_leader')) {
      throw new ForbiddenException('G nomination opens at Cell Leader');
    }
    const doc = await this.progress.findByPartner(partnerId);
    if (doc?.nomination?.status === 'pending') throw new ConflictException('Nomination already pending');
    if (doc?.nomination?.status === 'approved') throw new ConflictException('Nomination already approved');
    await this.progress.requestNomination(partnerId, String(note ?? '').slice(0, 500));
    return { status: 'pending' };
  }
}

/**
 * Only the G8 role (or admin) may decide nominations — never their own,
 * never twice. Approvals accumulate per approver; `approved` flips at the
 * counted threshold. Authority is role-based, not ladder-based: only an
 * admin-bestowed role can approve.
 */
export class DecideNominationUseCase {
  /** @param {{progress, network, orders, mine}} deps (`mine` kept for signature stability) */
  constructor({ progress, network, orders, mine }) {
    Object.assign(this, { progress, network, orders, mine });
  }

  async execute({ approverId, partnerId, approved }) {
    if (String(approverId) === String(partnerId)) throw new ForbiddenException('You cannot decide your own nomination');
    const node = await this.network.findNode(approverId);
    if (!node) throw new NotFoundException('Approver not found');
    const role = lenientRole(node.role);
    if (role !== 'g8' && role !== 'admin') {
      throw new ForbiddenException('Only a G8 Leader or admin may decide nominations');
    }
    if (approved === true) {
      const result = await this.progress.approveNomination(partnerId, approverId, NOMINATION_APPROVALS_REQUIRED);
      if (!result) throw new NotFoundException('No pending nomination');
      if (result.duplicate) throw new ConflictException('You have already approved this nomination');
      const approvals = result.doc.nomination?.approvals?.length ?? 0;
      return { status: result.doc.nomination.status, approvals, required: NOMINATION_APPROVALS_REQUIRED };
    }
    const doc = await this.progress.rejectNomination(partnerId, approverId);
    if (!doc) throw new NotFoundException('No pending nomination');
    return { status: doc.nomination.status, approvals: 0, required: NOMINATION_APPROVALS_REQUIRED };
  }
}

/** Pending G-nominations in the requester's downline, with member labels. */
export class ListPendingNominationsUseCase {
  /** @param {{progress, network}} deps */
  constructor({ progress, network }) {
    Object.assign(this, { progress, network });
  }

  async execute({ requesterId, limit = 100, scopeAll = false }) {
    const rows = scopeAll
      ? await this.progress.listPendingNominations(null, limit)
      : await (async () => {
        const { ids } = await collectDownlineIds(this.network, requesterId);
        return this.progress.listPendingNominations(ids.slice(0, 2000), limit);
      })();
    if (rows.length === 0) return { items: [], total: 0 };
    const nodes = await this.network.findNodesByIds(rows.map((r) => r.partnerId));
    const labels = Object.fromEntries(nodes.map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));
    return {
      items: rows.map((r) => ({
        partnerId: String(r.partnerId),
        level: r.level ?? null,
        note: r.nomination?.note ?? '',
        requestedAt: r.nomination?.at ?? r.updatedAt ?? null,
        approvals: (r.nomination?.approvals ?? []).length,
        required: NOMINATION_APPROVALS_REQUIRED,
        member: labels[String(r.partnerId)] ?? null,
      })),
      total: rows.length,
    };
  }
}

/**
 * G8 oversight rollup: distribution + leaders + pending nominations.
 * Gated to ladder-g8 members, the admin-bestowed G8 role, and admins
 * (with bootstrap-email parity, mirroring requireRole) — else 403.
 */
export class GetOversightUseCase {
  /** @param {{mine, partners, distribution, pending}} deps (composed use cases) */
  constructor({ mine, partners, distribution, pending }) {
    Object.assign(this, { mine, partners, distribution, pending });
  }

  async execute({ requesterId }) {
    const [me, adminDoc] = await Promise.all([
      this.mine.execute({ partnerId: requesterId }),
      this.partners.findById(requesterId),
    ]);
    const role = lenientRole(adminDoc?.role);
    const isAdmin = role === 'admin'
      || adminBootstrapEmails().includes(String(adminDoc?.email ?? '').toLowerCase());
    const isG8 = role === 'g8';
    if (me.level !== 'g8' && !isAdmin && !isG8) {
      throw new ForbiddenException('Oversight is available to G8 Leaders and admins');
    }
    const [dist, nominations] = await Promise.all([
      this.distribution.execute({ partnerId: requesterId }),
      this.pending.execute({ requesterId, scopeAll: isAdmin }),
    ]);
    return {
      level: me.level,
      isAdmin,
      isG8,
      total: dist.total,
      capped: dist.capped,
      distribution: dist.distribution,
      leaders: dist.leaders,
      pendingNominations: nominations.items,
      pendingCount: nominations.total,
    };
  }
}

/** Leadership pipeline: stored levels across the bounded downline. */
export class TeamDistributionUseCase {
  /** @param {{progress, network}} deps */
  constructor({ progress, network }) {
    Object.assign(this, { progress, network });
  }

  async execute({ partnerId }) {
    const { ids } = await collectDownlineIds(this.network, partnerId);
    const bounded = ids.slice(0, 2000);
    const levels = await this.progress.levelsFor(bounded);
    const dist = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    const byId = levels ?? {};
    let counted = 0;
    for (const id of bounded) {
      const lvl = byId[String(id)];
      if (lvl !== undefined) {
        counted += 1;
        if (lvl in dist) dist[lvl] += 1;
        else dist.partner += 1;
      }
    }
    // Members with no progression row yet are brand-new Partners (the
    // stored default) — previously they vanished while `total` counted
    // them, so the bars never summed to the headline.
    dist.partner += bounded.length - counted;
    dist.prospect = 0;
    return {
      total: bounded.length,
      capped: ids.length > bounded.length,
      distribution: dist,
      leaders: (dist.ecl ?? 0) + (dist.cell_leader ?? 0) + (dist.g_leader ?? 0) + (dist.g8 ?? 0),
    };
  }
}
