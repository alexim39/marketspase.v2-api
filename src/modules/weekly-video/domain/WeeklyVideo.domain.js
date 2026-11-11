import { ValidationException } from '../../../shared/domain/AppError.js';

export const WEEKLY_VIDEO_STATUSES = Object.freeze(['draft', 'scheduled', 'published', 'archived']);
export const WEEKLY_VIDEO_COMMENT_STATUSES = Object.freeze(['visible', 'hidden']);
export const DEFAULT_COMPLETION_PERCENT = 90;
export const MAX_CREDIT_GAP_SECONDS = 30;
export const MAX_PLAYBACK_RATE = 2.5;
export const SEEK_TOLERANCE_SECONDS = 3;
export const MIN_HEARTBEAT_GAP_MS = 2000;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const completionPercent = (value = process.env.WEEKLY_VIDEO_COMPLETION_PERCENT) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_COMPLETION_PERCENT;
  return clamp(n, 50, 100);
};

export const notifyCap = (value = process.env.WEEKLY_VIDEO_NOTIFY_CAP) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5000;
  return clamp(Math.round(n), 1, 20000);
};

const parseDateOnly = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ValidationException('Invalid week starting date');
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    throw new ValidationException('Week starting date must be a date');
  }
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new ValidationException('Invalid week starting date');
  return date;
};

/** Normalise any date to the Monday of its week, as YYYY-MM-DD (UTC calendar). */
export const normalizeWeekStart = (value) => {
  const date = parseDateOnly(value);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

export const weekEndFor = (weekStart) => {
  const date = new Date(`${normalizeWeekStart(weekStart)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
};

export const currentWeekStart = (now = new Date()) => {
  // Nigeria is UTC+1 with no daylight saving. Shift before taking the UTC
  // calendar date so Monday 00:30 WAT is already the new week.
  const wat = new Date(now.getTime() + 60 * 60 * 1000);
  return normalizeWeekStart(wat);
};

export const weekLabel = (weekStart) => {
  const start = new Date(`${normalizeWeekStart(weekStart)}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
};

/**
 * Credit only time the viewer actually played. A forward jump larger than the
 * wall-clock gap allows (2.5x for fast playback) is treated as a seek and earns
 * nothing. Pausing or backgrounding the tab stops credit.
 */
export const applyHeartbeat = ({
  watchedSeconds = 0,
  lastPositionSeconds = 0,
  durationSeconds,
  lastHeartbeatAt = null,
  now = new Date(),
  positionSeconds = 0,
  playing = false,
  visible = true,
  percentRequired = completionPercent(),
} = {}) => {
  const duration = Math.max(Number(durationSeconds) || 0, 0);
  const position = clamp(Number(positionSeconds) || 0, 0, duration || Number.MAX_SAFE_INTEGER);
  const previous = clamp(Number(lastPositionSeconds) || 0, 0, duration || Number.MAX_SAFE_INTEGER);
  const previousWatched = Math.max(Number(watchedSeconds) || 0, 0);
  const nowDate = now instanceof Date ? now : new Date(now);
  const previousAt = lastHeartbeatAt ? new Date(lastHeartbeatAt) : null;
  const elapsed = previousAt && !Number.isNaN(previousAt.getTime())
    ? clamp((nowDate.getTime() - previousAt.getTime()) / 1000, 0, MAX_CREDIT_GAP_SECONDS)
    : 0;
  let credit = 0;

  if (duration > 0 && playing && visible && elapsed > 0) {
    const delta = position - previous;
    const maximum = elapsed * MAX_PLAYBACK_RATE + SEEK_TOLERANCE_SECONDS;
    if (delta > 0 && delta <= maximum) {
      credit = Math.min(delta, Math.max(duration - previousWatched, 0));
    }
  }

  const nextWatched = duration > 0
    ? clamp(previousWatched + credit, 0, duration)
    : previousWatched + credit;
  const percent = duration > 0 ? clamp((nextWatched / duration) * 100, 0, 100) : 0;
  return {
    watchedSeconds: round(nextWatched),
    lastPositionSeconds: round(position),
    percent: round(percent),
    credit: round(credit),
    completed: duration > 0 && percent >= percentRequired,
  };
};

const committedAtFor = (progress) => {
  if (!progress?.completedAt || !progress?.reflectionAt) return null;
  const completed = new Date(progress.completedAt).getTime();
  const reflected = new Date(progress.reflectionAt).getTime();
  if (!Number.isFinite(completed) || !Number.isFinite(reflected)) return null;
  return Math.max(completed, reflected);
};

/**
 * Weekly commitment = watched to completion + reflection submitted before the
 * next weekly video is published. Late catch-up learning still counts for
 * completion totals, but it does not repair a broken streak.
 */
export const computeEngagement = ({
  videos = [],
  progress = [],
  now = new Date(),
  percentRequired = completionPercent(),
} = {}) => {
  const progressByVideo = new Map(progress.map((row) => [String(row.videoId ?? row.video?._id ?? row.video), row]));
  const ordered = [...videos].sort((a, b) => {
    const week = String(a.weekStart ?? '').localeCompare(String(b.weekStart ?? ''));
    if (week !== 0) return week;
    return new Date(a.publishedAt ?? a.createdAt ?? 0).getTime() - new Date(b.publishedAt ?? b.createdAt ?? 0).getTime();
  });
  const nowDate = now instanceof Date ? now : new Date(now);
  const currentWeek = currentWeekStart(nowDate);
  const onTime = new Map();
  const committed = new Map();

  for (let index = 0; index < ordered.length; index += 1) {
    const video = ordered[index];
    const row = progressByVideo.get(String(video.id ?? video._id));
    const doneAt = committedAtFor(row);
    committed.set(String(video.id ?? video._id), Boolean(doneAt));
    if (!doneAt) {
      onTime.set(String(video.id ?? video._id), false);
      continue;
    }
    const next = ordered[index + 1] ?? null;
    const deadline = next?.publishedAt ? new Date(next.publishedAt).getTime() : nowDate.getTime();
    onTime.set(String(video.id ?? video._id), doneAt <= deadline);
  }

  const descending = [...ordered].reverse();
  const newest = descending[0] ?? null;
  const newestId = newest ? String(newest.id ?? newest._id) : '';
  const newestPending = Boolean(newest && newest.weekStart === currentWeek && !committed.get(newestId));
  const start = newestPending ? 1 : 0;
  let currentStreak = 0;
  if (newest && (newestPending || onTime.get(newestId))) {
    for (let index = start; index < descending.length; index += 1) {
      const id = String(descending[index].id ?? descending[index]._id);
      if (!onTime.get(id)) break;
      currentStreak += 1;
    }
  }

  let bestStreak = 0;
  let running = 0;
  for (const video of ordered) {
    const id = String(video.id ?? video._id);
    if (onTime.get(id)) {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
  }

  let totalCompleted = 0;
  let totalReflections = 0;
  for (const row of progress) {
    if (row?.completedAt) totalCompleted += 1;
    if (row?.reflectionAt) totalReflections += 1;
  }
  const publishedCount = ordered.length;
  const completionRate = publishedCount > 0 ? round((totalCompleted / publishedCount) * 100) : 0;
  const latestRow = newest ? progressByVideo.get(newestId) : null;
  const latestCommitted = newest ? committed.get(newestId) === true : false;

  return {
    currentWeek,
    publishedCount,
    totalCompleted,
    totalReflections,
    completionRate,
    currentStreak,
    bestStreak,
    currentWeekCommitted: latestCommitted,
    currentWeekPending: newestPending,
    currentVideoId: newestId || null,
    currentVideoCompleted: Boolean(latestRow?.completedAt),
    currentVideoReflected: Boolean(latestRow?.reflectionAt),
    completionPercent: percentRequired,
  };
};

export const normalizeCommentBody = (value) => {
  const body = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (body.length < 20) throw new ValidationException('Write at least 20 characters about what you learned');
  if (body.length > 1000) throw new ValidationException('Reflection must be 1000 characters or fewer');
  return body;
};

/** Stable cursor for the newest-first reflection list. */
export const encodeCommentCursor = ({ createdAt, id } = {}) => {
  const date = new Date(createdAt);
  const value = String(id ?? '');
  if (Number.isNaN(date.getTime()) || !/^[a-fA-F0-9]{24}$/.test(value)) {
    throw new ValidationException('Invalid comment cursor');
  }
  return Buffer.from(`${date.toISOString()}|${value}`, 'utf8').toString('base64url');
};

export const decodeCommentCursor = (value) => {
  if (!value) return null;
  try {
    const decoded = Buffer.from(String(value), 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator < 0) throw new Error('missing separator');
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !/^[a-fA-F0-9]{24}$/.test(id)) {
      throw new Error('invalid cursor');
    }
    return { createdAt, id };
  } catch {
    throw new ValidationException('Invalid comments cursor');
  }
};
