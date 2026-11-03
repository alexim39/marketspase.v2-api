/**
 * Public entry for the progression slice (Diamond journey ladder).
 * Levels derive from live signals + attested milestones on every read;
 * only milestones persist. Promotion flips surface via `promoted`.
 */
export { default, buildProgressionRouter } from './interface/Progression.routes.js';
export { LEVELS, LEVEL_LABELS, resolveProgression } from './domain/Progression.levels.js';
