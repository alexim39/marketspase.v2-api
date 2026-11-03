import { ValidationException } from '../../../shared/domain/AppError.js';

/** The 12 spec categories — stable enum, never renamed once shipped. */
export const NOTIFICATION_CATEGORIES = [
  'daily', 'prospect', 'progression', 'promotion', 'team', 'goals',
  'training', 'community', 'recognition', 'commission', 'marketing', 'system',
];

export const CATEGORY_LABELS = {
  daily: 'Daily actions',
  prospect: 'Prospects',
  progression: 'Progression',
  promotion: 'Promotions',
  team: 'Team',
  goals: 'Goals',
  training: 'Training',
  community: 'Community',
  recognition: 'Recognition',
  commission: 'Commissions',
  marketing: 'Marketing',
  system: 'System',
};

export const NOTIFICATION_PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const EMAIL_DIGESTS = ['immediate', 'daily', 'weekly', 'off'];

const text = (value, field, { min = 1, max = 2000 } = {}) => {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

/**
 * @param {{category,priority,title,body,icon,link,key}} input (producer-supplied)
 * `key` is the optional idempotency key (e.g. `daily:<day>:p1`) — when
 * present the unique (recipientId, key) index + NotifyUseCase turn
 * concurrent reruns into a harmless dedupe instead of a double send.
 */
export const createNotificationEntity = (input) => {
  if (!NOTIFICATION_CATEGORIES.includes(input.category)) throw new ValidationException('Invalid notification category');
  if (!NOTIFICATION_PRIORITIES.includes(input.priority)) throw new ValidationException('Invalid notification priority');
  const entity = {
    category: input.category,
    priority: input.priority,
    title: text(input.title, 'title', { min: 2, max: 120 }),
    body: text(input.body, 'body'),
    icon: String(input.icon ?? 'notifications').slice(0, 40) || 'notifications',
    link: input.link === undefined || input.link === null ? null : String(input.link).slice(0, 500) || null,
  };
  if (input.key !== undefined && input.key !== null && String(input.key).trim() !== '') {
    entity.key = text(input.key, 'key', { min: 1, max: 120 }).replace(/\s+/g, '');
  }
  return entity;
};

const DEFAULT_CHANNELS = { inApp: true, email: false, sms: false, push: false };

/** Full preference matrix with per-category channel flags. */
export const defaultPreferences = () => ({
  channels: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, { ...DEFAULT_CHANNELS }])),
  emailDigest: 'immediate',
});

/**
 * Merge stored prefs over defaults — unknown categories dropped, so the
 * matrix stays valid as categories evolve.
 */
export const resolvePreferences = (stored) => {
  const base = defaultPreferences();
  const channels = stored?.channels && typeof stored.channels === 'object' ? stored.channels : {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    const row = channels[cat];
    if (row && typeof row === 'object') {
      base.channels[cat] = {
        inApp: row.inApp !== false,
        email: row.email === true,
        sms: row.sms === true,
        push: row.push === true,
      };
    }
  }
  if (EMAIL_DIGESTS.includes(stored?.emailDigest)) base.emailDigest = stored.emailDigest;
  return base;
};

/** @param {{channels, emailDigest}} input (Zod-whitelisted) */
export const createPreferencesEntity = (input) => {
  const resolved = resolvePreferences(input);
  // Round-trip through defaults so only known categories persist.
  return resolved;
};
