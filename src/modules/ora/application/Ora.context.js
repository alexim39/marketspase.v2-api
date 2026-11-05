import { RANKS, rankDepth } from '../../compensation/domain/Compensation.plan.js';
import { buildProspectNotifications } from '../../crm/domain/Prospect.notifications.js';

/**
 * Ora context assembler — one bounded live snapshot per chat call.
 * Every source is best-effort: a failing slice degrades to an empty
 * section, never to a failed chat. Budgets are hard (token/cost control):
 * 200 prospects scanned, 5 names/events/goals max in the prompt.
 */

const PROSPECT_SCAN_LIMIT = 200;
const MAX_NAMES = 5;
const MAX_EVENTS = 5;
const MAX_GOALS = 4;

const asDate = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtDay = (v) => {
  const d = asDate(v);
  return d ? d.toISOString().slice(0, 10) : 'soon';
};

export class OraContextAssembler {
  /** @param {{goals, prospects, events, notifications, partners}} deps */
  constructor(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * @param {{partnerId, now}} input
   * @returns bounded snapshot for the persona prompt (never throws).
   */
  async assemble({ partnerId, now = new Date() } = {}) {
    const ctx = {
      displayName: 'there',
      commissionRank: 'Partner',
      commissionDepth: 1,
      placed: null,
      level: 'Partner',
      levelLabel: 'Partner',
      next: 'Builder',
      nextLabel: 'Builder',
      percent: 0,
      missing: [],
      nextActions: [],
      prospects: { total: 0, overdue: [], hot: [] },
      goals: [],
      events: [],
      unread: 0,
    };
    const [prospects, goals, events, unread, partner] = await Promise.all([
      this.prospects?.findByPartnerId(partnerId, { limit: PROSPECT_SCAN_LIMIT, skip: 0 }).catch(() => null),
      this.goals?.execute({ partnerId, now }).catch(() => []),
      this.events?.execute({ viewerId: partnerId, limit: MAX_EVENTS }).catch(() => null),
      this.notifications?.unreadCount(partnerId).catch(() => 0),
      this.partners?.findById(partnerId).catch(() => null),
    ]);

    if (partner) {
      const rank = RANKS.includes(partner.commissionRank) ? partner.commissionRank : 'Partner';
      const index = RANKS.indexOf(rank);
      ctx.commissionRank = rank;
      ctx.commissionDepth = rankDepth(rank);
      ctx.placed = !!partner.placementParentId;
      ctx.level = rank;
      ctx.levelLabel = rank;
      ctx.next = RANKS[index + 1] ?? null;
      ctx.nextLabel = ctx.next;
      const full = [partner.name, partner.surname].filter(Boolean).join(' ').trim();
      ctx.displayName = full || partner.username || 'there';
    }
    const list = prospects?.items ?? [];
    if (list.length > 0) {
      const byId = new Map(list.map((p) => [String(p.id ?? p._id), p]));
      const nameOf = (id) => {
        const p = byId.get(String(id));
        const full = p ? `${p.prospectName ?? ''} ${p.prospectSurname ?? ''}`.trim() : '';
        return full || 'a prospect';
      };
      const notes = buildProspectNotifications(list, now);
      ctx.prospects = {
        total: prospects?.total ?? list.length,
        overdue: [...new Set(
          notes.filter((x) => x.urgency === true).map((x) => nameOf(x.prospectId)),
        )].slice(0, MAX_NAMES),
        hot: [...new Set(
          notes.filter((x) => x.tag === 'Hot Lead').map((x) => nameOf(x.prospectId)),
        )].slice(0, MAX_NAMES),
      };
    }
    ctx.goals = (goals ?? [])
      .filter((g) => g?.progress && !g.progress.complete)
      .slice(0, MAX_GOALS)
      .map((g) => ({
        title: String(g.title ?? g.kind ?? 'Goal').slice(0, 60),
        percent: g.progress.percent ?? 0,
        onTrack: g.progress.onTrack !== false,
        daysLeft: g.progress.daysLeft ?? 0,
      }));
    ctx.events = ((events?.items ?? []).slice(0, MAX_EVENTS)).map((e) => ({
      title: String(e.title ?? 'Community event').slice(0, 80),
      startsAt: fmtDay(e.startsAt),
      location: String(e.location ?? '').slice(0, 60) || null,
    }));
    ctx.unread = Number(unread) || 0;
    return ctx;
  }
}
