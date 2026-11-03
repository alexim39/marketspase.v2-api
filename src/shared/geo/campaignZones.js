/**
 * Campaign allocation geography — geopolitical zones as the proximity tier.
 *
 * Keys are NORMALIZED state names (see `normalizeState` in nigerianStates.js:
 * lowercase, single-spaced, 'fct abuja' canonical). Tier 1 is an exact
 * state match against the campaign's targets; Tier 2 is same-zone fallback;
 * Tier 3 (out-of-area, opt-in only) is anything else.
 */
import { normalizeState } from './nigerianStates.js';

const NORTH_CENTRAL = ['benue', 'fct abuja', 'kogi', 'kwara', 'nasarawa', 'niger', 'plateau'];
const NORTH_EAST = ['adamawa', 'bauchi', 'borno', 'gombe', 'taraba', 'yobe'];
const NORTH_WEST = ['jigawa', 'kaduna', 'kano', 'katsina', 'kebbi', 'sokoto', 'zamfara'];
const SOUTH_EAST = ['abia', 'anambra', 'ebonyi', 'enugu', 'imo'];
const SOUTH_SOUTH = ['akwa ibom', 'bayelsa', 'cross river', 'delta', 'edo', 'rivers'];
const SOUTH_WEST = ['ekiti', 'lagos', 'ogun', 'ondo', 'osun', 'oyo'];

const ZONES = [NORTH_CENTRAL, NORTH_EAST, NORTH_WEST, SOUTH_EAST, SOUTH_SOUTH, SOUTH_WEST];

export const STATE_ZONE = Object.freeze(
  Object.fromEntries(ZONES.flatMap((states, i) => states.map((s) => [s, i])))
);

/** Zone index for a raw state string, or null when unknown. */
export const zoneOf = (state) => {
  const norm = normalizeState(state);
  if (!norm) return null;
  return Object.prototype.hasOwnProperty.call(STATE_ZONE, norm) ? STATE_ZONE[norm] : null;
};

/**
 * Allocation tier for a pool lead against campaign location targets.
 * - 1: lead state is one of the targeted states (or lead country is one of
 *      the targeted countries for country-scoped campaigns).
 * - 2: same geopolitical zone as a targeted state (states scope only).
 * - 3: out-of-area — only usable when the campaign opts in.
 * - 0: no match (suppressed when targets exist and nothing matches).
 */
export const allocationTier = (lead, { scope = 'States', targets = [] } = {}) => {
  const normTargets = [...new Set(
    (targets ?? []).map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
  )];
  if (String(scope).toLowerCase() === 'countries') {
    const country = String(lead?.country ?? 'Nigeria').trim().toLowerCase();
    return normTargets.includes(country) ? 1 : 0;
  }
  if (normTargets.length === 0) return 2; // legacy campaigns: no targets recorded — broad match
  const leadState = normalizeState(lead?.stateNorm ?? lead?.state);
  if (!leadState) return 0;
  if (normTargets.some((t) => normalizeState(t) === leadState)) return 1;
  const leadZone = zoneOf(leadState);
  if (leadZone !== null && normTargets.some((t) => zoneOf(t) === leadZone)) return 2;
  return 3;
};
