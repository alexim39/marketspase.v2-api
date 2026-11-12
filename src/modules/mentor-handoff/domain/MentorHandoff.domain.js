export const MENTOR_CONTACT_PREFERENCES = Object.freeze([
  'in_app',
  'email',
  'whatsapp',
  'phone',
  'prefer_not_now',
]);

export const MENTOR_CONTACT_LABELS = Object.freeze({
  in_app: 'In-app chat',
  email: 'Email',
  whatsapp: 'WhatsApp',
  phone: 'Phone call',
  prefer_not_now: 'Prefer not to be contacted yet',
});

/** Five approved intro messages. No free-form mentor drafting in phase 1. */
export const MENTOR_HANDOFF_TEMPLATES = Object.freeze([
  {
    key: 'welcome_first_step',
    label: 'Warm welcome + first step',
    subject: 'Welcome to the team — your first step',
    body: 'Hi {{memberName}}, I’m {{mentorName}}, your MarketSpase mentor. Welcome to the team. Your first step is to complete your profile and start the IPO course. When you’re ready, reply here and I’ll help you with the next step.',
  },
  {
    key: 'quick_checkin',
    label: 'Quick check-in',
    subject: 'Just checking in',
    body: 'Hi {{memberName}}, just checking in. Have you been able to open the Academy yet? If anything is unclear, reply here and I’ll walk you through it.',
  },
  {
    key: 'activation_help',
    label: 'Activation help',
    subject: 'I’m here to help you settle in',
    body: 'Hi {{memberName}}, I’m here to help you settle in. Your next step is to finish your profile and start the IPO course. Reply here if you’d like me to go through it with you.',
  },
  {
    key: 'first_week_plan',
    label: 'First-week plan',
    subject: 'Your first week on MarketSpase',
    body: 'Hi {{memberName}}, welcome. In your first week, focus on three things: complete your profile, finish the IPO course, and add one person to your pipeline. I’m here if you need help.',
  },
  {
    key: 'no_pressure_call',
    label: 'No-pressure support',
    subject: 'No pressure — just a welcome',
    body: 'Hi {{memberName}}, no pressure at all — I just wanted to introduce myself. I’m {{mentorName}}, your mentor. Whenever you’re ready, reply here and we can take the first step together.',
  },
]);

export const findMentorHandoffTemplate = (key) => (
  MENTOR_HANDOFF_TEMPLATES.find((template) => template.key === String(key ?? '')) ?? null
);

export const renderMentorHandoffTemplate = (template, { memberName, mentorName }) => {
  const values = {
    memberName: String(memberName ?? '').trim() || 'there',
    mentorName: String(mentorName ?? '').trim() || 'your mentor',
  };
  return String(template?.body ?? '').replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key] ?? '');
};
