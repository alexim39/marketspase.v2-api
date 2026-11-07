import { MongoCompensationRepository } from '../modules/compensation/infrastructure/Compensation.mongo.repository.js';

export async function runCompensationReconcileJob({ repo, now = new Date() } = {}) {
  const started = Date.now();
  try {
    const result = await (repo ?? new MongoCompensationRepository()).reconcileCompensation(now);
    console.log(
      `[jobs] compensation-reconcile: sales +${result.salesCreated}, allocations +${result.allocationsAccrued}, mentors +${result.mentorsAttached}, auto-released ${result.autoReleased ?? 0}, failed ${result.failed} in ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    console.error('[jobs] compensation-reconcile crashed:', error?.message ?? error);
    return { salesCreated: 0, allocationsAccrued: 0, mentorsAttached: 0, autoReleased: 0, failed: 1 };
  }
}
