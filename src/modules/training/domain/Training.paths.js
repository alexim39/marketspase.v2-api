import { LEVELS, gate } from '../../progression/domain/Progression.levels.js';
import { COURSES } from './Training.catalog.js';

/**
 * Learning Paths — the 10 rank journeys.
 * Each path is the gate requirements for a rank, rendered as a checklist.
 * Derived from the same gate() that powers My Journey, so the checklists
 * never diverge. Pure, unit-testable.
 */

const courseForMilestone = (key) => COURSES.find((c) => c.milestone === key)?.id ?? null;

const PATH_META = {
  prospect: { title: 'Prospect Path', tagline: 'Discover Diamond Project.' },
  partner: { title: 'Partner Path', tagline: 'Your first steps as a partner.' },
  emerging_active: { title: 'Emerging Active Partner Path', tagline: 'Build the habit of activity.' },
  qualified_active: { title: 'Qualified Active Partner Path', tagline: 'Prove you can recruit.' },
  active: { title: 'Active Partner Path', tagline: 'Full commitment, qualified account.' },
  kingsman: { title: 'Kingsman Path', tagline: 'Lead by doing — team and system.' },
  ecl: { title: 'Emerging Cell Leader Path', tagline: 'Begin leading leaders.' },
  cell_leader: { title: 'Cell Leader Path', tagline: 'Run your cell.' },
  g_leader: { title: 'G Leader Path', tagline: 'Multiply leadership.' },
  g8: { title: 'G8 Leader Path', tagline: 'Shape the organization.' },
};

/** Precomputed: for each rank, the gate reqs and their backing course. */
export const PATHS = LEVELS.map((level) => {
  const meta = PATH_META[level] ?? { title: level, tagline: '' };
  // Gates are defined for the NEXT rank (gate('emerging_active') = reqs to BECOME emerging_active).
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
