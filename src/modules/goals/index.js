/**
 * Public entry for the goals slice (target definitions + live progress).
 * Counters are never cached — progress numerators read source aggregates.
 */
export { default, buildGoalsRouter } from './interface/Goals.routes.js';
export { computeProgress } from './domain/Goal.entity.js';
