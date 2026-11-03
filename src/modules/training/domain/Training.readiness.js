import { LEVELS } from '../../progression/domain/Progression.levels.js';

/**
 * Promotion readiness — pure score over the gate to the next rank.
 * Reuses the same gate() that powers My Journey, so Academy and Journey
 * can never disagree about what is missing. Unit-testable without Mongo.
 */

export const readinessScore = (journey) => {
  if (!journey?.next) return { score: 100, label: 'Top of the ladder', done: 0, total: 0, missing: [] };
  const total = (journey.missing?.length ?? 0) + (journey.completed?.length ?? 0);
  const done = journey.completed?.length ?? 0;
  const score = total > 0 ? Math.round((done / total) * 100) : journey.percent ?? 0;
  let label = 'Ready soon';
  if (score >= 100) label = 'Ready';
  else if (score >= 75) label = 'Ready soon';
  else if (score >= 50) label = 'On track';
  else if (score >= 25) label = 'Needs focus';
  else label = 'Just started';
  return { score, label, done, total, missing: journey.missing ?? [] };
};

export const readinessLevel = (score) => {
  if (score >= 100) return 'ready';
  if (score >= 75) return 'soon';
  if (score >= 50) return 'ontrack';
  if (score >= 25) return 'focus';
  return 'start';
};
