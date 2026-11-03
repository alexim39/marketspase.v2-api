import { windows } from '../domain/Analytics.engine.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

/**
 * Nightly materialization of 30-day team metrics for every leader.
 * Bounded (leaders only, capped list); per-leader failures are collected,
 * never thrown — one bad subtree must not kill the night's run.
 */
export class BuildTeamSnapshotsUseCase {
  /** @param {{network, orders, prospects, snapshots}} deps */
  constructor({ network, orders, prospects, snapshots }) {
    Object.assign(this, { network, orders, prospects, snapshots });
  }

  async execute({ now = new Date(), leaderLimit = 2000 } = {}) {
    const { start, end, prevStart, prevEnd } = windows(now, 30);
    const leaders = await this.network.findLeaderIds(leaderLimit);
    const done = [];
    const failed = [];
    for (const partnerId of leaders) {
      try {
        const [{ ids: downline }] = [await collectDownlineIds(this.network, partnerId)];
        const [personal, team, recruits, prevRecruits, prevTeam, active, conversions] = await Promise.all([
          this.orders.volumeBetween(partnerId, start, end),
          this.orders.volumeForBetween(downline, start, end),
          this.orders.recruitsBetween(partnerId, start, end),
          this.orders.recruitsBetween(partnerId, prevStart, prevEnd),
          this.orders.volumeForBetween(downline, prevStart, prevEnd),
          this.orders.activeMemberCount(downline, start, end),
          this.prospects.countConverted(partnerId, start, end),
        ]);
        await this.snapshots.upsert(partnerId, {
          windowDays: 30,
          downlineTotal: downline.length,
          active,
          recruits,
          prevRecruits,
          teamVolume: team.total,
          prevTeamVolume: prevTeam.total,
          personalVolume: personal.total,
          personalOrders: personal.orders,
          conversions,
        });
        done.push(partnerId);
      } catch (error) {
        failed.push({ partnerId, error: error?.message ?? String(error) });
      }
    }
    return { leaders: leaders.length, done: done.length, failed };
  }
}
