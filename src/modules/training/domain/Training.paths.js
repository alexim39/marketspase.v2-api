import { LEVELS, gate } from '../../progression/domain/Progression.levels.js';
import { COURSES } from './Training.catalog.js';

/**
 * Learning paths — four rank-based checklists.
 * Each path is the gate requirements for a rank, rendered as a checklist.
 * These are the same four ranks used across the app.
 */

const courseForMilestone = (key) => COURSES.find((c) => c.milestone === key)?.id ?? null;

const PATH_META = {
  partner: { title: 'Partner Path', tagline: 'Start strong and activate your business.' },
  builder: { title: 'Builder Path', tagline: 'Build the habit and recruit your first partner.' },
  leader: { title: 'Leader Path', tagline: 'Lead a team and run the system.' },
  ambassador: { title: 'Ambassador Path', tagline: 'Multiply leadership and scale.' },
};

/** Precomputed: for each rank, the gate reqs and their backing course. */
export const PATHS = LEVELS.map((level) => {
  const meta = PATH_META[level] ?? { title: level, tagline: '' };
  // Gates are defined for the NEXT rank (gate('builder') = reqs to BECOME Builder).
  // For the path named after a rank, we show the reqs to REACH that rank.
  const reqs = gate(level, {}, {});
  // Attach course links where a req matches a training milestone.
  const requirements = reqs.map((r) => {
    let courseId = null;
    if (['ipo', 'qsg', 'smo'].includes(r.key)) courseId = courseForMilestone(r.key);
    return { ...r, courseId };
  });
  return {
    level,
    ...meta,
    requirements,
  };
});

/**
 * Rank-aware unlock — a path unlocks when every prior rank's gate is met.
 * @param {string} level
 * @param {Record<string, unknown>} milestones
 * @param {Record<string, number>} signals minimal signals for rank checks (recruits etc.)
 */
export const isPathUnlocked = (level, milestones = {}, signals = {}) => {
  const idx = LEVELS.indexOf(level);
  if (idx <= 0) return true; // prospect + partner always open
  for (let i = 1; i <= idx; i++) {
    const reqs = gate(LEVELS[i], signals, milestones);
    if (!reqs.every((r) => r.met)) return false;
  }
  return true;
};

export const pathProgress = (level, milestones = {}, signals = {}) => {
  const reqs = gate(level, signals, milestones);
  if (reqs.length === 0) return { done: 1, total: 1, percent: 100 };
  const done = reqs.filter((r) => r.met).length;
  return { done, total: reqs.length, percent: Math.round((done / reqs.length) * 100) };
};
