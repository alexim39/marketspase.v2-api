import { ValidationException } from '../../../shared/domain/AppError.js';

export const POST_KINDS = ['standard', 'announcement', 'recognition', 'training', 'event'];
export const POST_KIND_LABELS = {
  standard: 'Post',
  announcement: 'Announcement',
  recognition: 'Recognition',
  training: 'Training',
  event: 'Event',
};
export const AUDIENCE_SCOPES = ['global', 'team', 'leadership'];
export const LEADERSHIP_LEVELS = ['ecl', 'cell_leader', 'g_leader', 'g8'];

const text = (value, field, { min = 1, max = 2000 } = {}) => {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

/** Posts support images plus short video clips (comments stay text). */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const ATTACHMENT_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES];
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Transport cap (multer/Zod); per-type caps are enforced in the entity. */
export const MAX_ATTACHMENT_BYTES = MAX_VIDEO_BYTES;
const ATTACHMENT_URL_RE = /^(?:\/uploads\/community\/[A-Za-z0-9_.-]+|https:\/\/[^\s]+)$/;

/** @param {unknown} value (already Zod-shaped, defense in depth) */
export const createAttachmentEntities = (value) => {
  const list = value ?? [];
  if (!Array.isArray(list)) throw new ValidationException('Invalid attachments');
  if (list.length > MAX_ATTACHMENTS) throw new ValidationException(`At most ${MAX_ATTACHMENTS} photos or videos per post`);
  return list.map((a) => {
    if (!a || typeof a !== 'object') throw new ValidationException('Invalid attachment');
    if (!ATTACHMENT_URL_RE.test(String(a.url ?? ''))) throw new ValidationException('Invalid attachment url');
    if (!ATTACHMENT_MIMES.includes(a.mime)) throw new ValidationException('Invalid attachment type');
    const maxBytes = String(a.mime).startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const size = Number(a.size);
    if (!Number.isInteger(size) || size < 1 || size > maxBytes) {
      throw new ValidationException('Invalid attachment size');
    }
    return { url: String(a.url), mime: a.mime, size };
  });
};

/** @param {{kind,title,body,link,scope,attachments}} input (Zod-whitelisted) */
export const createPostEntity = (input) => {
  if (!POST_KINDS.includes(input.kind)) throw new ValidationException('Invalid post kind');
  if (!AUDIENCE_SCOPES.includes(input.scope)) throw new ValidationException('Invalid audience');
  const link = input.link === undefined || input.link === null || String(input.link).trim() === ''
    ? ''
    : text(input.link, 'link', { max: 500 });
  return {
    kind: input.kind,
    title: input.title === undefined || input.title === null || String(input.title).trim() === ''
      ? ''
      : text(input.title, 'title', { min: 2, max: 120 }),
    body: text(input.body, 'post body'),
    link,
    scope: input.scope,
    attachments: createAttachmentEntities(input.attachments),
  };
};

/** @param {{body,parentId}} input (Zod-whitelisted) */
export const createCommentEntity = (input) => ({
  body: text(input.body, 'comment body', { max: 1000 }),
});

/**
 * Pure @mention extraction — unique lowercase usernames in order.
 * Stored for future push; the UI highlights them from body text today.
 */
export const extractMentions = (body) => {
  const out = [];
  const seen = new Set();
  for (const m of String(body ?? '').matchAll(/@([A-Za-z0-9_.]{2,40})/g)) {
    const handle = m[1].toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
};
