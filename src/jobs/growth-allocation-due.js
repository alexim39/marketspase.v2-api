import { AllocatePartnersUseCase } from '../modules/campaigns/application/Campaign.usecases.js';
import { MongoCampaignRepository } from '../modules/campaigns/infrastructure/Campaign.mongo.repository.js';
import { JobRunModel, withJobHealth } from './job-health.js';

/**
 * Growth campaign partner allocation sweep.
 *
 * The legacy `allocation-due` job allocates shared-pool leads to the old
 * `CampaignModel`. This job is the one that places activated partners into
 * new Growth Campaigns (`GrowthCampaignModel`) automatically, so campaign
 * owners do not need an admin to press "Run allocation".
 */

let running = false;

export const buildGrowthAllocationDueJob = (deps = {}) => ({
  allocate: deps.allocate ?? new AllocatePartnersUseCase({
    repo: deps.repo ?? new MongoCampaignRepository(),
  }),
  runs: deps.runs ?? JobRunModel,
  limit: deps.limit ?? 50,
});

export async function runGrowthAllocationDueJob(deps = {}) {
  if (running) return { allocated: [], skipped: true, reason: 'already-running' };
  running = true;
  const started = Date.now();
  try {
    const { allocate, runs, limit } = buildGrowthAllocationDueJob(deps);
    const result = await withJobHealth(runs, 'growth-campaign-allocation', () =>
      allocate.execute({ campaignId: null, limit }),
    );
    const count = result?.allocated?.length ?? 0;
    if (count > 0) {
      console.log(`[jobs] growth-allocation: ${count} partner${count === 1 ? '' : 's'} placed in ${Date.now() - started}ms`);
    }
    return result;
  } catch (error) {
    console.error('[jobs] growth-allocation crashed:', error?.message ?? error);
    return { allocated: [], skipped: false, error: error?.message ?? String(error) };
  } finally {
    running = false;
  }
}
