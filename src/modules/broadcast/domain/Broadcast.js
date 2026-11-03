import { ValidationException } from '../../../shared/domain/AppError.js';

/** Max recipients per send — bounds the fan-out write burst. */
export const BROADCAST_CAP = 5000;

const text = (v, field, { min = 1, max = 2000 } = {}) => {
  const s = String(v ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

/** Pure input factory — throws on bad shape before anything is stored. */
export const createBroadcastInput = (input) => ({
  title: text(input?.title, 'title', { min: 3, max: 140 }),
  body: text(input?.body, 'body', { min: 3, max: 2000 }),
  link: input?.link === undefined || input?.link === null || String(input.link).trim() === ''
    ? null
    : text(input.link, 'link', { min: 2, max: 500 }),
  priority: ['high', 'medium'].includes(input?.priority) ? input.priority : 'high',
});

/** Multi-channel campaigns (v2) — audience + channels + schedule. */
export const BROADCAST_CHANNELS = Object.freeze(['inApp', 'email', 'sms']);
export const BROADCAST_KINDS = Object.freeze(['system', 'marketing']);
export const BROADCAST_AUDIENCES = Object.freeze(['all', 'segment', 'picked']);

/**
 * Gateway unit cost (₦) used ONLY for the admin confirm-screen estimate.
 * Partner billing stays on SMS_CHARGE_PER_PAGE; broadcasts are
 * platform-funded, so the estimate shows true gateway spend.
 */
export const SMS_GATEWAY_UNIT_NGN = 6.49;
/** SMS body cap — matches the outreach composer (3 GSM pages). */
export const BROADCAST_SMS_MAX = 459;

const bool = (v) => v === true;
const isoDate = (v, field) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationException(`Invalid ${field}`);
  return d;
};

/** Audience spec — pure; the resolver turns it into a member list. */
export const createAudienceInput = (input = {}) => {
  const mode = BROADCAST_AUDIENCES.includes(input?.mode) ? input.mode : 'all';
  const seg = input?.segment ?? {};
  const segment = {
    role: seg.role === undefined || seg.role === null || String(seg.role).trim() === ''
      ? null
      : String(seg.role).trim().slice(0, 40),
    active: seg.active === undefined || seg.active === null || seg.active === '' ? null : bool(seg.active),
    excludeSuspended: seg.excludeSuspended === undefined ? true : bool(seg.excludeSuspended),
    joinedAfter: isoDate(seg.joinedAfter, 'joinedAfter'),
    joinedBefore: isoDate(seg.joinedBefore, 'joinedBefore'),
  };
  const ids = Array.isArray(input?.ids)
    ? [...new Set(input.ids.map((id) => String(id ?? '').trim()).filter((id) => /^[a-fA-F0-9]{24}$/.test(id)))].slice(0, BROADCAST_CAP + 1)
    : [];
  if (mode === 'picked' && ids.length === 0) throw new ValidationException('Pick at least one member');
  return { mode, segment, ids };
};

/** Full campaign input — title/body/link shared with v1 in-app semantics. */
export const createCampaignInput = (input = {}) => {
  const base = createBroadcastInput(input);
  const channels = {
    inApp: input?.channels === undefined ? true : bool(input.channels.inApp),
    email: input?.channels === undefined ? false : bool(input.channels.email),
    sms: input?.channels === undefined ? false : bool(input.channels.sms),
  };
  if (!channels.inApp && !channels.email && !channels.sms) {
    throw new ValidationException('Enable at least one channel');
  }
  const kind = BROADCAST_KINDS.includes(input?.kind) ? input.kind : 'system';
  const subject = input?.subject === undefined || input?.subject === null || String(input.subject).trim() === ''
    ? base.title
    : text(input.subject, 'subject', { min: 3, max: 120 });
  const smsBody = input?.smsBody === undefined || input?.smsBody === null || String(input.smsBody).trim() === ''
    ? `${base.title}\n${base.body}`.slice(0, BROADCAST_SMS_MAX)
    : text(input.smsBody, 'smsBody', { min: 3, max: BROADCAST_SMS_MAX });
  const sendAt = isoDate(input?.sendAt, 'sendAt');
  if (sendAt && sendAt.getTime() <= Date.now()) throw new ValidationException('Scheduled time must be in the future');
  if (sendAt && sendAt.getTime() - Date.now() > 30 * 86400000) {
    throw new ValidationException('Scheduled time must be within 30 days');
  }
  return {
    ...base,
    subject,
    smsBody,
    channels,
    kind,
    audience: createAudienceInput(input?.audience),
    sendAt,
  };
};

export const smsPages = (body) => Math.max(1, Math.ceil(String(body ?? '').length / 160));

/** Gateway-spend estimate for the confirm screen (₦, 2dp). */
export const estimateSmsSpend = (recipients, smsBody) =>
  Math.round(Number(recipients) * smsPages(smsBody) * SMS_GATEWAY_UNIT_NGN * 100) / 100;
