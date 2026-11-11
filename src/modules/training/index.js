/**
 * Public entry for the training slice.
 *
 * Courses and lessons are admin-owned dynamic records. Certificates record the
 * optional rank milestone attached to a course; electives never affect rank.
 */
export { default, buildTrainingRouter } from './interface/Training.routes.js';
export { courseProgress } from './domain/Training.domain.js';
