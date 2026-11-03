/**
 * Public entry for the training slice (IPO / QSG / SMO / Leadership).
 * Certificates auto-check the linked progression milestone.
 */
export { default, buildTrainingRouter } from './interface/Training.routes.js';
export { COURSES, courseProgress } from './domain/Training.catalog.js';
