import { ValidationException } from '../../../shared/domain/AppError.js';

export const GOAL_KINDS = ['sales', 'recruitment', 'team_volume', 'conversion'];
export const GOAL_KIND_LABELS = {
  sales: 'Personal sales',
  recruitment: 'Recruitment',
  team_volume: 'Team volume',
  conversion: 'Conversions',
};

/** @param {unknown} value */
export const assertGoalKind = (value) => {
  if (!GOAL_KINDS.includes(value)) {
    throw new ValidationException(`Invalid goal kind (expected one of: ${GOAL_KINDS.join(', ')})`);
  }
  return value;
};

const asDate = (value, field) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationException(`Invalid ${field}`);
  return d;
};

/**
 * @param {{title,kind,target,startDate,endDate,status,closedAt}} input (Zod-whitelisted)
 */
export const createGoalEntity = (input) => {
  const target = Number(input.target);
  if (!Number.isFinite(target) || target <= 0) throw new ValidationException('Target must be a positive number');
  const startDate = asDate(input.startDate, 'startDate');
  const endDate = asDate(input.endDate, 'endDate');
  if (endDate <= startDate) throw new ValidationException('End date must be after start date');
  const status = input.status === 'closed' ? 'closed' : 'active';
  return {
    title: String(input.title ?? '').trim().slice(0, 120) || GOAL_KIND_LABELS[input.kind] || 'Goal',
    kind: assertGoalKind(input.kind),
    target,
    startDate,
    endDate,
    status,
    closedAt: status === 'closed'
      ? (input.closedAt !== undefined && input.closedAt !== null ? asDate(input.closedAt, 'closedAt') : new Date())
      : null,
  };
};

/**
 * Pure forecast math — pace extrapolation from live numerator + elapsed time.
 * No history snapshots needed: dailyRate = current / elapsedDays.
 * @returns {{dailyRate,projected,willHit,etaDate,requiredDaily,shortfall}}
 */
export const forecastProgress = (current, target, startDate, endDate, now = new Date()) => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const t = new Date(now).getTime();
  const elapsedDays = Math.max(0, (Math.min(t, end) - start) / 86400000);
  const daysLeft = Math.max(0, Math.ceil((end - t) / 86400000));
  const needed = Math.max(0, target - current);
  const dailyRate = elapsedDays > 0 ? current / elapsedDays : 0;
  const projected = current + dailyRate * daysLeft;
  const willHit = projected >= target;
  return {
    dailyRate: r2(dailyRate),
    projected: r2(projected),
    willHit,
    // When this pace reaches target (null when stalled or already there).
    etaDate: dailyRate > 0 && needed > 0 ? new Date(t + (needed / dailyRate) * 86400000).toISOString() : null,
    // Pace required from today to still hit target (null when no time left).
    requiredDaily: daysLeft > 0 ? r2(needed / daysLeft) : null,
    shortfall: r2(Math.max(0, target - projected)),
  };
};

/**
 * Pure progress math — unit-testable without Mongo.
 * @returns {{current,percent,remaining,daysLeft,daysTotal,onTrack,complete,forecast}}
 */
export const computeProgress = (current, target, startDate, endDate, now = new Date()) => {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const t = Math.min(Math.max(new Date(now).getTime(), start), end);
  const daysTotal = Math.max(1, Math.ceil((end - start) / 86400000));
  const elapsed = Math.max(0, t - start);
  const expected = target * (elapsed / (end - start || 1));
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : 0;
  return {
    current,
    percent,
    remaining: Math.max(0, Math.round((target - current) * 100) / 100),
    daysLeft: Math.max(0, Math.ceil((end - new Date(now).getTime()) / 86400000)),
    daysTotal,
    onTrack: current >= expected,
    complete: current >= target,
    forecast: forecastProgress(current, target, startDate, endDate, now),
  };
};
