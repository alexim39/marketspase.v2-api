import { ValidationException } from '../../../shared/domain/AppError.js';
import { AUDIENCE_SCOPES, LEADERSHIP_LEVELS } from '../../community/domain/Post.entity.js';

export { AUDIENCE_SCOPES, LEADERSHIP_LEVELS };
export const RSVP_STATUSES = ['going', 'interested', 'declined'];
/** Event audiences — `members` restricts to one purpose-team (needs teamId). */
export const EVENT_SCOPES = [...AUDIENCE_SCOPES, 'members'];

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const text = (value, field, { min = 1, max = 2000 } = {}) => {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

const asDate = (value, field) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationException(`Invalid ${field}`);
  return d;
};

/** @param {{title,body,startsAt,endsAt,location,scope,teamId}} input (Zod-whitelisted) */
export const createEventEntity = (input) => {
  if (!EVENT_SCOPES.includes(input.scope)) throw new ValidationException('Invalid audience');
  const startsAt = asDate(input.startsAt, 'startsAt');
  let endsAt = null;
  if (input.endsAt !== undefined && input.endsAt !== null && String(input.endsAt).trim() !== '') {
    endsAt = asDate(input.endsAt, 'endsAt');
    if (endsAt <= startsAt) throw new ValidationException('Event end must be after its start');
  }
  let teamId = null;
  if (input.scope === 'members') {
    teamId = String(input.teamId ?? '').trim();
    if (!OBJECT_ID_RE.test(teamId)) throw new ValidationException('Team events need a team');
  }
  return {
    title: text(input.title, 'title', { min: 2, max: 120 }),
    body: text(input.body, 'event details'),
    startsAt,
    endsAt,
    location: input.location === undefined || input.location === null
      ? ''
      : String(input.location).trim().slice(0, 200),
    scope: input.scope,
    teamId,
  };
};

/** @param {unknown} value */
export const assertRsvpStatus = (value) => {
  if (!RSVP_STATUSES.includes(value)) throw new ValidationException('Invalid RSVP status');
  return value;
};
