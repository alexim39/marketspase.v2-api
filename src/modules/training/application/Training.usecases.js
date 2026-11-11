import {
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import {
  WATCH_JUMP_GRACE_SEC,
  WATCH_MAX_JUMP_PCT,
  WATCH_REQUIRED_PERCENT,
  courseProgress,
  shapePublicLesson,
  verifiedWatchPercent,
} from '../domain/Training.domain.js';

export {
  WATCH_JUMP_GRACE_SEC,
  WATCH_MAX_JUMP_PCT,
  WATCH_REQUIRED_PERCENT,
} from '../domain/Training.domain.js';

const groupLessons = (lessons = []) => {
  const map = new Map();
  for (const lesson of lessons) {
    const key = String(lesson.courseId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lesson);
  }
  return map;
};

const estimatedMinutes = (lessons = []) => {
  const seconds = lessons.reduce((total, lesson) => total + (Number(lesson.durationSec) || 0), 0);
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
};

const summaryFor = (course, lessons, progressRow) => {
  const progress = courseProgress({
    lessons,
    completedLessons: progressRow?.completedLessons ?? [],
    certificateAt: progressRow?.certificateAt ?? null,
  });
  const firstWithThumb = lessons.find((lesson) => lesson.thumbnailUrl);
  return {
    id: String(course.id),
    title: course.title,
    tagline: course.tagline ?? '',
    description: course.description ?? '',
    milestone: course.milestone ?? null,
    coverUrl: course.coverUrl || firstWithThumb?.thumbnailUrl || null,
    lessons: progress.total,
    done: progress.done,
    total: progress.total,
    percent: progress.percent,
    certified: progress.certified,
    certificateAt: progress.certificateAt,
    estimatedMinutes: estimatedMinutes(lessons),
    nextLessonId: progress.nextLessonId,
    publishedAt: course.publishedAt ?? null,
  };
};

const requirePublishedCourse = async (repo, courseId) => {
  const course = await repo.findPublishedCourseById(courseId);
  if (!course) throw new NotFoundException('Course not found');
  return course;
};

const requirePublishedLesson = async (repo, courseId, lessonId) => {
  const lesson = await repo.findPublishedLesson(courseId, lessonId);
  if (!lesson) throw new NotFoundException('Lesson not found');
  return lesson;
};

/** Dynamic Academy catalogue. */
export class ListCoursesUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId }) {
    const [courses, rows] = await Promise.all([
      this.training.listPublishedCourses(),
      this.training.listByPartner(partnerId),
    ]);
    const lessons = await this.training.listLessonsForCourses(
      courses.map((course) => course.id),
      { status: 'published' },
    );
    const byCourse = new Map((rows ?? []).map((row) => [String(row.courseId), row]));
    const lessonMap = groupLessons(lessons);
    return courses
      .map((course) => summaryFor(course, lessonMap.get(String(course.id)) ?? [], byCourse.get(String(course.id))))
      .filter((course) => course.total > 0);
  }
}

export class GetCourseUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId, courseId }) {
    const course = await requirePublishedCourse(this.training, courseId);
    const [lessons, row] = await Promise.all([
      this.training.listPublishedLessons(courseId),
      this.training.findByPartner(partnerId, courseId),
    ]);
    if (lessons.length === 0) throw new NotFoundException('Course not found');
    const watch = typeof this.training.getWatch === 'function'
      ? await this.training.getWatch(partnerId, courseId).catch(() => ({}))
      : {};
    const summary = summaryFor(course, lessons, row);
    const completed = new Set((row?.completedLessons ?? []).map(String));
    return {
      ...summary,
      lessons: lessons.map((lesson) => shapePublicLesson(lesson, {
        completed: completed.has(String(lesson.id)),
        watch: watch?.[String(lesson.id)] ?? null,
      })),
      completedIds: summary.lessons === 0
        ? []
        : lessons.filter((lesson) => completed.has(String(lesson.id))).map((lesson) => String(lesson.id)),
      watch,
      resumeLessonId: summary.nextLessonId ?? String(lessons[0]?.id ?? ''),
      nextLessonId: summary.nextLessonId,
    };
  }
}

export class RecordWatchUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId, courseId, lessonId, percent, seconds }) {
    const course = await requirePublishedCourse(this.training, courseId);
    const lesson = await requirePublishedLesson(this.training, courseId, lessonId);
    if (!lesson.youtubeId) throw new ValidationException('Lesson has no video');
    if (!(Number(lesson.durationSec) > 0)) {
      throw new ValidationException('This lesson has no verified video duration yet — contact support');
    }
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    const pct = verifiedWatchPercent({
      seconds: sec,
      percent,
      durationSec: lesson.durationSec,
    });

    // Anti-spoof: heartbeats must climb plausibly. A genuine client sends
    // small steps with seconds tracking playback, so cap per-request jumps
    // and require seconds to move with percent. Direct API forgers must then
    // drip-feed dozens of time-spaced requests — costlier than watching.
    const current = typeof this.training.getWatch === 'function'
      ? await this.training.getWatch(partnerId, courseId).catch(() => ({}))
      : {};
    const prev = current?.[lessonId] ?? null;
    const prevPct = Number(prev?.percent) || 0;
    const prevSec = Number(prev?.seconds) || 0;
    if (!prev && sec > WATCH_JUMP_GRACE_SEC) {
      throw new ValidationException('Watch progress must start from the beginning — reload the lesson and press play');
    }
    if (prev && sec > prevSec) {
      const prevAt = prev?.updatedAt ? new Date(prev.updatedAt).getTime() : NaN;
      if (Number.isFinite(prevAt)) {
        const elapsed = Math.max(0, (Date.now() - prevAt) / 1000);
        if (sec - prevSec > elapsed + WATCH_JUMP_GRACE_SEC) {
          throw new ValidationException('Watch progress jumped too fast — watch the video normally');
        }
      }
    }
    if (pct > prevPct) {
      if (pct - prevPct > WATCH_MAX_JUMP_PCT) {
        throw new ValidationException('Watch progress jumped too fast — watch the video normally');
      }
      if (sec <= prevSec) {
        throw new ValidationException('Watch progress inconsistent — reload the lesson and keep watching');
      }
    }
    const recorded = await this.training.recordWatch(partnerId, courseId, lessonId, pct, sec);
    return {
      ...recorded,
      courseId,
      requiredPercent: WATCH_REQUIRED_PERCENT,
      completed: (Number(recorded?.percent) || 0) >= WATCH_REQUIRED_PERCENT,
      courseTitle: course.title,
      lessonTitle: lesson.title,
    };
  }
}

export class CompleteLessonUseCase {
  /** @param {{training, progress, recognition, network}} deps */
  constructor({ training, progress, recognition, network }) {
    Object.assign(this, { training, progress, recognition, network });
  }

  async execute({ partnerId, courseId, lessonId, answers }) {
    const course = await requirePublishedCourse(this.training, courseId);
    const lesson = await requirePublishedLesson(this.training, courseId, lessonId);
    const lessons = await this.training.listPublishedLessons(courseId);

    // Video gate (server-enforced): every published lesson has a YouTube video.
    if (lesson.youtubeId) {
      const watch = typeof this.training.getWatch === 'function'
        ? await this.training.getWatch(partnerId, courseId).catch(() => ({}))
        : {};
      const pct = Number(watch?.[lessonId]?.percent) || 0;
      if (pct < WATCH_REQUIRED_PERCENT) {
        throw new ValidationException(
          `Watch the video before completing (${Math.round(pct)}% of ${WATCH_REQUIRED_PERCENT}% watched)`,
        );
      }
    }

    // Quiz gate: when a lesson carries questions, every answer must match.
    const quiz = Array.isArray(lesson.quiz) ? lesson.quiz : [];
    if (quiz.length > 0) {
      if (!Array.isArray(answers) || answers.length !== quiz.length) {
        throw new ValidationException('Answer every quiz question');
      }
      const wrong = quiz.some((question, index) => Number(answers[index]) !== Number(question.answer));
      if (wrong) throw new ValidationException('One or more answers are incorrect — try again');
    }

    const existing = await this.training.findByPartner(partnerId, courseId);
    const alreadyCertified = !!existing?.certificateAt;
    const next = courseProgress({
      lessons,
      completedLessons: [...(existing?.completedLessons ?? []), lessonId],
      certificateAt: existing?.certificateAt ?? null,
    });
    const row = await this.training.completeLesson(partnerId, courseId, lessonId, next.allDone);
    const newlyCertified = next.allDone && !alreadyCertified;
    const progress = courseProgress({
      lessons,
      completedLessons: row?.completedLessons ?? [...(existing?.completedLessons ?? []), lessonId],
      certificateAt: row?.certificateAt ?? null,
    });

    // Rank tie-in: an optional course milestone is recorded once. Another
    // course mapped to the same milestone still issues a certificate, but it
    // never overwrites or duplicates the progression event.
    let milestoneChecked = null;
    let milestoneAlreadyRecorded = false;
    if (newlyCertified && course.milestone && this.progress) {
      const current = await this.progress.findByPartner(partnerId).catch(() => null);
      if (current?.[course.milestone]?.done === true) {
        milestoneAlreadyRecorded = true;
      } else {
        const now = new Date();
        await this.progress.upsertMilestones(
          partnerId,
          {
            [course.milestone]: {
              done: true,
              at: now,
              confirmedAt: now,
              confirmedBy: null,
            },
          },
          {
            at: now,
            by: partnerId,
            key: `${course.milestone} (recorded automatically via ${course.title} certificate)`,
          },
        );
        milestoneChecked = course.milestone;
      }
    }

    // Community recognition — best-effort, never fails the request.
    if (newlyCertified && this.recognition) {
      try {
        const node = await this.network?.findNode?.(partnerId);
        const name = node
          ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
          : 'A partner';
        await this.recognition.certificate(partnerId, courseId, course.title, name);
      } catch { /* celebratory, not critical */ }
    }

    return {
      courseId,
      progress: {
        done: progress.done,
        total: progress.total,
        percent: progress.percent,
        certified: progress.certified || next.allDone,
        nextLessonId: progress.nextLessonId,
        completedIds: progress.completedIds,
      },
      certificateAt: row?.certificateAt ?? null,
      certified: newlyCertified,
      milestoneChecked,
      milestoneAlreadyRecorded,
      courseCompleted: next.allDone,
    };
  }
}

export class MyCertificatesUseCase {
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId }) {
    const rows = await this.training.listByPartner(partnerId);
    const certificates = (rows ?? []).filter((row) => row.certificateAt);
    if (certificates.length === 0) return [];
    const courses = await this.training.findCoursesByIds(certificates.map((row) => row.courseId));
    const byId = new Map((courses ?? []).map((course) => [String(course.id), course]));
    return certificates.map((row) => ({
      courseId: String(row.courseId),
      title: byId.get(String(row.courseId))?.title ?? 'Training course',
      at: row.certificateAt,
    }));
  }
}

/**
 * Downline training compliance — per-member course progress across the
 * requester's bounded downline. Read-only rollup over live dynamic courses.
 */
export class TeamComplianceUseCase {
  constructor({ training, network }) {
    Object.assign(this, { training, network });
  }

  async execute({ requesterId, limit = 200 }) {
    const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const { ids, depths, capped, total } = await collectDownlineIds(this.network, requesterId, { maxDepth: 10, cap });
    if (ids.length === 0) {
      return { members: [], total: 0, capped, summary: { notStarted: 0, inProgress: 0, fullyCertified: 0 } };
    }
    const courses = await this.training.listPublishedCourses();
    const lessons = await this.training.listLessonsForCourses(
      courses.map((course) => course.id),
      { status: 'published' },
    );
    const lessonMap = groupLessons(lessons);
    const [rows, nodes] = await Promise.all([
      this.training.listForPartners
        ? this.training.listForPartners(ids)
        : Promise.all(ids.map((id) => this.training.listByPartner(id).catch(() => []))).then((result) => result.flat()),
      this.network.findNodesByIds ? this.network.findNodesByIds(ids, cap) : [],
    ]);
    const labels = Object.fromEntries((nodes ?? []).map((node) => [String(node.id), {
      username: node.username,
      name: [node.name, node.surname].filter(Boolean).join(' ') || node.username,
    }]));
    const byPartner = new Map();
    for (const row of rows ?? []) {
      const pid = String(row.partnerId);
      if (!byPartner.has(pid)) byPartner.set(pid, []);
      byPartner.get(pid).push(row);
    }
    const members = ids.map((id) => {
      const pid = String(id);
      const progressRows = byPartner.get(pid) ?? [];
      const byCourse = Object.fromEntries(progressRows.map((row) => [String(row.courseId), row]));
      const memberCourses = courses
        .map((course) => {
          const courseLessons = lessonMap.get(String(course.id)) ?? [];
          const summary = summaryFor(course, courseLessons, byCourse[String(course.id)]);
          if (summary.total === 0) return null;
          return {
            courseId: course.id,
            title: course.title,
            milestone: course.milestone ?? null,
            done: summary.done,
            total: summary.total,
            percent: summary.percent,
            certified: summary.certified,
          };
        })
        .filter(Boolean);
      const certifiedCount = memberCourses.filter((course) => course.certified).length;
      const overallPercent = memberCourses.length > 0
        ? Math.round(memberCourses.reduce((sum, course) => sum + course.percent, 0) / memberCourses.length)
        : 0;
      return {
        partnerId: pid,
        depth: depths[pid] ?? null,
        member: labels[pid] ?? null,
        courses: memberCourses,
        overallPercent,
        certifiedCount,
      };
    });
    const summary = {
      notStarted: members.filter((member) => member.overallPercent === 0).length,
      inProgress: members.filter((member) => member.overallPercent > 0 && member.certifiedCount < courses.length).length,
      fullyCertified: members.filter((member) => member.certifiedCount === courses.length && courses.length > 0).length,
    };
    return { members, total, capped, summary };
  }
}

/** Shared upline-scope check: target must sit in the requester's bounded downline. */
const requireDownlineMember = async (network, requesterId, partnerId) => {
  const { ids, depths } = await collectDownlineIds(network, requesterId, { maxDepth: 10, cap: 5000 });
  const pid = String(partnerId);
  if (!ids.map(String).includes(pid)) {
    throw new ForbiddenException('Member is not in your downline');
  }
  return { pid, depth: depths[pid] ?? null };
};

export class TeamMemberDetailUseCase {
  constructor({ training, network }) {
    Object.assign(this, { training, network });
  }

  async execute({ requesterId, partnerId }) {
    const { pid, depth } = await requireDownlineMember(this.network, requesterId, partnerId);
    const [rows, nodes, courses] = await Promise.all([
      this.training.listForPartners
        ? this.training.listForPartners([pid])
        : this.training.listByPartner(pid).then((result) => result).catch(() => []),
      this.network.findNodesByIds ? this.network.findNodesByIds([pid]) : [],
      this.training.listPublishedCourses(),
    ]);
    const lessons = await this.training.listLessonsForCourses(
      courses.map((course) => course.id),
      { status: 'published' },
    );
    const lessonMap = groupLessons(lessons);
    const list = Array.isArray(rows) ? rows : [rows].filter(Boolean);
    const byCourse = Object.fromEntries(list.map((row) => [String(row.courseId), row]));
    const memberCourses = courses.map((course) => {
      const courseLessons = lessonMap.get(String(course.id)) ?? [];
      const summary = summaryFor(course, courseLessons, byCourse[String(course.id)]);
      return {
        courseId: course.id,
        title: course.title,
        done: summary.done,
        total: summary.total,
        percent: summary.percent,
        certified: summary.certified,
        lessons: courseLessons.map((lesson) => ({
          lessonId: lesson.id,
          title: lesson.title,
          done: summary.completedIds.includes(String(lesson.id)),
          hasVideo: !!lesson.youtubeId,
        })),
      };
    }).filter((course) => course.total > 0);
    const certifiedCount = memberCourses.filter((course) => course.certified).length;
    const node = (nodes ?? [])[0];
    return {
      partnerId: pid,
      depth,
      member: node ? {
        username: node.username,
        name: [node.name, node.surname].filter(Boolean).join(' ') || node.username,
      } : null,
      courses: memberCourses,
      overallPercent: memberCourses.length > 0
        ? Math.round(memberCourses.reduce((sum, course) => sum + course.percent, 0) / memberCourses.length)
        : 0,
      certifiedCount,
    };
  }
}

/**
 * Nudge a downline member about unfinished training — in-app stored
 * notification (never forced email: the member's prefs decide).
 */
export class NudgeMemberUseCase {
  constructor({ training, network, stored, notify, detail = null }) {
    Object.assign(this, { training, network, stored, notify });
    this.detail = detail ?? new TeamMemberDetailUseCase({ training, network });
  }

  async execute({ requesterId, partnerId, note = '', now = new Date() }) {
    const detail = await this.detail.execute({ requesterId, partnerId });
    if (detail.certifiedCount === detail.courses.length && detail.courses.length > 0) {
      return { status: 'skipped', reason: 'already-complete', detail };
    }
    const day = new Date(now).toISOString().slice(0, 10);
    const key = `training-nudge:${detail.partnerId}:${day}`;
    if (this.stored?.findByKey) {
      const existing = await this.stored.findByKey(detail.partnerId, key).catch(() => null);
      if (existing) return { status: 'skipped', reason: 'already-sent-today', detail };
    }
    const next = detail.courses.find((course) => !course.certified);
    const [upline] = this.network?.findNodesByIds
      ? await this.network.findNodesByIds([String(requesterId)]).catch(() => [])
      : [];
    const uplineName = upline
      ? [upline.name, upline.surname].filter(Boolean).join(' ') || upline.username
      : 'Your upline';
    const custom = String(note ?? '').trim().slice(0, 280);
    const body = next
      ? `You're at ${detail.overallPercent}% overall — next up: ${next.title} (${next.done}/${next.total} lessons).${custom ? ` ${uplineName} says: ${custom}` : ''}`
      : `You're at ${detail.overallPercent}% overall — open the Academy to continue.${custom ? ` ${uplineName} says: ${custom}` : ''}`;
    const row = await this.notify.execute({
      recipientId: detail.partnerId,
      category: 'training',
      priority: 'medium',
      title: `${uplineName} nudged you to keep learning`,
      body,
      icon: 'school',
      link: next?.courseId ? `/dashboard/training/courses/${next.courseId}` : '/dashboard/training/courses',
      key,
    });
    return {
      status: 'notified',
      deduped: row?.deduped === true,
      overallPercent: detail.overallPercent,
      nextCourseId: next?.courseId ?? null,
      detail,
    };
  }
}
