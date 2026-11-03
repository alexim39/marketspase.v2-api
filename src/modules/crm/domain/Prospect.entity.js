import { ValidationException } from '../../../shared/domain/AppError.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PartnerId = {
  create(value) {
    const v = String(value ?? '').trim();
    if (!OBJECT_ID_RE.test(v)) throw new ValidationException('Invalid partnerId');
    return v;
  },
};

const text = (value, field, { min = 1, max = 200, optional = false } = {}) => {
  if ((value === undefined || value === null || value === '') && optional) return undefined;
  const v = String(value ?? '').trim();
  if (v.length < min || v.length > max) throw new ValidationException(`Invalid ${field}`);
  return v;
};

const optDate = (value, field) => {
  if (value === undefined || value === null || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationException(`Invalid ${field}`);
  return d;
};

export const normalizePhone = (value) => {
  const raw = String(value ?? '').trim().replace(/[\s\-\(\)]/g, '');
  if (raw.startsWith('+234')) return '0' + raw.slice(4);
  if (raw.startsWith('234')) return '0' + raw.slice(3);
  return raw;
};

/** Contact-list enrichment vocab (fixed tag set — free text fragments reporting). */
export const RELATIONSHIP_TAGS = ['Family', 'Friend', 'Colleague', 'Church', 'Neighbour', 'Referral', 'Other'];
export const CONTACT_PRIORITIES = ['high', 'normal'];

/** Value Object: prospect contact core. */
export const createProspectEntity = (input) => {
  if (!input || typeof input !== 'object') throw new ValidationException('Invalid prospect data');
  const email = input.prospectEmail === undefined || input.prospectEmail === null || input.prospectEmail === ''
    ? undefined
    : String(input.prospectEmail).trim().toLowerCase();
  if (email !== undefined && (!EMAIL_RE.test(email) || email.length > 254)) {
    throw new ValidationException('Invalid prospectEmail');
  }
  return {
    prospectName: text(input.prospectName, 'prospectName', { min: 2, max: 80 }),
    prospectSurname: text(input.prospectSurname, 'prospectSurname', { min: 1, max: 80, optional: true }),
    prospectPhone: normalizePhone(text(input.prospectPhone, 'prospectPhone', { min: 7, max: 20 })),
    prospectEmail: email,
    prospectSource: text(input.prospectSource, 'prospectSource', { min: 2, max: 120 }),
    relationship: RELATIONSHIP_TAGS.includes(input.relationship) ? input.relationship : 'Other',
    priority: CONTACT_PRIORITIES.includes(input.priority) ? input.priority : 'normal',
    bestTimeToCall: String(input.bestTimeToCall ?? '').trim().slice(0, 120),
    consentToContact: input.consentToContact === true,
    notes: String(input.notes ?? '').trim().slice(0, 2000),
    partnerId: PartnerId.create(input.partnerId),
    ...(input.surverId !== undefined && input.surverId !== null && input.surverId !== ''
      ? { surverId: String(input.surverId) }
      : {}),
    // Optional campaign attribution — shape-checked here as an ObjectId;
    // ownership is enforced in the create use case.
    ...(() => {
      if (input.campaignId === undefined || input.campaignId === null || input.campaignId === '') return {};
      const v = String(input.campaignId).trim();
      if (!OBJECT_ID_RE.test(v)) throw new ValidationException('Invalid campaignId');
      return { campaignId: v };
    })(),
    // Embedded survey snapshot (copied survey data) passes through untouched.
    ...(input.survey !== undefined ? { survey: input.survey } : {}),
  };
};

export const COMMUNICATION_TYPES = ['call', 'email', 'text', 'zoom', 'whatsapp', 'presentation'];
export const INTEREST_LEVELS = ['hot', 'warm', 'cold'];
export const COMMUNICATION_OUTCOMES = ['Connected', 'No answer', 'Booked session', 'Follow-up set', 'Closed-lost'];

/** Value Object: a single communication log entry. */
export const createCommunicationEntity = (input) => {
  if (!input || typeof input !== 'object') throw new ValidationException('Invalid communication data');
  if (!COMMUNICATION_TYPES.includes(input.type)) throw new ValidationException('Invalid communication type');
  if (!INTEREST_LEVELS.includes(input.interestLevel)) throw new ValidationException('Invalid interestLevel');
  // Legacy compat: topicsDiscussed may arrive as a CSV string.
  const topics = Array.isArray(input.topicsDiscussed)
    ? input.topicsDiscussed.map(String)
    : typeof input.topicsDiscussed === 'string' && input.topicsDiscussed.trim() !== ''
      ? input.topicsDiscussed.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
  const duration = input.duration === undefined || input.duration === null || input.duration === ''
    ? 0
    : Number.parseInt(input.duration, 10);
  if (!Number.isInteger(duration) || duration < 0) throw new ValidationException('Invalid duration');
  return {
    type: input.type,
    interestLevel: input.interestLevel,
    date: optDate(input.date, 'date') ?? new Date(),
    duration,
    description: text(input.description, 'description', { min: 3, max: 5000 }),
    followUpAction: input.followUpAction === undefined ? 'To be determined' : String(input.followUpAction).slice(0, 500),
    followUpDate: optDate(input.followUpDate, 'followUpDate'),
    ...(COMMUNICATION_OUTCOMES.includes(input.outcome) ? { outcome: input.outcome } : {}),
    // Author attribution (owner vs upline support) — free-form passthrough,
    // trimmed and bounded; absent on legacy entries and old clients.
    ...(input.createdBy !== undefined && input.createdBy !== null && String(input.createdBy).trim() !== ''
      ? { createdBy: String(input.createdBy).trim().slice(0, 40) }
      : {}),
    ...(input.createdByName !== undefined && input.createdByName !== null && String(input.createdByName).trim() !== ''
      ? { createdByName: String(input.createdByName).trim().slice(0, 120) }
      : {}),
    topicsDiscussed: topics,
    documentsShared: Array.isArray(input.documentsShared) ? input.documentsShared.map(String) : [],
    status: input.status === 'Closed' ? 'Closed' : 'Open',
  };
};

export const PROSPECT_STATUSES = ['Open', 'Closed'];

/**
 * Canonical pipeline (Phase A lead management). Stored as `status.stage`
 * alongside the legacy free-text `status.name` — old documents simply
 * have no stage until advanced. Terminal: Converted | Closed.
 */
export const PROSPECT_STAGES = [
  'New',
  'Contacted',
  'Interested',
  'In Negotiation',
  'Converted',
  'Closed',
];

/**
 * Value Object: status overlay — only provided keys change (dotted $set).
 * Legacy REPLACED the whole subdoc, silently dropping `status: Open/Closed`.
 * Every stage advance stamps `stageEnteredAt` (stuck-in-pipeline clock).
 */
export const createStatusOverlay = (input, now = new Date()) => {
  if (!input || typeof input !== 'object') throw new ValidationException('Invalid status data');
  const overlay = {};
  if (input.name !== undefined) overlay.name = text(input.name, 'status name', { min: 2, max: 120 });
  if (input.note !== undefined) overlay.note = String(input.note).slice(0, 2000);
  for (const key of ['paydayDate', 'expectedDecisionDate', 'onboardingDate']) {
    const d = optDate(input[key], key);
    if (d !== undefined) overlay[key] = d;
  }
  if (input.status !== undefined) {
    if (!PROSPECT_STATUSES.includes(input.status)) throw new ValidationException('Invalid status flag');
    overlay.status = input.status;
  }
  if (input.stage !== undefined) {
    if (!PROSPECT_STAGES.includes(input.stage)) throw new ValidationException('Invalid pipeline stage');
    overlay.stage = input.stage;
    overlay.stageEnteredAt = now instanceof Date ? now : new Date(now);
  }
  if (Object.keys(overlay).length === 0) throw new ValidationException('Nothing to update');
  return overlay;
};
