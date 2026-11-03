import { catalogSummaries, courseProgress, getCourse, getCourseWithQuiz, getLesson, getLessonWithQuiz } from '../domain/Training.catalog.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { ForbiddenException } from '../../../shared/domain/AppError.js';

export const WATCH_REQUIRED_PERCENT = 90;

/** Anti-spoof caps for watch heartbeats (see RecordWatchUseCase). */
export const WATCH_MAX_JUMP_PCT = 35;
export const WATCH_JUMP_GRACE_SEC = 30;

/** Online IPO / QSG / SMO / Leadership — completion feeds the ladder. */
export class ListCoursesUseCase {
  /** @param {{training}} deps */
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId }) {
    const rows = await this.training.listByPartner(partnerId);
    const byCourse = Object.fromEntries(rows.map((r) => [r.courseId, r]));
    return catalogSummaries().map((c) => {
      const course = getCourse(c.id);
      const progress = courseProgress(course, byCourse[c.id]?.completedLessons ?? []);
      return {
        ...c,
        ...progress,
        certificateAt: byCourse[c.id]?.certificateAt ?? null,
      };
    });
  }
}

export class GetCourseUseCase {
  /** @param {{training}} deps */
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId, courseId }) {
    const row = await this.training.findByPartner(partnerId, courseId);
    const done = row?.completedLessons ?? [];
    // Completed lessons ship their answer keys (review after passing);
    // open lessons stay silent (anti-click-through).
    const course = await getCourseWithQuiz(courseId, this.training, done);
    const watch = typeof this.training.getWatch === 'function'
      ? await this.training.getWatch(partnerId, courseId).catch(() => ({}))
      : {};
    return {
      ...course,
      ...courseProgress(course, row?.completedLessons ?? []),
      certificateAt: row?.certificateAt ?? null,
      watch,
    };
  }
}

export class RecordWatchUseCase {
  /** @param {{training}} deps */
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId, courseId, lessonId, percent, seconds }) {
    const { lesson } = await getLesson(courseId, lessonId); // throws on unknown ids
    if (!lesson.videoUrl) {
      throw new (await import('../../../shared/domain/AppError.js')).ValidationException('Lesson has no video');
    }
    const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    // Anti-spoof: heartbeats must climb plausibly. A genuine client sends
    // ~10% steps with seconds tracking playback, so cap per-request jumps
    // and require seconds to move with percent. Direct API forgers must then
    // drip-feed dozens of time-spaced requests — costlier than watching.
    const current = typeof this.training.getWatch === 'function'
      ? await this.training.getWatch(partnerId, courseId).catch(() => ({}))
      : {};
    const prev = current?.[lessonId] ?? null;
    const prevPct = Number(prev?.percent) || 0;
    const prevSec = Number(prev?.seconds) || 0;
    if (pct > prevPct) {
      if (pct - prevPct > WATCH_MAX_JUMP_PCT) {
        throw new (await import('../../../shared/domain/AppError.js')).ValidationException(
          'Watch progress jumped too fast — watch the video normally',
        );
      }
      if (sec <= prevSec) {
        throw new (await import('../../../shared/domain/AppError.js')).ValidationException(
          'Watch progress inconsistent — reload the lesson and keep watching',
        );
      }
      const prevAt = prev?.updatedAt ? new Date(prev.updatedAt).getTime() : NaN;
      if (Number.isFinite(prevAt)) {
        const elapsed = Math.max(0, (Date.now() - prevAt) / 1000);
        if (sec - prevSec > elapsed + WATCH_JUMP_GRACE_SEC) {
          throw new (await import('../../../shared/domain/AppError.js')).ValidationException(
            'Watch progress jumped too fast — watch the video normally',
          );
        }
      }
    }
    return this.training.recordWatch(partnerId, courseId, lessonId, pct, sec);
  }
}

export class CompleteLessonUseCase {
  /** @param {{training, progress, recognition, network}} deps (recognition/network optional — auto-posts certificates) */
  constructor({ training, progress, recognition, network }) {
    Object.assign(this, { training, progress, recognition, network });
  }

  async execute({ partnerId, courseId, lessonId, answers }) {
    const { course, lesson } = await getLessonWithQuiz(courseId, lessonId, this.training); // throws on unknown ids
    // Video gate (server-enforced): video lessons need >=90% watched before completion.
    if (lesson.videoUrl) {
      const watch = typeof this.training.getWatch === 'function'
        ? await this.training.getWatch(partnerId, courseId).catch(() => ({}))
        : {};
      const pct = watch?.[lessonId]?.percent ?? 0;
      if (pct < WATCH_REQUIRED_PERCENT) {
        throw new (await import('../../../shared/domain/AppError.js')).ValidationException(
          `Watch the video before completing (${Math.round(pct)}% of ${WATCH_REQUIRED_PERCENT}% watched)`,
        );
      }
    }
    // Quiz gate: when a lesson carries questions, all answers must match.
    // Passing length check + every index correct prevents click-through certs.
    const quiz = lesson.quiz ?? [];
    if (quiz.length > 0) {
      if (!Array.isArray(answers) || answers.length !== quiz.length) {
        throw new (await import('../../../shared/domain/AppError.js')).ValidationException('Answer every quiz question');
      }
      const wrong = quiz.some((q, i) => Number(answers[i]) !== q.answer);
      if (wrong) throw new (await import('../../../shared/domain/AppError.js')).ValidationException('One or more answers are incorrect — try again');
    }
    const existing = await this.training.findByPartner(partnerId, courseId);
    const alreadyCertified = !!existing?.certificateAt;
    const next = courseProgress(course, [...(existing?.completedLessons ?? []), lessonId]);
    const row = await this.training.completeLesson(partnerId, courseId, lessonId, next.certified);
    const newlyCertified = next.certified && !alreadyCertified;

    // Ladder tie-in: a fresh certificate checks its progression milestone.
    let milestoneChecked = null;
    if (newlyCertified && course.milestone && this.progress) {
      await this.progress.upsertMilestones(
        partnerId,
        { [course.milestone]: { done: true, at: new Date() } },
        { at: new Date(), by: partnerId, key: `${course.milestone} (via ${courseId} certificate)` },
      );
      milestoneChecked = course.milestone;
    }

    // Community recognition — best-effort, never fails the request.
    if (newlyCertified && this.recognition) {
      try {
        const node = await this.network?.findNode(partnerId);
        const name = node
          ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
          : 'A partner';
        await this.recognition.certificate(partnerId, courseId, course.title, name);
      } catch { /* celebratory, not critical */ }
    }
    return {
      progress: next,
      certificateAt: row?.certificateAt ?? null,
      certified: newlyCertified,
      milestoneChecked,
    };
  }
}

export class MyCertificatesUseCase {
  /** @param {{training}} deps */
  constructor({ training }) {
    this.training = training;
  }

  async execute({ partnerId }) {
    const rows = await this.training.listByPartner(partnerId);
    return rows
      .filter((r) => r.certificateAt)
      .map((r) => {
        const course = getCourse(r.courseId);
        return { courseId: r.courseId, title: course.title, at: r.certificateAt };
      });
  }
}

/**
 * Downline training compliance — per-member course progress across the
 * requester's bounded downline. Read-only rollup over existing progress
 * rows; members with no rows count as not started.
 */
export class TeamComplianceUseCase {
  /** @param {{training, network}} deps */
  constructor({ training, network }) {
    Object.assign(this, { training, network });
  }

  async execute({ requesterId, limit = 200 }) {
    const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const { ids, depths, capped, total } = await collectDownlineIds(this.network, requesterId, { maxDepth: 10, cap });
    if (ids.length === 0) {
      return { members: [], total: 0, capped, summary: { notStarted: 0, inProgress: 0, fullyCertified: 0 } };
    }
    const [rows, nodes] = await Promise.all([
      this.training.listForPartners
        ? this.training.listForPartners(ids)
        : Promise.all(ids.map((id) => this.training.listByPartner(id).catch(() => []))).then((r) => r.flat()),
      this.network.findNodesByIds ? this.network.findNodesByIds(ids, cap) : [],
    ]);
    const labels = Object.fromEntries((nodes ?? []).map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));
    const byPartner = new Map();
    for (const r of rows ?? []) {
      const pid = String(r.partnerId);
      if (!byPartner.has(pid)) byPartner.set(pid, []);
      byPartner.get(pid).push(r);
    }
    const catalog = catalogSummaries();
    const members = ids.map((id) => {
      const pid = String(id);
      const prow = byPartner.get(pid) ?? [];
      const byCourse = Object.fromEntries(prow.map((r) => [r.courseId, r]));
      const courses = catalog.map((c) => {
        const course = getCourse(c.id);
        const p = courseProgress(course, byCourse[c.id]?.completedLessons ?? []);
        return { courseId: c.id, title: c.title, done: p.done, total: p.total, percent: p.percent, certified: p.certified };
      });
      const certifiedCount = courses.filter((c) => c.certified).length;
      const overallPercent = courses.length > 0
        ? Math.round(courses.reduce((s, c) => s + c.percent, 0) / courses.length)
        : 0;
      return {
        partnerId: pid,
        depth: depths[pid] ?? null,
        member: labels[pid] ?? null,
        courses,
        overallPercent,
        certifiedCount,
      };
    });
    const summary = {
      notStarted: members.filter((m) => m.overallPercent === 0).length,
      inProgress: members.filter((m) => m.overallPercent > 0 && m.certifiedCount < courses0(catalog)).length,
      fullyCertified: members.filter((m) => m.certifiedCount === courses0(catalog) && catalog.length > 0).length,
    };
    return { members, total, capped, summary };
  }
}

const courses0 = (catalog) => catalog.length;

/** Shared upline-scope check: target must sit in the requester's bounded downline. */
const requireDownlineMember = async (network, requesterId, partnerId) => {
  const { ids, depths } = await collectDownlineIds(network, requesterId, { maxDepth: 10, cap: 5000 });
  const pid = String(partnerId);
  if (!ids.map(String).includes(pid)) {
    throw new ForbiddenException('Member is not in your downline');
  }
  return { pid, depth: depths[pid] ?? null };
};

/**
 * Nudge a downline member about unfinished training — in-app stored
 * notification (never forced email: the member's prefs decide).
 * Skips the fully certified; throttled to one nudge per member per day
 * via the daily dedupe key (NotifyUseCase also dedupes races on E11000).
 */
export class NudgeMemberUseCase {
  /** @param {{training, network, stored, notify, detail?}} deps */
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
    const next = detail.courses.find((c) => !c.certified);
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
      link: '/dashboard/training/courses',
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
export class TeamMemberDetailUseCase {
  /** @param {{training, network}} deps */
  constructor({ training, network }) {
    Object.assign(this, { training, network });
  }

  async execute({ requesterId, partnerId }) {
    const { pid, depth } = await requireDownlineMember(this.network, requesterId, partnerId);
    const [rows, nodes] = await Promise.all([
      this.training.listForPartners
        ? this.training.listForPartners([pid])
        : this.training.listByPartner(pid).then((r) => r).catch(() => []),
      this.network.findNodesByIds ? this.network.findNodesByIds([pid]) : [],
    ]);
    const list = Array.isArray(rows) ? rows : [rows].filter(Boolean);
    const byCourse = Object.fromEntries(list.map((r) => [r.courseId, r]));
    const catalog = catalogSummaries();
    const courses = catalog.map((c) => {
      const course = getCourse(c.id);
      const p = courseProgress(course, byCourse[c.id]?.completedLessons ?? []);
      return {
        courseId: c.id,
        title: c.title,
        done: p.done,
        total: p.total,
        percent: p.percent,
        certified: p.certified,
        lessons: course.lessons.map((l) => ({
          lessonId: l.id,
          title: l.title,
          done: p.completedIds.includes(l.id),
          hasVideo: !!l.videoUrl,
        })),
      };
    });
    const certifiedCount = courses.filter((c) => c.certified).length;
    const nd = (nodes ?? [])[0];
    return {
      partnerId: pid,
      depth,
      member: nd ? {
        username: nd.username,
        name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
      } : null,
      courses,
      overallPercent: courses.length > 0
        ? Math.round(courses.reduce((s, c) => s + c.percent, 0) / courses.length)
        : 0,
      certifiedCount,
    };
  }
}
