import { LEVELS, LEVEL_LABELS, normalizeLevel } from './Progression.levels.js';

const int = (value, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

export const demotionConfig = (env = process.env) => ({
  enabled: String(env.PROGRESSION_DEMOTION_ENABLED ?? '1') !== '0',
  graceDays: Math.min(Math.max(int(env.DEMOTION_GRACE_DAYS, 30), 0), 365),
  cycles: Math.min(Math.max(int(env.DEMOTION_CYCLES, 2), 1), 12),
  maxSteps: Math.min(Math.max(int(env.DEMOTION_MAX_STEPS, 1), 1), 3),
});

export const nextLowerLevel = (level, steps = 1) => {
  const current = LEVELS.indexOf(normalizeLevel(level));
  const next = Math.max(current - Math.min(Math.max(steps, 1), 3), 0);
  return LEVELS[next];
};

/**
 * Pure monthly-review decision. A member must fail maintenance for N
 * consecutive reviews after a grace period before moving down one rank.
 *
 * @returns {{action:'skip'|'reset'|'increment'|'demote', reason:string, misses:number, nextLevel?:string, fromLabel?:string, toLabel?:string}}
 */
export const evaluateDemotion = ({
  level,
  lastPromotionAt = null,
  misses = 0,
  maintenanceOk = true,
  now = new Date(),
  config = demotionConfig(),
} = {}) => {
  const current = normalizeLevel(level);
  if (!config.enabled) return { action: 'skip', reason: 'disabled', misses };
  if (current === 'partner') return { action: 'skip', reason: 'floor', misses };
  if (lastPromotionAt) {
    const promotedAt = new Date(lastPromotionAt).getTime();
    if (Number.isFinite(promotedAt)
      && new Date(now).getTime() - promotedAt < config.graceDays * 24 * 60 * 60 * 1000) {
      return { action: 'skip', reason: 'grace', misses };
    }
  }
  if (maintenanceOk) return { action: 'reset', reason: 'maintenance-ok', misses: 0 };

  const nextMisses = Math.max(Number(misses) || 0, 0) + 1;
  if (nextMisses < config.cycles) {
    return { action: 'increment', reason: 'below-maintenance', misses: nextMisses };
  }
  const nextLevel = nextLowerLevel(current, config.maxSteps);
  return {
    action: 'demote',
    reason: 'sustained-below-maintenance',
    misses: nextMisses,
    nextLevel,
    fromLabel: LEVEL_LABELS[current] ?? current,
    toLabel: LEVEL_LABELS[nextLevel] ?? nextLevel,
  };
};
