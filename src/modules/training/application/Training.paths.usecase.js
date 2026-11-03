import { PATHS, isPathUnlocked, pathProgress } from '../domain/Training.paths.js';

/** GET /v1/training/paths — 10 rank paths with unlock + progress derived from live gates. */
export class ListPathsUseCase {
  /** @param {{progress, training}} deps */
  constructor({ progress, training }) {
    Object.assign(this, { progress, training });
  }

  async execute({ partnerId }) {
    const [doc, rows] = await Promise.all([
      this.progress.findByPartner(partnerId).catch(() => null),
      this.training.listByPartner(partnerId).catch(() => []),
    ]);
    const milestones = doc?.milestones ?? doc ?? {};
    // Signals minimal for gate checks on paths (full journey does its own aggregates elsewhere).
    const signals = doc?.signals ?? {};
    const byCourse = Object.fromEntries((rows ?? []).map((r) => [r.courseId, r]));
    return PATHS.map((p) => {
      const unlocked = isPathUnlocked(p.level, milestones, signals);
      const progress = pathProgress(p.level, milestones, signals);
      // Course-level progress for any linked course.
      const courses = p.requirements
        .filter((r) => r.courseId)
        .map((r) => {
          const c = byCourse[r.courseId];
          const done = c?.completedLessons?.length ?? 0;
          const total = c ? undefined : null;
          return { courseId: r.courseId, done, certified: !!c?.certificateAt };
        });
      return {
        level: p.level,
        title: p.title,
        tagline: p.tagline,
        unlocked,
        progress,
        requirements: p.requirements,
        courses,
      };
    });
  }
}
