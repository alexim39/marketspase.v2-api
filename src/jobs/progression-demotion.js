import { domainEvents } from '../shared/events/DomainEvents.js';
import { MongoOrderReader } from '../modules/billing/infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../modules/network/infrastructure/Network.mongo.repository.js';
import { GetMyProgressionUseCase } from '../modules/progression/application/Progression.usecases.js';
import { demotionConfig, evaluateDemotion } from '../modules/progression/domain/DemotionPolicy.js';
import { LEVEL_LABELS } from '../modules/progression/domain/Progression.levels.js';
import { PROGRESSION_EVENTS, demotedPayload } from '../modules/progression/domain/ProgressionEvents.js';
import { MongoProgressionStore } from '../modules/progression/infrastructure/Progression.mongo.repository.js';

/**
 * Scheduled rank review. Promotion stays read-triggered; demotion only
 * happens here, after a grace period and repeated maintenance failures.
 */
export const runProgressionDemotionJob = async (deps = {}) => {
  const config = deps.config ?? demotionConfig();
  if (!config.enabled) return { enabled: false, reviewed: 0, demoted: 0, reset: 0, incremented: 0, skipped: 0 };

  const progress = deps.progress ?? new MongoProgressionStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const orders = deps.orders ?? new MongoOrderReader();
  const events = deps.events ?? domainEvents;
  const mine = deps.mine ?? new GetMyProgressionUseCase({ progress, network, orders });
  const now = deps.now ?? new Date();
  const candidates = await progress.listDemotionCandidates(deps.limit ?? 5000);

  let demoted = 0;
  let reset = 0;
  let incremented = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const partnerId = String(candidate.partnerId);
    const snapshot = await mine.execute({ partnerId, now, readOnly: true }).catch(() => null);
    const decision = evaluateDemotion({
      level: candidate.level,
      lastPromotionAt: candidate.lastPromotionAt,
      misses: candidate.demotionMisses,
      maintenanceOk: snapshot?.signals?.maintenanceOk === true,
      now,
      config,
    });

    if (decision.action === 'reset') {
      await progress.resetDemotionMisses(partnerId);
      reset += 1;
      continue;
    }
    if (decision.action === 'increment') {
      await progress.incrementDemotionMisses(partnerId);
      incremented += 1;
      continue;
    }
    if (decision.action !== 'demote') {
      skipped += 1;
      continue;
    }

    await progress.demoteLevel(partnerId, decision.nextLevel);
    demoted += 1;
    const node = await network.findNode(partnerId).catch(() => null);
    const memberName = node
      ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
      : null;
    await events.emit(PROGRESSION_EVENTS.DEMOTED, demotedPayload({
      partnerId,
      from: candidate.level,
      to: decision.nextLevel,
      fromLabel: LEVEL_LABELS[candidate.level] ?? candidate.level,
      toLabel: LEVEL_LABELS[decision.nextLevel] ?? decision.nextLevel,
      memberName,
      uplineId: node?.parentId ?? null,
    })).catch(() => null);
  }

  return {
    enabled: true,
    reviewed: candidates.length,
    demoted,
    reset,
    incremented,
    skipped,
  };
};
