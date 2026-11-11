/**
 * Contracts for the dynamic training slice.
 *
 * Courses, lessons and per-partner progress persist. Certificates may record
 * the optional rank milestone attached to a course.
 */
export class TrainingStore {
  async createCourse() { throw new Error('Not implemented'); }
  async updateCourse() { throw new Error('Not implemented'); }
  async findCourseById() { throw new Error('Not implemented'); }
  async findPublishedCourseById() { throw new Error('Not implemented'); }
  async listCourses() { throw new Error('Not implemented'); }
  async listPublishedCourses() { throw new Error('Not implemented'); }
  async listLessons() { throw new Error('Not implemented'); }
  async listPublishedLessons() { throw new Error('Not implemented'); }
  async listLessonsForCourses() { throw new Error('Not implemented'); }
  async findPublishedLesson() { throw new Error('Not implemented'); }
  async findByPartner() { throw new Error('Not implemented'); }
  async listByPartner() { throw new Error('Not implemented'); }
  async completeLesson() { throw new Error('Not implemented'); }
  async getWatch() { throw new Error('Not implemented'); }
  async recordWatch() { throw new Error('Not implemented'); }
}
