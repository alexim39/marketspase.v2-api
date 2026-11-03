/**
 * Daily-brief picking — pure selection of ≤3 priorities + 1 momentum item.
 * The job builds candidates from source aggregates; this module only
 * orders, caps and slot-keys them (`daily:<day>:p1..p3|momentum`) so a
 * rerun on the same day is a no-op via the unique (recipientId, key).
 */

export const MAX_PRIORITIES = 3;

/** Server-local day stamp — matches the 06:30 cron day. */
export const dayKey = (now = new Date()) => {
  const d = now instanceof Date ? now : new Date(now);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * @param {{followups, goalNudges, trainingDue, momentum, focus, day}} input
 *   candidates are {category,priority,title,body,icon,link} (producer input shape).
 * @returns producer inputs with stable slot keys.
 */
export const pickDailyBrief = ({
  followups = [], goalNudges = [], trainingDue = [], momentum = null, focus = 'growth', day = dayKey(),
} = {}) => {
  const ordered = focus === 'leadership'
    ? [...goalNudges, ...trainingDue, ...followups]
    : [...followups, ...trainingDue, ...goalNudges];
  const items = ordered.slice(0, MAX_PRIORITIES).map((c, i) => ({ ...c, key: `daily:${day}:p${i + 1}` }));
  if (momentum) items.push({ ...momentum, key: `daily:${day}:momentum` });
  return items;
};
