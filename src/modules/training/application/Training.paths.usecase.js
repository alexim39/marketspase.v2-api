import { buildPaths, isPathUnlocked, pathProgress } from '../domain/Training.paths.js';
import { courseProgress } from '../domain/Training.domain.js';

/** GET /v1/training/paths — dynamic course links with unlock + live progress. */
export class ListPathsUseCase {
  constructor({ progress, training }) {
    Object.assign(this, { progress, training });
  }

  async execute({ partnerId }) {
    const [doc, rows, catalog] = await Promise.all([
      this.progress.findByPartner(partnerId).catch(() => null),
      this.training.listByPartner(partnerId).catch(() => []),
      this.training.listPublishedCourses().catch(() => []),
    ]);
    const lessons = await this.training.listLessonsForCourses(
      catalog.map((course) => course.id),
      { status: 'published' },
    ).catch(() => []);
    const lessonsByCourse = new Map();
    for (const lesson of lessons) {
      const key = String(lesson.courseId);
      if (!lessonsByCourse.has(key)) lessonsByCourse.set(key, []);
      lessonsByCourse.get(key).push(lesson);
    }
    const courseByMilestone = {};
    for (const course of catalog) {
      if (course.milestone && !courseByMilestone[course.milestone]) {
        courseByMilestone[course.milestone] = course;
      }
    }
    const milestones = doc?.milestones ?? doc ?? {};
    const signals = doc?.signals ?? {};
    const byCourse = Object.fromEntries((rows ?? []).map((row) => [String(row.courseId), row]));
    return buildPaths(courseByMilestone).map((path) => {
      const unlocked = isPathUnlocked(path.level, milestones, signals);
      const progress = pathProgress(path.level, milestones, signals);
      const courses = path.requirements
        .filter((requirement) => requirement.courseId)
        .map((requirement) => {
          const course = catalog.find((item) => String(item.id) === String(requirement.courseId));
          const row = byCourse[String(requirement.courseId)];
          const courseLessons = lessonsByCourse.get(String(requirement.courseId)) ?? [];
          const measured = course
            ? courseProgress({
              lessons: courseLessons,
              completedLessons: row?.completedLessons ?? [],
              certificateAt: row?.certificateAt ?? null,
            })
            : { done: 0, total: 0, percent: 0, certified: false };
          return {
            courseId: requirement.courseId,
            title: course?.title ?? requirement.courseTitle ?? null,
            done: measured.done,
            total: measured.total,
            percent: measured.percent,
            certified: measured.certified,
          };
        });
      return {
        level: path.level,
        title: path.title,
        tagline: path.tagline,
        unlocked,
        progress,
        requirements: path.requirements,
        courses,
      };
    });
  }
}
