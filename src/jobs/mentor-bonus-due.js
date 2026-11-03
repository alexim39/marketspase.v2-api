import { MongoCompensationRepository } from '../modules/compensation/infrastructure/Compensation.mongo.repository.js';

export async function runMentorBonusDueJob({ repo, now = new Date() } = {}) {
  const started = Date.now();
  try {
    const result = await (repo ?? new MongoCompensationRepository()).runMentorBonuses(now);
    console.log(
      `[jobs] mentor-bonus: paid ${result.paid}, forfeited ${result.forfeited}, held ${result.held}, failed ${result.failed} of ${result.checked} in ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    console.error('[jobs] mentor-bonus crashed:', error?.message ?? error);
    return { checked: 0, paid: 0, forfeited: 0, held: 0, failed: 1 };
  }
}
