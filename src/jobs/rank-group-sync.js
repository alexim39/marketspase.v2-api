import { RankGroupService } from '../modules/messaging/application/RankGroups.service.js';
import { MongoGroupStore } from '../modules/messaging/infrastructure/Group.mongo.repository.js';
import { MongoProgressionStore } from '../modules/progression/infrastructure/Progression.mongo.repository.js';

/**
 * Daily repair sweep for official level groups.
 *
 * Promotion events move members immediately; this sweep catches demotions,
 * missed events and any manual data correction. It is deliberately separate
 * from the event path so a queue failure can never leave stale membership.
 */
export async function runRankGroupSyncJob(deps = {}) {
  const service = deps.service ?? new RankGroupService({
    groups: deps.groups ?? new MongoGroupStore(),
    progress: deps.progress ?? new MongoProgressionStore(),
  });
  const result = await service.syncAll();
  console.log(`[jobs] rank groups: ${result.synced} synced, ${result.skipped} skipped`);
  return result;
}
