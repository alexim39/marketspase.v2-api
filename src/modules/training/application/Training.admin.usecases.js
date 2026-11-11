import {
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import {
  assertCoursePublishable,
  assertLessonPublishable,
  cleanCourseInput,
  cleanLessonInput,
} from '../domain/Training.domain.js';

const estimatedMinutes = (lessons = []) => {
  const seconds = lessons.reduce((total, lesson) => total + (Number(lesson.durationSec) || 0), 0);
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
};

const courseWarnings = (course, conflict) => {
  if (!course?.milestone || !conflict) return [];
  return [{
    code: 'milestone-conflict',
    message: `Another published course already awards ${course.milestone.toUpperCase()}: "${conflict.title}". The first course a member completes records the milestone; the other still issues a certificate.`,
    courseId: conflict.id,
    courseTitle: conflict.title,
  }];
};

const adminCourseSummary = (course, lessons, conflict = null) => ({
  id: course.id,
  title: course.title,
  tagline: course.tagline ?? '',
  description: course.description ?? '',
  milestone: course.milestone ?? null,
  coverUrl: course.coverUrl ?? null,
  status: course.status,
  sortOrder: course.sortOrder,
  lessonCount: lessons.length,
  publishedLessonCount: lessons.filter((lesson) => lesson.status === 'published').length,
  estimatedMinutes: estimatedMinutes(lessons.filter((lesson) => lesson.status === 'published')),
  publishedAt: course.publishedAt ?? null,
  archivedAt: course.archivedAt ?? null,
  createdAt: course.createdAt ?? null,
  updatedAt: course.updatedAt ?? null,
  warnings: courseWarnings(course, conflict),
});

const adminLesson = (lesson) => ({
  id: lesson.id,
  courseId: String(lesson.courseId),
  title: lesson.title,
  summary: lesson.summary ?? '',
  body: lesson.body ?? '',
  takeaways: lesson.takeaways ?? [],
  transcript: lesson.transcript ?? '',
  youtubeId: lesson.youtubeId ?? null,
  youtubeUrl: lesson.youtubeUrl ?? null,
  thumbnailUrl: lesson.thumbnailUrl ?? null,
  durationSec: lesson.durationSec ?? 0,
  quiz: lesson.quiz ?? [],
  status: lesson.status,
  sortOrder: lesson.sortOrder,
  createdAt: lesson.createdAt ?? null,
  updatedAt: lesson.updatedAt ?? null,
  isReady: Boolean(lesson.youtubeId && lesson.title),
});

export class ListAdminCoursesUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute() {
    const courses = await this.training.listCourses();
    const lessons = await this.training.listLessonsForCourses(courses.map((course) => course.id));
    const byCourse = new Map();
    for (const lesson of lessons) {
      const key = String(lesson.courseId);
      if (!byCourse.has(key)) byCourse.set(key, []);
      byCourse.get(key).push(lesson);
    }
    const conflicts = new Map();
    for (const course of courses) {
      if (course.milestone) {
        conflicts.set(course.id, await this.training.publishedMilestoneConflict(course.milestone, course.id));
      }
    }
    return courses.map((course) => adminCourseSummary(
      course,
      byCourse.get(String(course.id)) ?? [],
      conflicts.get(course.id) ?? null,
    ));
  }
}

export class GetAdminCourseUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId }) {
    const course = await this.training.findCourseById(courseId);
    if (!course) throw new NotFoundException('Course not found');
    const lessons = await this.training.listLessons(courseId);
    const conflict = course.milestone
      ? await this.training.publishedMilestoneConflict(course.milestone, course.id)
      : null;
    return {
      ...adminCourseSummary(course, lessons, conflict),
      lessons: lessons.map(adminLesson),
    };
  }
}

export class CreateCourseUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ adminId, input = {} }) {
    const patch = cleanCourseInput(input);
    const course = await this.training.createCourse({
      ...patch,
      status: 'draft',
      sortOrder: await this.training.nextCourseOrder(),
      publishedAt: null,
      archivedAt: null,
      createdBy: adminId ?? null,
      updatedBy: adminId ?? null,
    });
    const conflict = course.milestone
      ? await this.training.publishedMilestoneConflict(course.milestone, course.id)
      : null;
    return {
      ...adminCourseSummary(course, [], conflict),
      lessons: [],
    };
  }
}

export class UpdateCourseUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId, adminId, input = {} }) {
    const existing = await this.training.findCourseById(courseId);
    if (!existing) throw new NotFoundException('Course not found');
    const patch = cleanCourseInput(input, { partial: true });
    if (Object.keys(patch).length === 0) throw new ValidationException('Nothing to update');
    const nextStatus = patch.status ?? existing.status;

    if (patch.status === 'published' || (nextStatus === 'published' && patch.status !== undefined)) {
      const published = await this.training.listPublishedLessons(courseId);
      assertCoursePublishable(published);
      if (existing.status !== 'published') patch.publishedAt = new Date();
    }
    if (patch.status === 'archived') patch.archivedAt = new Date();
    patch.updatedBy = adminId ?? null;
    const course = await this.training.updateCourse(courseId, patch);
    if (!course) throw new NotFoundException('Course not found');
    const conflict = course.milestone
      ? await this.training.publishedMilestoneConflict(course.milestone, course.id)
      : null;
    const lessons = await this.training.listLessons(courseId);
    return {
      ...adminCourseSummary(course, lessons, conflict),
      lessons: lessons.map(adminLesson),
    };
  }
}

export class ArchiveCourseUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId, adminId }) {
    const existing = await this.training.findCourseById(courseId);
    if (!existing) throw new NotFoundException('Course not found');
    const course = await this.training.updateCourse(courseId, {
      status: 'archived',
      archivedAt: new Date(),
      updatedBy: adminId ?? null,
    });
    return adminCourseSummary(course, await this.training.listLessons(courseId));
  }
}

export class ReorderCoursesUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ ids = [] }) {
    if (!Array.isArray(ids) || ids.length === 0) throw new ValidationException('Course order is required');
    const courses = await this.training.listCourses();
    const known = new Set(courses.map((course) => String(course.id)));
    const cleanIds = ids.map(String);
    if (cleanIds.length !== known.size || new Set(cleanIds).size !== cleanIds.length || cleanIds.some((id) => !known.has(id))) {
      throw new ValidationException('Course order must include every course exactly once');
    }
    await this.training.reorderCourses(cleanIds);
    return this.executeResult();
  }

  async executeResult() {
    const courses = await this.training.listCourses();
    return courses.map((course) => ({
      id: course.id,
      title: course.title,
      status: course.status,
      sortOrder: course.sortOrder,
    }));
  }
}

export class CreateLessonUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId, adminId, input = {} }) {
    const course = await this.training.findCourseById(courseId);
    if (!course) throw new NotFoundException('Course not found');
    if (course.status === 'archived') throw new ValidationException('Restore this course before adding lessons');
    const patch = cleanLessonInput(input);
    const next = {
      ...patch,
      takeaways: patch.takeaways ?? [],
      quiz: patch.quiz ?? [],
      status: patch.status === 'published' ? 'published' : 'draft',
      sortOrder: await this.training.nextLessonOrder(courseId),
      createdBy: adminId ?? null,
      updatedBy: adminId ?? null,
    };
    assertLessonPublishable(next);
    const lesson = await this.training.createLesson(courseId, next);
    return adminLesson(lesson);
  }
}

export class UpdateLessonUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId, lessonId, adminId, input = {} }) {
    const [course, existing] = await Promise.all([
      this.training.findCourseById(courseId),
      this.training.findLessonById(courseId, lessonId),
    ]);
    if (!course) throw new NotFoundException('Course not found');
    if (!existing) throw new NotFoundException('Lesson not found');
    const patch = cleanLessonInput(input, { partial: true });
    if (Object.keys(patch).length === 0) throw new ValidationException('Nothing to update');
    const merged = { ...existing, ...patch };
    assertLessonPublishable(merged);
    if (course.status === 'published' && merged.status !== 'published') {
      const published = await this.training.listPublishedLessons(courseId);
      if (published.filter((lesson) => String(lesson.id) !== String(lessonId)).length === 0) {
        throw new ValidationException('A published course needs at least one published lesson');
      }
    }
    const lesson = await this.training.updateLesson(courseId, lessonId, {
      ...patch,
      updatedBy: adminId ?? null,
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return adminLesson(lesson);
  }
}

export class DeleteLessonUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId, lessonId }) {
    const [course, existing] = await Promise.all([
      this.training.findCourseById(courseId),
      this.training.findLessonById(courseId, lessonId),
    ]);
    if (!course) throw new NotFoundException('Course not found');
    if (!existing) throw new NotFoundException('Lesson not found');
    if (course.status === 'published' && existing.status === 'published') {
      const published = await this.training.listPublishedLessons(courseId);
      if (published.length <= 1) {
        throw new ValidationException('A published course needs at least one published lesson');
      }
    }
    const deleted = await this.training.deleteLesson(courseId, lessonId);
    return { deleted: Boolean(deleted), lessonId, courseId };
  }
}

export class ReorderLessonsUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ courseId, ids = [] }) {
    const course = await this.training.findCourseById(courseId);
    if (!course) throw new NotFoundException('Course not found');
    if (!Array.isArray(ids) || ids.length === 0) throw new ValidationException('Lesson order is required');
    const lessons = await this.training.listLessons(courseId);
    const known = new Set(lessons.map((lesson) => String(lesson.id)));
    const cleanIds = ids.map(String);
    if (cleanIds.length !== known.size || new Set(cleanIds).size !== cleanIds.length || cleanIds.some((id) => !known.has(id))) {
      throw new ValidationException('Lesson order must include every lesson exactly once');
    }
    await this.training.reorderLessons(courseId, cleanIds);
    return (await this.training.listLessons(courseId)).map(adminLesson);
  }
}
