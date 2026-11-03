/**
 * Weekly review request — pure content + week keying.
 * One keyed stored notification per partner per ISO week
 * (`weekly:<week>:review`): leaders get a downline-review prompt,
 * builders a personal week-review prompt. Reruns resolve to the
 * existing row via `findByKey` + the unique (recipientId, key).
 */

/** ISO week stamp (`YYYY-Www`), server-local — matches the Monday cron. */
export const weekKey = (now = new Date()) => {
  const d = now instanceof Date ? now : new Date(now);
  d.setHours(0, 0, 0, 0);
  const mondayIndex = (d.getDay() + 6) % 7;
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - mondayIndex + 3);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const jan4Index = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Index);
  const week = Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** @param {{week, directReports}} input (leaders: anyone with downline) */
export const buildLeaderPrompt = ({ week = weekKey(), directReports = 0 } = {}) => ({
  category: 'team',
  priority: 'medium',
  title: `Weekly review: ${plural(directReports, 'person', 'people')} counting on you`,
  body: `Hold a 15-minute review with each direct report — goal, calendar, pipeline. Leadership is a pipeline too.`,
  icon: 'groups',
  link: '/dashboard/network/tree',
  key: `weekly:${week}:review`,
});

/** @param {{week, openFollowups, activeGoals, atRiskGoals}} input (builders) */
export const buildPersonalPrompt = ({
  week = weekKey(), openFollowups = 0, activeGoals = 0, atRiskGoals = 0,
} = {}) => ({
  category: 'goals',
  priority: atRiskGoals > 0 ? 'high' : 'medium',
  title: 'Your weekly review is ready',
  body: `${plural(openFollowups, 'open follow-up', 'open follow-ups')} · `
    + `${plural(activeGoals, 'active goal', 'active goals')} (${atRiskGoals} at risk). `
    + `Take 10 minutes: close one follow-up, move one goal.`,
  icon: 'fact_check',
  link: '/dashboard/goals',
  key: `weekly:${week}:review`,
});
