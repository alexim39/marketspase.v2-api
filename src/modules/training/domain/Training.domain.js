import { ValidationException } from '../../../shared/domain/AppError.js';
import {
  extractYouTubeId,
  thumbnailUrl as youtubeThumbnail,
  watchUrl as youtubeWatchUrl,
} from '../../tutorials/domain/Tutorial.youtube.js';

/**
 * Dynamic training domain.
 *
 * Courses and lessons are admin-owned records. The four rank milestones stay
 * system enums because progression reads them, but a course can carry at most
 * one optional milestone. Courses with no milestone are electives and never
 * change rank.
 */

export const TRAINING_MILESTONES = ['ipo', 'qsg', 'smo', 'leadership'];
export const TRAINING_MILESTONE_LABELS = {
  ipo: 'IPO',
  qsg: 'QSG',
  smo: 'SMO',
  leadership: 'Leadership',
};
export const TRAINING_STATUSES = ['draft', 'published', 'archived'];

export const WATCH_REQUIRED_PERCENT = 90;
/** Anti-spoof caps for watch heartbeats (see RecordWatchUseCase). */
export const WATCH_MAX_JUMP_PCT = 35;
export const WATCH_JUMP_GRACE_SEC = 30;

const cleanText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

const cleanMultiline = (value) => String(value ?? '').trim();

const optionalText = (value, max, label) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return '';
  const text = cleanMultiline(value);
  if (text.length > max) throw new ValidationException(`${label} must be ${max} characters or fewer`);
  return text;
};

export const normalizeMilestone = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '' || String(value).trim() === 'none') return null;
  const key = String(value).trim().toLowerCase();
  if (!TRAINING_MILESTONES.includes(key)) {
    throw new ValidationException('Choose a valid rank milestone or leave it blank');
  }
  return key;
};

export const normalizeStatus = (value) => {
  if (value === undefined) return undefined;
  const status = String(value).trim().toLowerCase();
  if (!TRAINING_STATUSES.includes(status)) {
    throw new ValidationException('Status must be draft, published or archived');
  }
  return status;
};

const cleanCoverUrl = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const url = String(value).trim();
  if (!/^https?:\/\/.+/i.test(url) && !/^\/[A-Za-z0-9_\-./]+$/.test(url)) {
    throw new ValidationException('Cover image must be an https URL or a site path');
  }
  if (url.length > 700) throw new ValidationException('Cover image URL is too long');
  return url;
};

export const cleanCourseInput = (input = {}, { partial = false } = {}) => {
  const patch = {};
  if (input.title !== undefined || !partial) {
    const title = cleanText(input.title);
    if (title.length < 3) throw new ValidationException('Course title must be at least 3 characters');
    if (title.length > 120) throw new ValidationException('Course title must be 120 characters or fewer');
    patch.title = title;
  }
  if (input.tagline !== undefined || !partial) {
    const tagline = cleanText(input.tagline);
    if (tagline.length > 200) throw new ValidationException('Course tagline must be 200 characters or fewer');
    patch.tagline = tagline;
  }
  if (input.description !== undefined || !partial) {
    const description = optionalText(input.description, 5000, 'Course description');
    patch.description = description ?? '';
  }
  if (input.milestone !== undefined) patch.milestone = normalizeMilestone(input.milestone);
  if (input.coverUrl !== undefined) patch.coverUrl = cleanCoverUrl(input.coverUrl);
  if (input.status !== undefined) patch.status = normalizeStatus(input.status);
  if (input.sortOrder !== undefined && input.sortOrder !== null && input.sortOrder !== '') {
    const order = Number(input.sortOrder);
    if (!Number.isFinite(order) || order < 0) throw new ValidationException('Course order must be zero or higher');
    patch.sortOrder = Math.round(order);
  }
  return patch;
};

const cleanTakeaways = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new ValidationException('Key takeaways must be a list');
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 12)
    .map((item) => {
      if (item.length > 240) throw new ValidationException('Each key takeaway must be 240 characters or fewer');
      return item;
    });
};

const cleanQuiz = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new ValidationException('Quiz must be a list of questions');
  if (value.length > 15) throw new ValidationException('A lesson can have at most 15 quiz questions');
  return value.map((question, index) => {
    const q = cleanText(question?.q ?? question?.question);
    if (q.length < 3) throw new ValidationException(`Question ${index + 1} must be at least 3 characters`);
    if (q.length > 500) throw new ValidationException(`Question ${index + 1} must be 500 characters or fewer`);
    if (!Array.isArray(question?.options)) throw new ValidationException(`Question ${index + 1} needs answer options`);
    if (question.options.length < 2 || question.options.length > 6) {
      throw new ValidationException(`Question ${index + 1} needs between 2 and 6 options`);
    }
    const options = question.options.map((option, optionIndex) => {
      const text = cleanText(option);
      if (!text) throw new ValidationException(`Question ${index + 1}, option ${optionIndex + 1} cannot be empty`);
      if (text.length > 200) throw new ValidationException(`Question ${index + 1} options must be 200 characters or fewer`);
      return text;
    });
    const answer = Number(question.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new ValidationException(`Choose the correct option for question ${index + 1}`);
    }
    return { q, options, answer };
  });
};

const cleanYoutube = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') {
    return { youtubeId: null, youtubeUrl: null, thumbnailUrl: null };
  }
  const id = extractYouTubeId(value);
  if (!id) throw new ValidationException('Paste a valid YouTube link (watch, youtu.be, shorts or embed)');
  return {
    youtubeId: id,
    youtubeUrl: youtubeWatchUrl(id),
    thumbnailUrl: youtubeThumbnail(id),
  };
};

const cleanDuration = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return 0;
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 43200) {
    throw new ValidationException('Video duration must be between 0 and 12 hours');
  }
  return seconds;
};

export const cleanLessonInput = (input = {}, { partial = false } = {}) => {
  const patch = {};
  if (input.title !== undefined || !partial) {
    const title = cleanText(input.title);
    if (title.length < 3) throw new ValidationException('Lesson title must be at least 3 characters');
    if (title.length > 140) throw new ValidationException('Lesson title must be 140 characters or fewer');
    patch.title = title;
  }
  if (input.summary !== undefined) patch.summary = optionalText(input.summary, 500, 'Lesson summary') ?? '';
  if (input.body !== undefined) patch.body = optionalText(input.body, 50000, 'Lesson content') ?? '';
  if (input.takeaways !== undefined) patch.takeaways = cleanTakeaways(input.takeaways);
  if (input.transcript !== undefined) patch.transcript = optionalText(input.transcript, 30000, 'Transcript') ?? '';
  if (input.youtubeUrl !== undefined) Object.assign(patch, cleanYoutube(input.youtubeUrl));
  if (input.durationSec !== undefined) patch.durationSec = cleanDuration(input.durationSec);
  if (input.quiz !== undefined) patch.quiz = cleanQuiz(input.quiz);
  if (input.status !== undefined) patch.status = normalizeStatus(input.status);
  if (input.sortOrder !== undefined && input.sortOrder !== null && input.sortOrder !== '') {
    const order = Number(input.sortOrder);
    if (!Number.isFinite(order) || order < 0) throw new ValidationException('Lesson order must be zero or higher');
    patch.sortOrder = Math.round(order);
  }
  return patch;
};

/** A published lesson must have a playable YouTube video and a known duration. */
export const assertLessonPublishable = (lesson) => {
  if (lesson?.status !== 'published') return;
  if (!lesson?.youtubeId) {
    throw new ValidationException('Add a YouTube video before publishing this lesson');
  }
  if (!(Number(lesson?.durationSec) > 0)) {
    throw new ValidationException('Detect or enter the video duration before publishing this lesson');
  }
};

/** A published course needs at least one published video lesson. */
export const assertCoursePublishable = (publishedLessons = []) => {
  if (!Array.isArray(publishedLessons) || publishedLessons.length === 0) {
    throw new ValidationException('Publish at least one lesson before publishing this course');
  }
  if (publishedLessons.some((lesson) => !lesson.youtubeId || !(Number(lesson.durationSec) > 0))) {
    throw new ValidationException('Every published lesson needs a YouTube video and a verified duration');
  }
};

/**
 * Course progress uses the published curriculum only. Completed ids that point
 * to drafts/archived lessons are ignored for the percentage, but are preserved
 * in the progress row for history.
 */
export const courseProgress = ({ lessons = [], completedLessons = [], certificateAt = null } = {}) => {
  const published = lessons.filter((lesson) => lesson.status === 'published');
  const completed = new Set((completedLessons ?? []).map(String));
  const completedIds = published.filter((lesson) => completed.has(String(lesson.id))).map((lesson) => String(lesson.id));
  const total = published.length;
  const done = completedIds.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const next = published.find((lesson) => !completed.has(String(lesson.id))) ?? null;
  return {
    done,
    total,
    percent,
    certified: Boolean(certificateAt),
    certificateAt: certificateAt ?? null,
    completedIds,
    nextLessonId: next ? String(next.id) : null,
    allDone: total > 0 && done === total,
  };
};

/** Percent derived from verified playback seconds when duration is known. */
export const verifiedWatchPercent = ({ seconds, percent, durationSec }) => {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const requested = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  const duration = Math.max(0, Number(durationSec) || 0);
  if (duration <= 0) return requested;
  const derived = Math.min(100, Math.max(0, Math.round((sec / duration) * 100)));
  return Math.min(requested, derived);
};

/** Public quiz never ships answer keys until the lesson is completed. */
export const publicQuiz = (quiz = [], { completed = false } = {}) => {
  if (!Array.isArray(quiz)) return [];
  return quiz.map((question) => ({
    q: question.q,
    options: Array.isArray(question.options) ? [...question.options] : [],
    ...(completed && question.answer !== undefined ? { answer: Number(question.answer) } : {}),
  }));
};

export const shapePublicLesson = (lesson, { completed = false, watch = null } = {}) => ({
  id: String(lesson.id),
  title: lesson.title,
  summary: lesson.summary ?? '',
  body: lesson.body ?? '',
  takeaways: Array.isArray(lesson.takeaways) ? lesson.takeaways : [],
  transcript: lesson.transcript ?? '',
  youtubeId: lesson.youtubeId ?? null,
  youtubeUrl: lesson.youtubeUrl ?? null,
  thumbnailUrl: lesson.thumbnailUrl ?? null,
  durationSec: Number(lesson.durationSec) || 0,
  quizCount: Array.isArray(lesson.quiz) ? lesson.quiz.length : 0,
  quiz: publicQuiz(lesson.quiz, { completed }),
  completed,
  watchPercent: Number(watch?.percent) || 0,
  watchSeconds: Number(watch?.seconds) || 0,
  sortOrder: Number(lesson.sortOrder) || 0,
});

export const isMilestone = (value) => TRAINING_MILESTONES.includes(String(value ?? ''));
