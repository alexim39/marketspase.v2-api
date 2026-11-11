import { LEVELS, gate } from '../../progression/domain/Progression.levels.js';

/**
 * Learning paths — four rank-based checklists.
 * Each path is the gate requirements for a rank, rendered as a checklist.
 * Course links are resolved from the current published dynamic catalogue.
 */

const PATH_META = {
  partner: { title: 'Partner Path', tagline: 'Start strong and activate your business.' },
  builder: { title: 'Builder Path', tagline: 'Build the habit and recruit your first partner.' },
  leader: { title: 'Leader Path', tagline: 'Lead a team and run the system.' },
  ambassador: { title: 'Ambassador Path', tagline: 'Multiply leadership and scale.' },
};

const MILESTONE_KEYS = ['ipo', 'qsg', 'smo', 'leadership'];

/**
 * Build paths with course links. `courseByMilestone` maps the milestone key to
 * the published course that currently represents it.
 */
export const buildPaths = (courseByMilestone = {}) => LEVELS.map((level) => {
  const meta = PATH_META[level] ?? { title: level, tagline: '' };
  // Gates are defined for the NEXT rank (gate('builder') = reqs to BECOME Builder).
  // For the path named after a rank, we show the reqs to REACH that rank.
  const reqs = gate(level, {}, {});
  const requirements = reqs.map((requirement) => {
    let courseId = null;
    let courseTitle = null;
    if (MILESTONE_KEYS.includes(requirement.key)) {
      const course = courseByMilestone[requirement.key] ?? null;
      courseId = course?.id ?? null;
      courseTitle = course?.title ?? null;
    }
    return { ...requirement, courseId, courseTitle };
  });
  return {
    level,
    ...meta,
    requirements,
  };
});

/**
 * Rank-aware unlock — a path unlocks when every prior rank's gate is met.
 */
export const isPathUnlocked = (level, milestones = {}, signals = {}) => {
  const idx = LEVELS.indexOf(level);
  if (idx <= 0) return true; // prospect + partner always open
  for (let i = 1; i <= idx; i += 1) {
    const reqs = gate(LEVELS[i], signals, milestones);
    if (!reqs.every((requirement) => requirement.met)) return false;
  }
  return true;
};

export const pathProgress = (level, milestones = {}, signals = {}) => {
  const reqs = gate(level, signals, milestones);
  if (reqs.length === 0) return { done: 1, total: 1, percent: 100 };
  const done = reqs.filter((requirement) => requirement.met).length;
  return { done, total: reqs.length, percent: Math.round((done / reqs.length) * 100) };
};
