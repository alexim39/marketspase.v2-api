/**
 * Contracts for the training slice. Catalog content is static (domain);
 * only per-partner progress persists. Certificates auto-check the
 * linked progression milestone (explicit cross-slice write, documented).
 */
export class TrainingStore {
  async findByPartner(partnerId, courseId) { throw new Error('Not implemented'); }
  async listByPartner(partnerId) { throw new Error('Not implemented'); }
  async completeLesson(partnerId, courseId, lessonId) { throw new Error('Not implemented'); }
}
