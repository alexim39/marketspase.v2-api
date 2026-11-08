/**
 * Official rank groups — one managed group chat per journey level.
 *
 * Membership follows the persisted progression level. Groups are hidden
 * from directory search and cannot be joined, left or deleted through the
 * normal group APIs; the rank-group service owns their membership.
 */

export const RANK_GROUP_RANKS = Object.freeze(['Partner', 'Builder', 'Leader', 'Ambassador']);

export const RANK_GROUP_CONFIG = Object.freeze({
  Partner: {
    rank: 'Partner',
    name: 'Partner Circle',
    description:
      'Your home base as a new MarketSpase Partner. Ask questions, share wins, find your footing and meet other partners building their first online business. Real support, no pressure.',
    welcome:
      'Welcome to the Partner Circle. Introduce yourself, ask one question, and share one thing you are working on this week. Be kind, be useful, no spam or income claims.',
  },
  Builder: {
    rank: 'Builder',
    name: 'Builder Circle',
    description:
      'A working room for Builders putting the system to work. Share what is converting, compare follow-up routines, get help with campaigns and keep your team moving.',
    welcome:
      'Welcome, Builders. Share one thing that is working, one thing you need help with, and celebrate a teammate win. No cold-call scripts, no pressure.',
  },
  Leader: {
    rank: 'Leader',
    name: 'Leader Circle',
    description:
      'For MarketSpase Leaders supporting people and teams. Talk mentorship, team health, campaign strategy and recognition. Bring a problem, leave with a plan.',
    welcome:
      'Welcome, Leaders. Bring one team win and one team challenge. Support other leaders, share what you are learning, and keep the room respectful.',
  },
  Ambassador: {
    rank: 'Ambassador',
    name: 'Ambassador Circle',
    description:
      'The peer room for Ambassadors. Strategic conversations, leadership development, community initiatives and direct feedback to the MarketSpase team.',
    welcome:
      'Welcome, Ambassadors. Use this room for strategy, leadership development and feedback to the MarketSpase team. No recruitment spam.',
  },
});

/** Journey level keys (lowercase) → group rank labels. */
export const LEVEL_TO_RANK = Object.freeze({
  partner: 'Partner',
  builder: 'Builder',
  leader: 'Leader',
  ambassador: 'Ambassador',
});

export const rankForLevel = (level) => LEVEL_TO_RANK[String(level ?? '').toLowerCase()] ?? 'Partner';
