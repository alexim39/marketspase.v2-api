/**
 * Dashboard aggregation: one request powers the majority of widgets.
 * Pure composition over slice use cases — no queries of its own, no
 * caching. If volumes ever demand materialized summaries, memoize here:
 * callers (one route, one frontend service) stay untouched.
 */
import { ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';
import { isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';

/**
 * Upline-scoped reads: a leader may view a downline partner's overview
 * (any depth); everyone else sees only their own. Testable without HTTP.
 */
export async function resolveOverviewTarget({ requesterId, forId, network }) {
  if (!forId || String(forId) === String(requesterId)) return String(requesterId);
  const node = await network.findNode(forId);
  if (!node) throw new NotFoundException('Partner not found');
  if (!(await isAncestor(network, requesterId, forId))) {
    throw new ForbiddenException('You can only view your own downline');
  }
  return String(forId);
}
export class GetOverviewUseCase {
  /** @param {{actions, funnel, team, goals, feed}} deps (composed use cases) */
  constructor({ actions, funnel, team, goals, feed }) {
    Object.assign(this, { actions, funnel, team, goals, feed });
  }

  async execute({ partnerId, days = 30, now = new Date() }) {
    const [actionCenter, funnel, team, goals, notifications] = await Promise.all([
      this.actions.execute({ partnerId, now }),
      this.funnel.execute({ partnerId, days, now }),
      this.team.execute({ partnerId, days, now }),
      this.goals.execute({ partnerId, now }),
      this.feed.execute({ partnerId, now, limit: 5 }),
    ]);
    const behind = goals.filter((g) => !g.progress.complete && !g.progress.onTrack).length;
    return {
      actions: actionCenter,
      funnel,
      team,
      goals: {
        items: goals,
        total: goals.length,
        complete: goals.filter((g) => g.progress.complete).length,
        behind,
      },
      notifications: {
        unreadCount: notifications.unreadCount,
        recent: notifications.items.slice(0, 5),
      },
    };
  }
}
