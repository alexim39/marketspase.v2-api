import { normalizePhone, smsBody } from '../../notifications/domain/Delivery.js';

export const SMS_PRICE_PER_PAGE = 10;
export const SMS_PAGE_CHARS = 160;
export const SMS_MAX_CHARS = 459;
export const SMS_MAX_PAGES = 3;
export const SMS_MAX_RECIPIENTS = 500;

export const cleanSmsBody = (body) => smsBody('', body);

export const smsPages = (body) => Math.max(1, Math.ceil(cleanSmsBody(body).length / SMS_PAGE_CHARS));

export const smsCost = (body, recipients) =>
  Math.max(0, Number(recipients) || 0) * smsPages(body) * SMS_PRICE_PER_PAGE;

export const personalise = (body, context = {}) => {
  const values = {
    first_name: context.firstName ?? 'there',
    full_name: context.fullName ?? context.firstName ?? 'there',
    my_name: context.myName ?? 'your MarketSpase partner',
    store_link: context.storeLink ?? '',
    lead_page: context.leadPage ?? '',
  };
  return String(body ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const value = values[String(key).toLowerCase()];
    return value === undefined ? match : String(value);
  });
};

/**
 * A recipient's final message. Personalisation runs first so the provider
 * never receives an unreplaced token, then the shared normaliser trims to the
 * 3-page cap. Pricing uses this rendered text, not the template, because a
 * long name can turn one page into two.
 */
export const renderedSms = (body, context = {}) => cleanSmsBody(personalise(body, context));

const firstNameOf = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

const daysSince = (value, now = Date.now()) => {
  const at = new Date(value ?? 0).getTime();
  if (!Number.isFinite(at) || at <= 0) return null;
  return Math.max(0, Math.floor((now - at) / 86400000));
};

const lastCommunication = (prospect) => {
  const rows = Array.isArray(prospect?.communications) ? prospect.communications : [];
  return [...rows].sort((a, b) => new Date(b?.date ?? 0).getTime() - new Date(a?.date ?? 0).getTime())[0] ?? null;
};

/** Context the sender/executor uses for tokens and activity-aware suggestions. */
export const recipientContext = (type, doc, actor = {}) => {
  if (type === 'prospect') {
    const stage = doc?.status?.stage ?? 'New';
    const last = lastCommunication(doc);
    return {
      firstName: firstNameOf(doc?.prospectName),
      fullName: `${doc?.prospectName ?? ''} ${doc?.prospectSurname ?? ''}`.trim(),
      myName: actor.name ?? 'your MarketSpase partner',
      storeLink: actor.storeLink ?? '',
      leadPage: actor.leadPage ?? '',
      stage,
      relationship: doc?.relationship ?? 'Prospect',
      priority: doc?.priority ?? 'normal',
      daysInStage: daysSince(doc?.status?.stageEnteredAt ?? doc?.updatedAt ?? doc?.createdAt),
      lastTouchAt: last?.date ?? null,
      followUpDate: last?.followUpDate ?? null,
      consent: doc?.consentToContact === true,
      phone: doc?.prospectPhone ?? '',
    };
  }
  return {
    firstName: firstNameOf(doc?.name),
    fullName: `${doc?.name ?? ''} ${doc?.surname ?? ''}`.trim(),
    myName: actor.name ?? 'your MarketSpase partner',
    storeLink: actor.storeLink ?? '',
    leadPage: actor.leadPage ?? '',
    stage: doc?.accountState ?? 'member',
    rank: doc?.commissionRank ?? 'Partner',
    activated: Boolean(doc?.activatedAt),
    lastSeenDays: daysSince(doc?.lastSeenAt),
    joinedDays: daysSince(doc?.createdAt),
    phone: doc?.phone ?? '',
  };
};

const suggestion = (intent, label, body) => ({ intent, label, body: cleanSmsBody(body) });

export const suggestionsForProspect = (prospect, actor = {}, now = Date.now()) => {
  const ctx = recipientContext('prospect', prospect, actor);
  const stage = String(ctx.stage ?? 'New');
  const lastDays = daysSince(ctx.lastTouchAt, now);
  const overdue = ctx.followUpDate && new Date(ctx.followUpDate).getTime() < now;
  const rows = [];

  if (overdue) {
    rows.push(suggestion(
      'reminder',
      'Follow-up reminder',
      'Hi {{first_name}}, I promised to follow up with you today. Is now still a good time to continue our conversation? - {{my_name}}',
    ));
  }
  if (stage === 'New') {
    rows.push(suggestion(
      'follow_up',
      'Warm follow-up',
      'Hi {{first_name}}, it is {{my_name}}. I wanted to check in and see if you had a moment to look at what I shared. No pressure at all.',
    ));
    rows.push(suggestion(
      'invitation',
      'Invitation to look',
      'Hi {{first_name}}, I have something small I think could be useful for you. Would you be open to a quick look this week? - {{my_name}}',
    ));
  } else if (stage === 'Contacted' || stage === 'Interested') {
    rows.push(suggestion(
      'follow_up',
      lastDays !== null ? 'Gentle follow-up' : 'Keep the conversation going',
      'Hi {{first_name}}, just following up on our conversation. I would be happy to answer any questions you have. - {{my_name}}',
    ));
    rows.push(suggestion(
      'invitation',
      'Invite the next step',
      'Hi {{first_name}}, you mentioned this could be worth exploring. I can help you take the next step whenever you are ready. - {{my_name}}',
    ));
  } else if (stage === 'In Negotiation') {
    rows.push(suggestion(
      'invitation',
      'Ready to join',
      'Hi {{first_name}}, I have kept your place in mind. When you are ready, I can help you finish your registration and get started. - {{my_name}}',
    ));
    rows.push(suggestion(
      'follow_up',
      'Clear the blocker',
      'Hi {{first_name}}, is there anything still unclear about joining? Tell me what is on your mind and I will help you sort it out. - {{my_name}}',
    ));
  } else if (stage === 'Converted') {
    rows.push(suggestion(
      'welcome',
      'Welcome check-in',
      'Hi {{first_name}}, welcome to the team. I am checking in to make sure you have everything you need for your first steps. - {{my_name}}',
    ));
    rows.push(suggestion(
      'reminder',
      'First-week reminder',
      'Hi {{first_name}}, a quick reminder to complete your first training step. Reply if you need help finding it. - {{my_name}}',
    ));
  } else {
    rows.push(suggestion(
      'follow_up',
      'Reconnect',
      'Hi {{first_name}}, it has been a while. I wanted to check in and see how you are doing. - {{my_name}}',
    ));
  }
  return rows.slice(0, 3);
};

export const suggestionsForPartner = (partner, actor = {}, now = Date.now()) => {
  const ctx = recipientContext('partner', partner, actor);
  const rows = [];
  if (!ctx.activated) {
    rows.push(suggestion(
      'activation',
      'Activation reminder',
      'Hi {{first_name}}, this is {{my_name}}. I noticed you have not completed activation yet. Reply if you want help with the next step.',
    ));
    rows.push(suggestion(
      'follow_up',
      'Welcome follow-up',
      'Hi {{first_name}}, welcome again. Do you have any questions about getting started? I am happy to help. - {{my_name}}',
    ));
  } else {
    rows.push(suggestion(
      'follow_up',
      'Team check-in',
      'Hi {{first_name}}, checking in on your first steps. Is there anything you need help with this week? - {{my_name}}',
    ));
    rows.push(suggestion(
      'reminder',
      'Training reminder',
      'Hi {{first_name}}, a quick reminder to keep your training moving this week. Reply if you want me to point you to the next lesson. - {{my_name}}',
    ));
    rows.push(suggestion(
      'invitation',
      'Invite to connect',
      'Hi {{first_name}}, I would like to catch up and hear how things are going. When is a good time for a quick chat? - {{my_name}}',
    ));
  }
  return rows.slice(0, 3);
};

export const isPartnerSmsEnabled = (partner) => {
  // `prefer_not_now` is the member's explicit "do not contact me" choice.
  // Notification-channel prefs are for platform broadcasts, not a mentor's
  // direct SMS, so they must not silently exclude the whole downline.
  if (partner?.mentorContactPreference === 'prefer_not_now') return false;
  if (partner?.settings?.notification?.receive === 'off') return false;
  return true;
};

export const normalizeRecipientPhone = (phone) => normalizePhone(phone);
