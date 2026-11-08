import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RankGroupService } from './RankGroups.service.js';

const fakeStore = () => {
  const state = {
    groups: new Map(),
    members: new Map(),
    bans: new Set(),
    messages: [],
    seq: 0,
  };
  const key = (gid, pid) => `${gid}:${pid}`;
  return {
    state,
    async findByRankGroup(rank) {
      return [...state.groups.values()].find((g) => g.rankGroup === rank) ?? null;
    },
    async listRankGroups() {
      return [...state.groups.values()].filter((g) => g.rankGroup);
    },
    async createGroup({ name, description = '', joinPolicy = 'approval', createdBy, rankGroup = null }) {
      const id = `g${++state.seq}`;
      const group = { id, name, description, joinPolicy, createdBy, rankGroup, pinnedMessageId: null };
      state.groups.set(id, group);
      state.members.set(key(id, String(createdBy)), 'admin');
      return group;
    },
    async updateGroup(id, patch) {
      const group = state.groups.get(id);
      Object.assign(group, patch);
      return group;
    },
    async addMember(gid, pid, role = 'member') {
      const k = key(gid, String(pid));
      if (state.members.has(k)) return false;
      state.members.set(k, role);
      return true;
    },
    async removeMember(gid, pid) {
      state.members.delete(key(gid, String(pid)));
      return true;
    },
    async isMember(gid, pid) {
      return state.members.has(key(gid, String(pid)));
    },
    async memberRole(gid, pid) {
      return state.members.get(key(gid, String(pid))) ?? null;
    },
    async setAdmin(gid, pid, isAdmin) {
      state.members.set(key(gid, String(pid)), isAdmin ? 'admin' : 'member');
      return true;
    },
    async isBanned(gid, pid) {
      return state.bans.has(key(gid, String(pid)));
    },
    async createGroupMessage({ groupId, senderId, body }) {
      const message = { id: `m${++state.seq}`, groupId, senderId, body };
      state.messages.push(message);
      return message;
    },
  };
};

const fakeProgress = (levels = {}) => ({
  async findByPartner(partnerId) {
    return levels[String(partnerId)] ? { level: levels[String(partnerId)] } : null;
  },
});

describe('RankGroupService', () => {
  it('seeds the four official groups once and adds system admins', async () => {
    const groups = fakeStore();
    const service = new RankGroupService({
      groups,
      progress: fakeProgress(),
      listAdminIds: async () => ['admin1'],
    });

    const first = await service.ensureGroups();
    const second = await service.ensureGroups();

    assert.equal(first.ready, true);
    assert.equal(first.created, 4);
    assert.equal(second.ready, true);
    assert.equal(groups.state.groups.size, 4);
    assert.deepEqual(
      [...groups.state.groups.values()].map((g) => g.name).sort(),
      ['Ambassador Circle', 'Builder Circle', 'Leader Circle', 'Partner Circle'],
    );
    for (const group of groups.state.groups.values()) {
      assert.equal(await groups.memberRole(group.id, 'admin1'), 'admin');
      assert.ok(group.pinnedMessageId);
    }
    assert.equal(groups.state.messages.length, 4);
  });

  it('moves a member up and back down with their journey level', async () => {
    const groups = fakeStore();
    const progress = fakeProgress({ member1: 'partner' });
    const service = new RankGroupService({
      groups,
      progress,
      listAdminIds: async () => ['admin1'],
    });
    await service.ensureGroups();

    let result = await service.syncPartner('member1');
    assert.equal(result.rank, 'Partner');
    assert.equal(await groups.isMember(result.groupId, 'member1'), true);

    progress.levelByPartner = { member1: 'builder' };
    progress.findByPartner = async (id) => ({ level: progress.levelByPartner[String(id)] });
    result = await service.syncPartner('member1');
    assert.equal(result.rank, 'Builder');
    const partnerGroup = [...groups.state.groups.values()].find((g) => g.rankGroup === 'Partner');
    assert.equal(await groups.isMember(partnerGroup.id, 'member1'), false);
    assert.equal(await groups.isMember(result.groupId, 'member1'), true);

    progress.levelByPartner = { member1: 'partner' };
    result = await service.syncPartner('member1');
    assert.equal(result.rank, 'Partner');
    assert.equal(await groups.isMember(result.groupId, 'member1'), true);
  });

  it('never adds a banned member back into their level group', async () => {
    const groups = fakeStore();
    const progress = fakeProgress({ member1: 'leader' });
    const service = new RankGroupService({
      groups,
      progress,
      listAdminIds: async () => ['admin1'],
    });
    await service.ensureGroups();

    const leaderGroup = [...groups.state.groups.values()].find((g) => g.rankGroup === 'Leader');
    groups.state.bans.add(`${leaderGroup.id}:member1`);

    const result = await service.syncPartner('member1');
    assert.equal(result.rank, 'Leader');
    assert.equal(await groups.isMember(result.groupId, 'member1'), false);
  });

  it('keeps system admins in every group while moving ordinary members', async () => {
    const groups = fakeStore();
    const progress = fakeProgress({ admin1: 'partner' });
    const service = new RankGroupService({
      groups,
      progress,
      listAdminIds: async () => ['admin1'],
    });
    await service.ensureGroups();

    await service.syncPartner('admin1');
    for (const group of groups.state.groups.values()) {
      assert.equal(await groups.memberRole(group.id, 'admin1'), 'admin');
    }
  });

  it('emits one change event per actual group move, with the previous rank', async () => {
    const groups = fakeStore();
    const progress = fakeProgress({ member1: 'partner' });
    const changes = [];
    const service = new RankGroupService({
      groups,
      progress,
      listAdminIds: async () => ['admin1'],
      onChanged: async (payload) => { changes.push(payload); },
    });
    await service.ensureGroups();

    const first = await service.syncPartner('member1');
    assert.equal(changes.length, 1);
    assert.equal(changes[0].partnerId, 'member1');
    assert.equal(changes[0].rank, 'Partner');
    assert.equal(changes[0].groupId, first.groupId);
    assert.equal(changes[0].groupName, 'Partner Circle');
    assert.equal(changes[0].fromRank, null);
    assert.equal(changes[0].fromGroupId, null);
    assert.ok(changes[0].at);

    // A repeat sync with the same level is a no-op, not a duplicate notice.
    await service.syncPartner('member1');
    assert.equal(changes.length, 1);

    progress.levelByPartner = { member1: 'builder' };
    progress.findByPartner = async (id) => ({ level: progress.levelByPartner[String(id)] });
    const moved = await service.syncPartner('member1');
    assert.equal(changes.length, 2);
    assert.equal(changes[1].rank, 'Builder');
    assert.equal(changes[1].groupName, 'Builder Circle');
    assert.equal(changes[1].fromRank, 'Partner');
    assert.equal(
      changes[1].fromGroupId,
      [...groups.state.groups.values()].find((g) => g.rankGroup === 'Partner').id,
    );
    assert.equal(changes[1].groupId, moved.groupId);
  });
});
