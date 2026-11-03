/**
 * Diamond progression ladder — pure rules, unit-testable without Mongo.
 *
 * Levels auto-derive by walking entry gates from the bottom up. A gate is
 * a mix of COMPUTED signals (recruits, active team, maintenance — read
 * from source aggregates, never stored) and ATTESTED milestones (training,
 * office, nominations — stored on the progression record with timestamps).
 */

export const LEVELS = [
  'prospect',
  'partner',
  'emerging_active',
  'qualified_active',
  'active',
  'kingsman',
  'ecl',
  'cell_leader',
  'g_leader',
  'g8',
];

export const LEVEL_LABELS = {
  prospect: 'Prospect',
  partner: 'Partner',
  emerging_active: 'Emerging Active Partner',
  qualified_active: 'Qualified Active Partner',
  active: 'Active Partner',
  kingsman: 'Kingsman',
  ecl: 'Emerging Cell Leader',
  cell_leader: 'Cell Leader',
  g_leader: 'G Leader',
  g8: 'G8 Leader',
};

/** G8 nominations approve at this many distinct G8/admin approvals. */
export const NOMINATION_APPROVALS_REQUIRED = 3;

/**
 * Confirmation responsiveness (training approvals). A pending request
 * older than this counts as stale — the upline bottleneck signal.
 */
export const STALE_CONFIRM_MS = 72 * 3600000;

/** Median of numbers (null when empty) — outlier-proof by construction. */
export const medianOf = (values) => {
  const sorted = [...(values ?? [])].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Display string for a latency ("26h", "3d") — null when no data. */
export const formatLatency = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return null;
  const hours = ms / 3600000;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
};

/** Training milestones under upline confirmation (abuse-proofed). */
export const TRAINING_CONFIRM_KEYS = ['ipo', 'qsg', 'smo'];
export const TRAINING_KEY_LABELS = { ipo: 'IPO', qsg: 'QSG', smo: 'SMO' };

/**
 * All upline-confirmed milestones — training plus the trust legs that were
 * self-attested before (office / full-time / onboarding). Gates use
 * `confirmed()` for every key here, never bare `done`.
 */
export const CONFIRMABLE_KEYS = ['ipo', 'qsg', 'smo', 'fullTime', 'office', 'onboardingSession', 'accounts', 'maintenance'];
export const CONFIRM_KEY_LABELS = {
  ipo: 'IPO',
  qsg: 'QSG',
  smo: 'SMO',
  fullTime: 'Full-time',
  office: 'Office',
  onboardingSession: 'Onboarding session',
  accounts: 'DTC accounts',
  maintenance: 'Monthly maintenance',
};

/**
 * Leadership-skills thresholds (trailing windows, tunable in one place):
 * personal volume flowing, real prospect touches, a live downline, and a
 * visible community footprint (posts, event RSVPs or team reports).
 */
export const LEADERSHIP_THRESHOLDS = {
  touchesDays: 30,
  touchesMin: 3,
  communityDays: 30,
  communityMin: 1,
  rsvpDays: 90,
  rsvpMin: 1,
  reportsDays: 60,
  reportsMin: 1,
  responsiveDays: 90,
};

/**
 * Demonstrated leadership from live signals — pure, unit-testable.
 * Every leg must hold: active in business, working with people, someone
 * to support, a community footprint, and responsiveness to the downline.
 * `responsive` is `{medianMs|null, directStale}`: a null median (no
 * decisions in window) passes vacuously — there was nothing to respond
 * to — but a stale backlog fails unconditionally. Prior-rank completion
 * is structural (the upward walk guarantees it).
 * @returns {{met, missing}} `missing` holds human-readable shortfalls.
 */
export const leadershipSkills = (signals = {}) => {
  const missing = [];
  if (signals.maintenanceOk !== true) missing.push('personal volume flowing');
  if ((signals.touchedProspects ?? 0) < LEADERSHIP_THRESHOLDS.touchesMin) {
    missing.push(`${LEADERSHIP_THRESHOLDS.touchesMin}+ prospects touched in ${LEADERSHIP_THRESHOLDS.touchesDays}d`);
  }
  if ((signals.activeDownline ?? 0) < 1) missing.push('at least one active downline member');
  const footprint = (signals.communityPosts ?? 0) + (signals.eventRsvps ?? 0) + (signals.reportsSubmitted ?? 0);
  if (footprint < LEADERSHIP_THRESHOLDS.communityMin) {
    missing.push('a visible community footprint (posts, events or team reports)');
  }
  const responsive = signals.responsive ?? null;
  const directStale = responsive?.directStale ?? 0;
  if (directStale > 0) {
    missing.push(`${directStale} overdue training confirmation${directStale === 1 ? '' : 's'} awaiting your decision`);
  } else if (responsive?.medianMs != null && responsive.medianMs > STALE_CONFIRM_MS) {
    missing.push(`confirmation median ${formatLatency(responsive.medianMs)} — decide within 72h`);
  }
  return { met: missing.length === 0, missing };
};

/**
 * Entry gates. Each requirement: {key, label, action, met}.
 * `signals`: {recruits, activeDownline, maintenanceOk, kingsmen, ecls}
 * `m`: milestones subdoc (all fields optional — absent means undone).
 */
/**
 * Confirmed training — the member marked it AND the upline verified it.
 * Gates on training use this, never bare `done` (self-attestation alone
 * must not open a gate).
 */
export const confirmed = (x) => x?.done === true && !!x?.confirmedAt;

export const gate = (level, signals = {}, m = {}) => {
  const done = (x) => x?.done === true;
  const req = (key, label, action, met) => ({ key, label, action, met: met === true });
  switch (level) {
    case 'emerging_active':
      return [
        req('ipo', 'Complete IPO', 'Take the IPO course in the Training Center', confirmed(m.ipo)),
        req('qsg', 'Complete QSG', 'Take the QSG course in the Training Center', confirmed(m.qsg)),
      ];
    case 'qualified_active':
      return [
        req('recruits', 'Connect one new partner', 'Recruit your first partner from the pipeline', (signals.recruits ?? 0) >= 1),
      ];
    case 'active':
      // The letter is the member's action: `submitted` passes. An `approved`
      // value is inert here on purpose — only an elevated path may grant it.
      // Onboarding needs upline eyes, same as training — self-tap alone
      // must not open the gate.
      return [
        req('g8Request', 'Submit request letter to G8 Leader', 'Send your qualification request letter', m.g8Request?.status === 'submitted'),
        req('onboardingSession', 'Attend onboarding session', 'Schedule your onboarding session and get it confirmed', confirmed(m.onboardingSession)),
      ];
    case 'kingsman':
      return [
        req('activeTeam', 'Grow 5 active partners', 'Activate 5 team members with recent orders', (signals.activeDownline ?? 0) >= 5),
        req('accounts', 'Maintain 3 DTC accounts', 'Record your 3 DTC accounts with evidence for upline confirmation', (m.accounts?.count ?? 0) >= 3 && confirmed(m.accounts)),
        req('maintenance', 'Monthly maintenance compliance', 'Keep personal volume flowing monthly (shop orders auto-count, or record DTC receipt for confirmation)', signals.maintenanceOk === true || confirmed(m.maintenance)),
        req('smo', 'Complete SMO', 'Take the SMO course in the Training Center', confirmed(m.smo)),
      ];
    case 'ecl':
      return [
        req('kingsmen', 'Raise 5 Kingsmen', 'Develop 5 downline Kingsmen', (signals.kingsmen ?? 0) >= 5),
        req('fullTime', 'Full-time participation', 'Commit to full-time and get it confirmed', confirmed(m.fullTime)),
        req('office', 'Office ownership', 'Register your office and get it confirmed', confirmed(m.office)),
      ];
    case 'cell_leader': {
      const skills = leadershipSkills(signals);
      return [
        req('kingsmenTeam', 'Manage 5 downline Kingsmen', 'Develop 5 downline members to Kingsman', (signals.kingsmenExact ?? 0) >= 5),
        req('office', 'Office ownership', 'Register your office (1 or more) and get it confirmed', confirmed(m.office)),
        req('leadership', 'Demonstrated leadership', skills.missing.length > 0 ? `To demonstrate: ${skills.missing.join('; ')}` : 'Keep leading visibly', skills.met),
      ];
    }
    case 'g_leader': {
      const skills = leadershipSkills(signals);
      return [
        req('eclTeam', 'Manage 5 Emerging Cell Leaders', 'Develop 5 downline members to ECL', (signals.eclsExact ?? 0) >= 5),
        req('office', 'Office ownership', 'Register your office (1 or more) and get it confirmed', confirmed(m.office)),
        req('leadership', 'Demonstrated leadership', skills.missing.length > 0 ? `To demonstrate: ${skills.missing.join('; ')}` : 'Keep leading visibly', skills.met),
        req('nomination', 'Nominated by your G8 Leader', 'Request nomination from a G8 Leader', (m.nomination?.approvals?.length ?? 0) >= 1),
      ];
    }
    case 'g8':
      return [
        req('nominations', `Nominated by ${NOMINATION_APPROVALS_REQUIRED}+ G8 Leaders`, 'Collect G8 approvals on your nomination', (m.nomination?.approvals?.length ?? 0) >= NOMINATION_APPROVALS_REQUIRED),
      ];
    default:
      return [];
  }
};

/**
 * Walk the ladder from `from` upward while gates pass.
 * @returns {{level, next, percent, completed, missing, remainingActions}}
 */
export const resolveProgression = (signals = {}, m = {}, from = 'partner') => {
  let level = LEVELS.includes(from) ? from : 'partner';
  for (;;) {
    const idx = LEVELS.indexOf(level);
    const next = LEVELS[idx + 1] ?? null;
    if (!next) break;
    const reqs = gate(next, signals, m);
    if (reqs.length > 0 && reqs.every((r) => r.met)) {
      level = next;
      continue;
    }
    const met = reqs.filter((r) => r.met);
    return {
      level,
      next,
      percent: reqs.length > 0 ? Math.round((met.length / reqs.length) * 100) : 100,
      completed: met.map((r) => r.label),
      missing: reqs.filter((r) => !r.met),
      remainingActions: reqs.filter((r) => !r.met).map((r) => r.action),
    };
  }
  return { level, next: null, percent: 100, completed: [], missing: [], remainingActions: [] };
};

export const RANK = (level) => LEVELS.indexOf(level);

const DAY_MS = 86400000;

/**
 * Journey forecast — honest linear ETA for countable gates only.
 * Uses 30-day recruit pace; duplication legs (raise 5 Kingsmen/ECLs)
 * return null because linear projection would mislead.
 * @param {object} signals live signals (recruits, activeDownline)
 * @param {Array} missing unresolved requirements [{key}]
 * @param {number|null} recruits30d recruits added in the last 30 days
 * @param {Date} now reference date
 * @returns {{remaining, pacePer30d, weeksOut, etaDate, stalled, basis, label}|null}
 */
export const forecastJourney = (signals = {}, missing = [], recruits30d = null, now = new Date()) => {
  const pace = Number(recruits30d);
  const pacePer30d = Number.isFinite(pace) && pace >= 0 ? pace : null;
  const targets = [];
  for (const r of missing ?? []) {
    if (r.key === 'recruits') targets.push({ key: r.key, remaining: Math.max(0, 1 - (signals.recruits ?? 0)), kind: 'recruits' });
    else if (r.key === 'activeTeam') targets.push({ key: r.key, remaining: Math.max(0, 5 - (signals.activeDownline ?? 0)), kind: 'actives' });
  }
  if (targets.length === 0) return null;
  const remaining = Math.max(...targets.map((t) => t.remaining));
  if (remaining <= 0) return null;
  const basis = 'at current 30-day pace';
  if (pacePer30d === null) return { remaining, pacePer30d: null, weeksOut: null, etaDate: null, stalled: false, basis, label: `${remaining} to go ${basis} — pace unknown yet` };
  if (pacePer30d <= 0) {
    return {
      remaining, pacePer30d: 0, weeksOut: null, etaDate: null, stalled: true, basis,
      label: `${remaining} to go — stalled: no recruits in the last 30 days`,
    };
  }
  const daysOut = Math.ceil((remaining / pacePer30d) * 30);
  const weeksOut = Math.max(1, Math.round(daysOut / 7));
  const etaDate = new Date(new Date(now).getTime() + daysOut * DAY_MS).toISOString();
  return {
    remaining, pacePer30d, weeksOut, etaDate, stalled: false, basis,
    label: `${remaining} to go ${basis} (${pacePer30d}/30d) — about ${weeksOut} week${weeksOut === 1 ? '' : 's'} out`,
  };
};
