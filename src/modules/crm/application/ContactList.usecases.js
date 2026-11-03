import crypto from 'node:crypto';
import { ValidationException } from '../../../shared/domain/AppError.js';
import { MIN_CONTACTS, batchSla } from '../domain/ContactList.js';
import { CONTACT_LIST_EVENTS, contactListSubmittedPayload } from '../domain/ContactListEvents.js';
import { LEVEL_LABELS } from '../../progression/domain/Progression.levels.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

/** GET /v1/prospects/contact-list/mine — working list + submitted batches. */
export class GetMyContactListUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) {
    this.prospects = prospects;
  }

  async execute({ partnerId }) {
    const [unsubmitted, batches] = await Promise.all([
      this.prospects.listUnsubmitted(partnerId),
      this.prospects.submittedBatches(partnerId),
    ]);
    const slim = (p) => ({
      id: String(p.id ?? p._id),
      prospectName: p.prospectName,
      prospectSurname: p.prospectSurname ?? '',
      prospectPhone: p.prospectPhone,
      relationship: p.relationship ?? 'Other',
      priority: p.priority ?? 'normal',
      createdAt: p.createdAt ?? null,
    });
    return {
      unsubmitted: unsubmitted.map(slim),
      unsubmittedCount: unsubmitted.length,
      minRequired: MIN_CONTACTS,
      canSubmit: unsubmitted.length >= MIN_CONTACTS,
      batches,
    };
  }
}

/** POST /v1/prospects/contact-list/submit — stamp one batch, notify upline. */
export class SubmitContactListUseCase {
  /** @param {{prospects, network?, events?}} deps */
  constructor({ prospects, network = null, events = null }) {
    Object.assign(this, { prospects, network, events });
  }

  async execute({ partnerId }) {
    const pending = await this.prospects.listUnsubmitted(partnerId);
    if (pending.length < MIN_CONTACTS) {
      throw new ValidationException(
        `Add at least ${MIN_CONTACTS} contacts before submitting (you have ${pending.length})`,
      );
    }
    const batch = `list-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const { count, submittedAt } = await this.prospects.submitContactList(partnerId, batch);
    if (this.events) {
      try {
        const node = await this.network?.findNode?.(partnerId).catch(() => null);
        await this.events.emit(
          CONTACT_LIST_EVENTS.SUBMITTED,
          contactListSubmittedPayload({
            partnerId,
            memberName: node
              ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
              : null,
            batch,
            count,
          }),
        ).catch(() => null);
      } catch { /* submit fan-out never fails the submit */ }
    }
    return { batch, count, submittedAt };
  }
}

/** GET /v1/prospects/contact-list/downline — submitted lists with progress. */
export class ListDownlineContactListsUseCase {  /** @param {{prospects, network}} deps */
  constructor({ prospects, network }) {
    Object.assign(this, { prospects, network });
  }

  async execute({ requesterId, limit = 100, now = new Date() }) {
    const { ids } = await collectDownlineIds(this.network, requesterId);
    const bounded = ids.slice(0, 2000);
    const [rows, contacts] = await Promise.all([
      this.prospects.downlineSubmittedBatches(bounded),
      this.prospects.submittedContacts(bounded, 500),
    ]);
    const capped = rows.slice(0, Math.min(Math.max(Number(limit) || 100, 1), 200));
    if (capped.length === 0) return { items: [], total: 0 };
    const byList = new Map();
    for (const c of contacts) {
      const k = `${c.partnerId}::${c.listBatch ?? 'legacy'}`;
      if (!byList.has(k)) byList.set(k, []);
      byList.get(k).push(c);
    }
    const slimContact = (c) => ({
      id: String(c.id ?? c._id),
      prospectName: c.prospectName,
      prospectSurname: c.prospectSurname ?? '',
      prospectPhone: c.prospectPhone,
      relationship: c.relationship ?? 'Other',
      priority: c.priority ?? 'normal',
      bestTimeToCall: c.bestTimeToCall ?? '',
      consentToContact: c.consentToContact === true,
      stage: c.status?.stage ?? 'New',
    });
    const withContacts = capped.map((r) => {
      const all = (byList.get(`${r.partnerId}::${r.batch}`) ?? []).map(slimContact);
      // Unworked first so the upline calls fresh numbers, then cap.
      all.sort((a, b) => Number(a.stage !== 'New') - Number(b.stage !== 'New'));
      // Derived first-touch SLA (no storage): untouched batches go overdue
      // after 48h so the workbench can surface them first.
      const sla = batchSla({ submittedAt: r.submittedAt, worked: r.worked, now });
      return { ...r, contacts: all.slice(0, 30), sla };
    });
    // Overdue first, then newest — the upline sees what needs them now.
    withContacts.sort((a, b) =>
      Number(b.sla?.overdue === true) - Number(a.sla?.overdue === true)
      || new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());
    const nodes = await this.network.findNodesByIds([...new Set(withContacts.map((r) => r.partnerId))]);
    const labels = Object.fromEntries(nodes.map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));
    return {
      items: withContacts.map((r) => ({ ...r, member: labels[r.partnerId] ?? null })),
      total: rows.length,
    };
  }
}

/**
 * GET /v1/prospects/contact-list/activation — per-member onboarding board.
 * One light row per downline member (no contact arrays, so huge downlines
 * stay cheap): IPO/QSG stamps + list totals + oldest pending age + overdue
 * + next action. Progress store is optional — missing stamps read as undone.
 */
export class ListActivationBoardUseCase {
  /** @param {{prospects, network, progress?}} deps */
  constructor({ prospects, network, progress = null }) {
    Object.assign(this, { prospects, network, progress });
  }

  async execute({ requesterId, limit = 200, now = new Date() }) {
    const { ids, depths } = await collectDownlineIds(this.network, requesterId);
    const bounded = ids.slice(0, 2000);
    if (bounded.length === 0) return { items: [], total: 0 };
    // Batch rows uncap to 5000 groups so per-member totals stay exact even
    // for huge downlines; the member rows below are what get capped.
    const [rows, nodes, training, levels] = await Promise.all([
      this.prospects.downlineSubmittedBatches(bounded, 5000),
      this.network.findNodesByIds(bounded).catch(() => []),
      this.progress?.listConfirmationStats?.(bounded, ['ipo', 'qsg']).catch(() => []) ?? [],
      this.progress?.levelsFor?.(bounded).catch(() => ({})) ?? {},
    ]);
    const byMember = new Map();
    for (const r of rows) {
      const k = String(r.partnerId);
      if (!byMember.has(k)) byMember.set(k, []);
      byMember.get(k).push(r);
    }
    const stamps = new Map();
    for (const t of training ?? []) {
      const k = String(t.partnerId ?? t.id ?? '');
      if (k) stamps.set(k, t);
    }
    const labels = Object.fromEntries((nodes ?? []).map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));
    const items = bounded.map((id) => {
      const pid = String(id);
      const batches = byMember.get(pid) ?? [];
      const total = batches.reduce((n, b) => n + (b.total ?? 0), 0);
      const worked = batches.reduce((n, b) => n + (b.worked ?? 0), 0);
      const unworked = Math.max(0, total - worked);
      const pendingDates = batches
        .filter((b) => (b.total ?? 0) - (b.worked ?? 0) > 0 && b.submittedAt)
        .map((b) => new Date(b.submittedAt).getTime())
        .filter((t) => !Number.isNaN(t));
      const oldestPendingAt = pendingDates.length > 0 ? new Date(Math.min(...pendingDates)) : null;
      const newestDates = batches
        .map((b) => b.submittedAt ? new Date(b.submittedAt).getTime() : NaN)
        .filter((t) => !Number.isNaN(t));
      const newestSubmittedAt = newestDates.length > 0 ? new Date(Math.max(...newestDates)) : null;
      const overdue = batches.some((b) => batchSla({ submittedAt: b.submittedAt, worked: b.worked, now }).overdue);
      const stamp = stamps.get(pid) ?? {};
      // Gates count confirmed training only (done + upline confirmation).
      const ipoDone = stamp.ipo?.done === true && stamp.ipo?.confirmedAt != null;
      const qsgDone = stamp.qsg?.done === true && stamp.qsg?.confirmedAt != null;
      // Ladder level (stored default) + distance from the viewing upline.
      const level = levels?.[pid] ?? 'partner';
      const depth = depths?.[pid] ?? 1;
      let nextAction = 'All worked — ask for the next batch';
      let nextTone = 'ok';
      if (!ipoDone) { nextAction = 'Complete IPO'; nextTone = 'warn'; }
      else if (!qsgDone) { nextAction = 'Complete QSG'; nextTone = 'warn'; }
      else if (total === 0) { nextAction = 'Submit contact list'; nextTone = 'warn'; }
      else if (overdue) { nextAction = `Call now — ${unworked} unworked, overdue 48h`; nextTone = 'bad'; }
      else if (unworked > 0) { nextAction = `Work list — ${unworked} of ${total} left`; nextTone = 'info'; }
      return {
        partnerId: pid,
        member: labels[pid] ?? null,
        level,
        levelLabel: LEVEL_LABELS[level] ?? 'Partner',
        depth,
        relation: depth <= 1 ? 'Direct' : `Level ${depth}`,
        ipoDone,
        qsgDone,
        lists: batches.length,
        total,
        worked,
        unworked,
        oldestPendingAt,
        newestSubmittedAt,
        overdue,
        nextAction,
        nextTone,
      };
    });
    // Overdue first, then needs-work, then no-list, then done; oldest pending first within band.
    const rank = (m) => (m.overdue ? 0 : m.unworked > 0 ? 1 : m.total === 0 ? 2 : 3);
    items.sort((a, b) =>
      rank(a) - rank(b)
      || (a.oldestPendingAt ?? a.newestSubmittedAt ?? 0) - (b.oldestPendingAt ?? b.newestSubmittedAt ?? 0));
    // Serve the most urgent slice; total stays honest so the UI can say
    // "showing X of Y" instead of silently dropping members.
    const capped = items.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 500));
    return { items: capped, total: items.length };
  }
}
