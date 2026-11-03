/**
 * Ora analytics — pure topic classification + summary math.
 * Topics come from keyword buckets over the member's question (never the
 * reply), so tracking stays cheap and explainable. Raw events persist in
 * `ora-events`; summaries roll up on read over a trailing window.
 */

export const ORA_TOPICS = [
  'growth', 'leadership', 'goals', 'team', 'community', 'training', 'earnings', 'general',
];

export const TOPIC_LABELS = {
  growth: 'Business growth',
  leadership: 'Leadership',
  goals: 'Goals',
  team: 'Team',
  community: 'Community',
  training: 'Training',
  earnings: 'Earnings',
  general: 'General',
};

const BUCKETS = [
  ['growth', /prospect|recruit|follow.?up|clos|\bcall\b|contact|sale|pipeline|present|enroll|convert|market|campaign|invite/i],
  ['leadership', /promot|kingsman|ecl|cell leader|g leader|g8|rank|level|leadership|mentor|qualif/i],
  ['goals', /goal|target|track|pace|focus|progress/i],
  ['team', /team|downline|member|inactive|upline|tree/i],
  ['community', /communit|event|announce|post|recognition|rsvp|training session|meeting/i],
  ['training', /\bipo\b|\bqsg\b|\bsmo\b|training|course|certif/i],
  ['earnings', /earn|commission|bonus|payout|pay|money|income/i],
];

/** First matching bucket wins; order matters (growth before goals, etc.). */
export const classifyTopic = (text) => {
  const s = String(text ?? '');
  for (const [topic, re] of BUCKETS) {
    if (re.test(s)) return topic;
  }
  return 'general';
};

/**
 * @param {{events, days}} input (events: [{topic, at, conversationId}])
 * @returns personal summary: totals + per-topic counts + active days.
 */
export const summarizeAnalytics = ({ events = [], days = 30 } = {}) => {
  const perTopic = Object.fromEntries(ORA_TOPICS.map((t) => [t, 0]));
  const convos = new Set();
  const activeDays = new Set();
  for (const e of events) {
    const topic = ORA_TOPICS.includes(e.topic) ? e.topic : 'general';
    perTopic[topic] += 1;
    if (e.conversationId) convos.add(String(e.conversationId));
    if (e.at) activeDays.add(new Date(e.at).toISOString().slice(0, 10));
  }
  return {
    days,
    questions: events.length,
    conversations: convos.size,
    activeDays: activeDays.size,
    perTopic: ORA_TOPICS.map((topic) => ({ topic, label: TOPIC_LABELS[topic], count: perTopic[topic] }))
      .filter((t) => t.count > 0),
  };
};
