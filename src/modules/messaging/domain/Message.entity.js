import { ValidationException } from '../../../shared/domain/AppError.js';

export const MESSAGE_KINDS = ['direct', 'announcement', 'broadcast', 'team'];
export const ANNOUNCE_SCOPES = ['direct', 'all'];

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const text = (value, field, { min = 1, max = 2000 } = {}) => {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

/** @param {{to, body}} input (Zod-whitelisted) */
export const createDirectEntity = (input) => ({
  body: text(input.body, 'message body'),
});

/** @param {{title, body, scope}} input (Zod-whitelisted) */
export const createAnnouncementEntity = (input) => {
  if (!ANNOUNCE_SCOPES.includes(input.scope)) throw new ValidationException('Invalid announcement scope');
  return {
    title: text(input.title, 'title', { min: 2, max: 120 }),
    body: text(input.body, 'message body'),
    scope: input.scope,
  };
};

/** @param {{teamId, title, body}} input (Zod-whitelisted) */
export const createTeamAnnouncementEntity = (input) => {
  const teamId = String(input.teamId ?? '').trim();
  if (!OBJECT_ID_RE.test(teamId)) throw new ValidationException('Invalid team');
  return {
    teamId,
    title: text(input.title, 'title', { min: 2, max: 120 }),
    body: text(input.body, 'message body'),
  };
};
