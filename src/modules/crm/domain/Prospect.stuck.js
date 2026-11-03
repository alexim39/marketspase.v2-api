/**
 * Stuck-in-pipeline analysis — pure, unit-testable without Mongo.
 *
 * A prospect is stuck when it sits in a non-terminal stage longer than
 * that stage's attention threshold. Entry time comes from
 * `status.stageEnteredAt` (stamped on every stage advance); documents
 * that predate the stamp fall back to `updatedAt`, then `createdAt`.
 */

/** Days per stage before the prospect counts as stuck. */
export const STAGE_THRESHOLDS = {
  New: 3,
  Contacted: 7,
  Interested: 7,
  'In Negotiation': 14,
};

export const TERMINAL_STAGES = ['Converted', 'Closed'];

const DAY = 86400000;

export const stageOf = (prospect) => prospect?.status?.stage ?? 'New';

export const stageSince = (prospect) => {
  const raw = prospect?.status?.stageEnteredAt ?? prospect?.updatedAt ?? prospect?.createdAt;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * @param {Array<object>} prospects domain prospects (any source)
 * @param {{now?: Date, days?: number}} opts `days` overrides every stage limit
 * @returns {Array<{prospectId,name,stage,daysInStage,limit,overBy}>} worst first
 */
export const stuckAnalysis = (prospects, { now = new Date(), days } = {}) => {
  const t = new Date(now).getTime();
  const out = [];
  for (const p of prospects ?? []) {
    const stage = stageOf(p);
    if (TERMINAL_STAGES.includes(stage)) continue;
    const since = stageSince(p);
    if (!since) continue;
    const daysInStage = Math.floor((t - since.getTime()) / DAY);
    const limit = days !== undefined ? days : (STAGE_THRESHOLDS[stage] ?? 7);
    const overBy = daysInStage - limit;
    if (overBy <= 0) continue;
    out.push({
      prospectId: String(p.id ?? p._id),
      name: [p.prospectName, p.prospectSurname].filter(Boolean).join(' ').trim() || 'Unnamed',
      stage,
      daysInStage,
      limit,
      overBy,
    });
  }
  out.sort((a, b) => b.overBy - a.overBy || b.daysInStage - a.daysInStage);
  return out;
};
