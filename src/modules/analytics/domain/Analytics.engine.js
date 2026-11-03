/** Canonical funnel order (crm PROSPECT_STAGES minus terminal Closed). */
export const FUNNEL_ORDER = ['New', 'Contacted', 'Interested', 'In Negotiation', 'Converted'];

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * Pure funnel math — unit-testable without Mongo.
 * @param {Record<string, number>} distribution stage → count (cohort)
 * @param {number} lost prospects in Closed
 */
export const buildFunnel = (distribution = {}, lost = 0) => {
  const counts = FUNNEL_ORDER.map((stage) => distribution[stage] ?? 0);
  const entered = counts[0];
  const converted = counts[counts.length - 1];
  const steps = FUNNEL_ORDER.map((stage, i) => ({
    stage,
    count: counts[i],
    // Step rate vs previous stage; first step is the cohort baseline.
    stepRate: i === 0 ? 100 : pct(counts[i], counts[i - 1]),
    // Cumulative vs cohort entry.
    cumulativeRate: pct(counts[i], entered),
    dropoff: i === 0 ? 0 : Math.max(0, counts[i - 1] - counts[i]),
  }));
  return {
    steps,
    entered,
    converted,
    lost,
    overallRate: pct(converted, entered),
  };
};

/**
 * Pure team-health scoring — transparent weights, null-safe.
 * @param {{activationRate, goalRate, funnelRate, recruitDeltaPct}} rates (rates null when no data)
 */
export const scoreHealth = ({ activationRate, goalRate, funnelRate, recruitDeltaPct }) => {
  const parts = [
    { value: activationRate, weight: 0.4 },
    { value: goalRate, weight: 0.3 },
    { value: funnelRate !== null && funnelRate !== undefined ? funnelRate / 100 : null, weight: 0.2 },
    {
      value: recruitDeltaPct === null || recruitDeltaPct === undefined
        ? null
        : (Math.min(Math.max(recruitDeltaPct / 100, -1), 1) + 1) / 2,
      weight: 0.1,
    },
  ];
  const usable = parts.filter((p) => p.value !== null && p.value !== undefined);
  const weight = usable.reduce((s, p) => s + p.weight, 0);
  const score = weight > 0
    ? Math.round((usable.reduce((s, p) => s + p.value * p.weight, 0) / weight) * 100)
    : null;

  const recommendations = [];
  if (activationRate !== null && activationRate < 0.3) {
    recommendations.push('Less than a third of your team ordered recently — re-engage dormant members.');
  }
  if (funnelRate !== null && funnelRate < 10) {
    recommendations.push('Funnel conversion is under 10% — tighten follow-up discipline on warm prospects.');
  }
  if (goalRate !== null && goalRate < 0.5) {
    recommendations.push('Most goals are off pace — review targets or increase weekly activity.');
  }
  if (recruitDeltaPct !== null && recruitDeltaPct <= 0) {
    recommendations.push('Recruiting has stalled vs the previous period — schedule prospecting time.');
  }
  if (recommendations.length === 0 && score !== null) {
    recommendations.push(score >= 70 ? 'Strong momentum — keep the cadence.' : 'Steady — pick one lever above to push.');
  }
  return { score, recommendations };
};

const DAY = 86400000;

/** Current + previous equal windows for historical comparison. */
export const windows = (now, days) => {
  const end = new Date(now);
  const start = new Date(end.getTime() - days * DAY);
  return { start, end, prevStart: new Date(start.getTime() - days * DAY), prevEnd: start };
};

export const deltaPct = (current, previous) => {
  if (previous > 0) return Math.round(((current - previous) / previous) * 1000) / 10;
  return current > 0 ? 100 : 0;
};

/**
 * Linear team forecast — next window projected from current vs previous.
 * Simple and honest: `projected = current + (current - previous)`, floored
 * at zero. No seasonality model; the copy must say "at current pace".
 */
export const forecastNext = (current, previous) => {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  return Math.max(0, Math.round((c + (c - p)) * 100) / 100);
};
