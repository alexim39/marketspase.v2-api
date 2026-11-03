import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { teamGroupSyncUpdates } from './GroupTeamSync.js';

describe('team group sync planner', () => {
  it('emits a guarded rename when the team name changes', async () => {
    const ops = await teamGroupSyncUpdates(
      { teamName: 'Old Cell', description: 'd' },
      { teamName: 'New Cell', description: 'd' },
    );
    assert.deepEqual(ops, [{ filter: { name: 'Old Cell' }, update: { name: 'New Cell' } }]);
  });

  it('emits nothing when nothing changes', async () => {
    const ops = await teamGroupSyncUpdates(
      { teamName: 'Cell', description: 'same' },
      { teamName: 'Cell', description: 'same' },
    );
    assert.deepEqual(ops, []);
  });

  it('syncs descriptions independently, guarded by the old value', async () => {
    const ops = await teamGroupSyncUpdates(
      { teamName: 'Cell', description: 'before' },
      { teamName: 'Cell', description: 'after' },
    );
    assert.deepEqual(ops, [{ filter: { description: 'before' }, update: { description: 'after' } }]);
  });

  it('emits both specs when name and description change together', async () => {
    const ops = await teamGroupSyncUpdates(
      { teamName: 'A', description: 'x' },
      { teamName: 'B', description: 'y' },
    );
    assert.equal(ops.length, 2);
  });

  it('never emits a rename without a usable old name', async () => {
    assert.deepEqual(await teamGroupSyncUpdates({ teamName: '', description: 'd' }, { teamName: 'New', description: 'd' }), []);
    assert.deepEqual(await teamGroupSyncUpdates({ description: 'd' }, { teamName: 'New', description: 'd' }), []);
    // Null old team: rename stays suppressed, but the new description still syncs.
    assert.deepEqual(await teamGroupSyncUpdates(null, { teamName: 'New', description: 'd' }), [
      { filter: { description: '' }, update: { description: 'd' } },
    ]);
  });

  it('normalizes missing descriptions instead of crashing', async () => {
    const ops = await teamGroupSyncUpdates({ teamName: 'Cell' }, { teamName: 'Cell', description: 'now set' });
    assert.deepEqual(ops, [{ filter: { description: '' }, update: { description: 'now set' } }]);
  });

  it('stays a pure function (no mutation of its inputs)', async () => {
    const oldTeam = { teamName: 'A', description: 'x' };
    const newTeam = { teamName: 'B', description: 'y' };
    await teamGroupSyncUpdates(oldTeam, newTeam);
    assert.deepEqual([oldTeam, newTeam], [{ teamName: 'A', description: 'x' }, { teamName: 'B', description: 'y' }]);
  });
});
