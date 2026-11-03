/**
 * Pure team → group label sync planner (no DB) — unit-tested here; the
 * store just executes the returned specs. Keeps deliberate group branding
 * intact: a field only syncs when it still equals the old team value.
 *
 * @returns {Array<{ filter: object, update: object }>} updateMany specs.
 */
export const teamGroupSyncUpdates = (oldTeam, newTeam) => {
  const ops = [];
  const name = newTeam?.teamName;
  const oldName = oldTeam?.teamName;
  if (name && oldName && name !== oldName) {
    ops.push({ filter: { name: oldName }, update: { name } });
  }
  const next = String(newTeam?.description ?? '');
  const prev = String(oldTeam?.description ?? '');
  if (next !== prev) {
    ops.push({ filter: { description: prev }, update: { description: next } });
  }
  return ops;
};
