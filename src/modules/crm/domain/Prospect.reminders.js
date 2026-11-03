import { TERMINAL_STAGES } from './Prospect.stuck.js';

const DAY = 86400000;

/** Start of the day containing `now` (local server time, like the notifier). */
export const startOfToday = (now = new Date()) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Bucket follow-up commitments from a prospect's LATEST open touch.
 * Only the newest open communication counts — logging a fresh touch
 * without a followUpDate clears the reminder (mark-done by doing).
 * Terminal stages and Closed-lost outcomes never remind.
 * Pure, unit-testable without Mongo.
 * @returns {{overdue, today, upcoming}} each entry {prospectId, name, followUpDate, daysOverdue}
 */
export const bucketFollowUps = (items = [], now = new Date()) => {
  const start = startOfToday(now).getTime();
  const out = { overdue: [], today: [], upcoming: [] };
  for (const p of items ?? []) {
    const stage = p?.status?.stage ?? null;
    if (stage && TERMINAL_STAGES.includes(stage)) continue;
    const open = (p?.communications ?? []).filter((c) => c?.status !== 'Closed');
    const last = open[open.length - 1];
    if (!last?.followUpDate) continue;
    if (last?.outcome === 'Closed-lost') continue;
    const at = new Date(last.followUpDate);
    if (Number.isNaN(at.getTime())) continue;
    const day = new Date(at);
    day.setHours(0, 0, 0, 0);
    const diffDays = Math.round((day.getTime() - start) / DAY);
    const name = [p?.prospectName, p?.prospectSurname].filter(Boolean).join(' ') || 'Prospect';
    const entry = {
      prospectId: String(p?.id ?? p?._id ?? ''),
      name,
      followUpDate: at,
      daysOverdue: diffDays < 0 ? Math.abs(diffDays) : 0,
    };
    if (diffDays < 0) out.overdue.push(entry);
    else if (diffDays === 0) out.today.push(entry);
    else out.upcoming.push(entry);
  }
  const byDate = (a, b) => new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime();
  out.overdue.sort(byDate);
  out.today.sort(byDate);
  out.upcoming.sort(byDate);
  return out;
};
