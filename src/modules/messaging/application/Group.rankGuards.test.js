import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DeleteGroupUseCase,
  JoinGroupUseCase,
  LeaveGroupUseCase,
  UpdateGroupUseCase,
} from './Group.usecases.js';

const GID = '64b000000000000000000001';
const PID = '64b000000000000000000002';
const OTHER = '64b000000000000000000003';

const managedGroup = (over = {}) => ({
  id: GID,
  name: 'Partner Circle',
  description: 'Official level group',
  joinPolicy: 'approval',
  rankGroup: 'Partner',
  createdBy: OTHER,
  ...over,
});

const groups = (group = managedGroup()) => ({
  async getGroup() { return group; },
  async memberRole() { return 'member'; },
  async isMember() { return true; },
  async isBanned() { return false; },
  async removeMember() { return true; },
  async deleteGroupCascade() { throw new Error('must not cascade delete a managed group'); },
  async updateGroup() { throw new Error('must not update a managed group'); },
  async requestJoin() { throw new Error('must not request to join a managed group'); },
});

describe('managed rank group guards', () => {
  it('does not let a member leave their level group', async () => {
    await assert.rejects(
      new LeaveGroupUseCase({ groups: groups() }).execute({ partnerId: PID, groupId: GID }),
      /managed automatically/,
    );
  });

  it('does not let an admin delete a level group', async () => {
    await assert.rejects(
      new DeleteGroupUseCase({ groups: groups() }).execute({ partnerId: PID, groupId: GID }),
      /managed by MarketSpase/,
    );
  });

  it('does not let anyone join a level group directly', async () => {
    await assert.rejects(
      new JoinGroupUseCase({ groups: groups(), partners: { findById: async () => ({ _id: PID }) } })
        .execute({ partnerId: PID, groupId: GID }),
      /managed automatically/,
    );
  });

  it('does not let admins edit a level group', async () => {
    await assert.rejects(
      new UpdateGroupUseCase({ groups: groups() }).execute({
        partnerId: PID,
        groupId: GID,
        patch: { name: 'Renamed' },
      }),
      /managed by MarketSpase/,
    );
  });
});
