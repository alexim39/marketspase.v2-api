import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateGroupUseCase, JoinGroupUseCase, DecideJoinRequestUseCase, LeaveGroupUseCase,
  SendGroupMessageUseCase, EditGroupMessageUseCase, DeleteGroupMessageUseCase,
  ReportGroupMessageUseCase, DecideGroupReportUseCase, MuteGroupUseCase, PinGroupMessageUseCase,
  AddGroupMemberUseCase, BanGroupMemberUseCase, RemoveGroupMemberUseCase, SearchGroupsUseCase,
  ListGroupBansUseCase, GetGroupUseCase, SetGroupPhotoUseCase, FindOrCreateTeamGroupUseCase,
  GetGroupInviteUseCase, GroupThreadUseCase,
} from './Group.usecases.js';

const OID = (n) => String(n).padStart(24, 'a');

const groupDoc = (over = {}) => ({
  _id: OID(1), name: 'Team Alpha', description: '', photo: null, joinPolicy: 'approval',
  createdBy: OID(9), pinnedMessageId: null, createdAt: new Date().toISOString(), ...over,
});

const fakeGroups = (over = {}) => {
  const state = {
    members: new Map(),
    bans: new Set(),
    requests: new Map(),
    messages: [],
    groups: new Map([[OID(1), groupDoc()]]),
    ...over,
  };
  return {
    state,
    async memberRole(gid, pid) {
      const m = state.members.get(`${gid}:${pid}`);
      return m ? m.role : null;
    },
    async getGroup(id) { const g = state.groups.get(String(id)) ?? null; return g ? { ...g } : null; },
    async createGroup(input) {
      const g = { ...groupDoc({ ...input, _id: OID(7), createdBy: input.createdBy }), name: input.name };
      state.groups.set(g._id, g);
      state.members.set(`${g._id}:${input.createdBy}`, { role: 'admin', joinedAt: new Date(0), muted: false });
      return { ...g };
    },
    async updateGroup(id, patch) { Object.assign(state.groups.get(String(id)), patch); return state.groups.get(String(id)); },
    async deleteGroupCascade(id) { state.groups.delete(String(id)); return { deleted: true }; },
    async memberIds() { return []; },
    async memberCount(gid) { return [...state.members.keys()].filter((k) => k.startsWith(`${gid}:`)).length; },
    async isBanned(gid, pid) { return state.bans.has(`${gid}:${pid}`); },
    async isMember(gid, pid) { return state.members.has(`${gid}:${pid}`); },
    async addMember(gid, pid, role = 'member') {
      if (state.members.has(`${gid}:${pid}`)) return false;
      state.members.set(`${gid}:${pid}`, { role, joinedAt: new Date(), muted: false });
      return true;
    },
    async removeMember(gid, pid) { state.members.delete(`${gid}:${pid}`); return true; },
    async setAdmin(gid, pid, isAdmin) {
      const m = state.members.get(`${gid}:${pid}`);
      if (m) m.role = isAdmin ? 'admin' : 'member';
      return true;
    },
    async setMuted(gid, pid, muted) {
      const m = state.members.get(`${gid}:${pid}`);
      if (m) m.muted = !!muted;
      return true;
    },
    async membersWithProfiles(gid) {
      return [...state.members.entries()]
        .filter(([k]) => k.startsWith(`${gid}:`))
        .map(([k, m]) => ({ id: k.split(':')[1], name: 'M', role: m.role, muted: m.muted, joinedAt: m.joinedAt, photo: null, lastSeenAt: null }));
    },
    async listRequests(gid) {
      return [...state.requests.values()].filter((r) => String(r.groupId) === String(gid) && r.status === 'pending');
    },
    async findRequest() { return null; },
    async findRequestById(id) { return state.requests.get(String(id)) ?? null; },
    async requestJoin(gid, pid) {
      state.seq = (state.seq ?? 0) + 1;
      const id = OID(500 + state.seq);
      state.requests.set(id, { _id: id, id, groupId: String(gid), partnerId: String(pid), status: 'pending' });
      return { created: true };
    },
    async decideRequest(id, { decision, decidedBy }) {
      const r = state.requests.get(String(id));
      if (!r || r.status !== 'pending') return null;
      r.status = decision === 'approve' ? 'approved' : 'rejected';
      r.decidedBy = decidedBy;
      return r;
    },
    async findAnyRequest(gid, pid) {
      for (const r of state.requests.values()) {
        if (String(r.groupId) === String(gid) && String(r.partnerId) === String(pid)) return r;
      }
      return null;
    },
    async reopenRequest(id) {
      const r = state.requests.get(String(id));
      if (r) { r.status = 'pending'; r.decidedBy = null; }
      return r ?? null;
    },
    async createGroupMessage(input) {
      const m = { _id: OID(100 + state.messages.length), createdAt: new Date().toISOString(), editedAt: null, ...input };
      state.messages.push(m);
      return { ...m, id: String(m._id) };
    },
    async findGroupMessage(id) { return state.messages.find((m) => String(m._id) === String(id)) ?? null; },
    async editGroupMessage(id, body) {
      const m = state.messages.find((m) => String(m._id) === String(id));
      if (m) { m.body = body; m.editedAt = new Date().toISOString(); }
      return m ?? null;
    },
    async deleteGroupMessage(id) {
      const i = state.messages.findIndex((m) => String(m._id) === String(id));
      if (i >= 0) state.messages.splice(i, 1);
      return true;
    },
    async updateRead() { return true; },
    async reportMessage({ groupId, messageId, reporterId, reason }) {
      state.reports ??= [];
      const id = OID(300 + state.reports.length);
      state.reports.push({ _id: id, id, groupId: String(groupId), messageId: String(messageId), reporterId: String(reporterId), reason, status: 'pending' });
      return { created: true };
    },
    async listReports() { return state.reports ?? []; },
    async findReportById(id) {
      return (state.reports ?? []).find((r) => String(r.id) === String(id) || String(r._id) === String(id)) ?? null;
    },
    async decideReport(id, { decision }) {
      const r = (state.reports ?? []).find((x) => String(x.id) === String(id) || String(x._id) === String(id));
      if (r) r.status = decision === 'remove' ? 'removed' : 'dismissed';
      return r ?? null;
    },
    async thread() { return [...state.messages]; },
    async readStates() { return []; },
    async findByTeamId(tid) {
      for (const g of state.groups.values()) {
        if (String(g.teamId ?? '') === String(tid)) return { ...g, id: String(g._id) };
      }
      return null;
    },
    async banMember(gid, pid) { state.bans.add(`${gid}:${pid}`); state.members.delete(`${gid}:${pid}`); return true; },
    async unbanMember(gid, pid) { state.bans.delete(`${gid}:${pid}`); return true; },
    async listBans(gid) {
      return [...state.bans].filter((k) => k.startsWith(`${gid}:`)).map((k) => ({ partnerId: k.split(':')[1], reason: 'spam' }));
    },
  };
};

const partners = {
  async findById() { return { _id: OID(2) }; },
};

describe('group lifecycle', () => {
  it('creates groups with the creator as admin', async () => {
    const groups = fakeGroups();
    const uc = new CreateGroupUseCase({ groups, partners });
    const out = await uc.execute({ partnerId: OID(1), name: '  Hustlers  ', joinPolicy: 'open' });
    assert.equal(out.name, 'Hustlers');
    assert.equal(await groups.memberRole(out.id, OID(1)), 'admin');
  });

  it('rejects blank names and bad join policies', async () => {
    const uc = new CreateGroupUseCase({ groups: fakeGroups(), partners });
    await assert.rejects(uc.execute({ partnerId: OID(1), name: 'x' }), /Group name/);
    await assert.rejects(uc.execute({ partnerId: OID(1), name: 'Ok', joinPolicy: 'everyone' }), /Invalid join policy/);
  });

  it('auto-joins open groups, queues approval groups, blocks banned users', async () => {
    const groups = fakeGroups();
    groups.state.groups.set(OID(2), groupDoc({ _id: OID(2), joinPolicy: 'open' }));
    const open = new JoinGroupUseCase({ groups, partners });
    const r1 = await open.execute({ partnerId: OID(3), groupId: OID(2) });
    assert.equal(r1.joined, true);
    assert.equal(await groups.isMember(OID(2), OID(3)), true);

    const closed = new JoinGroupUseCase({ groups, partners });
    const r2 = await closed.execute({ partnerId: OID(4), groupId: OID(1) });
    assert.equal(r2.pending, true);

    groups.state.bans.add(`${OID(1)}:${OID(5)}`);
    await assert.rejects(closed.execute({ partnerId: OID(5), groupId: OID(1) }), /removed from this group/);
  });

  it('leaving dissolves empty groups and promotes the oldest member', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const leave = new LeaveGroupUseCase({ groups });
    const res = await leave.execute({ partnerId: OID(9), groupId: OID(1) });
    assert.equal(res.left, true);
    const members = await groups.membersWithProfiles(OID(1));
    assert.equal(members.find((m) => m.id === OID(2)).role, 'admin');
  });

  it('dissolves the group when the last member leaves', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    const leave = new LeaveGroupUseCase({ groups });
    const res = await leave.execute({ partnerId: OID(9), groupId: OID(1) });
    assert.equal(res.dissolved, true);
    assert.equal(groups.state.groups.has(OID(1)), false);
  });
});

describe('group moderation', () => {
  it('admins add and remove, never the creator', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    const add = new AddGroupMemberUseCase({ groups, partners });
    assert.deepEqual(await add.execute({ partnerId: OID(9), groupId: OID(1), userId: OID(2) }), { added: true });
    const remove = new RemoveGroupMemberUseCase({ groups });
    await assert.rejects(remove.execute({ partnerId: OID(9), groupId: OID(1), userId: OID(9) }), /creator/);
    assert.deepEqual(await remove.execute({ partnerId: OID(9), groupId: OID(1), userId: OID(2) }), { removed: true });
  });

  it('bans block re-entry until unbanned', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    const { BanGroupMemberUseCase, UnbanGroupMemberUseCase } = await import('./Group.usecases.js');
    await new BanGroupMemberUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1), userId: OID(2), reason: 'spam' });
    assert.equal(await groups.isBanned(OID(1), OID(2)), true);
    await assert.rejects(new JoinGroupUseCase({ groups, partners }).execute({ partnerId: OID(2), groupId: OID(1) }), /removed from this group/);
    await new UnbanGroupMemberUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1), userId: OID(2) });
    assert.equal(await groups.isBanned(OID(1), OID(2)), false);
  });

  it('admins can list bans so they stay reversible', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const { BanGroupMemberUseCase } = await import('./Group.usecases.js');
    await new BanGroupMemberUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1), userId: OID(2), reason: 'spam' });
    const bans = await new ListGroupBansUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1) });
    assert.equal(bans.length, 1);
    assert.equal(bans[0].partnerId, OID(2));
    // Strangers (and plain members) never see the ban list.
    await assert.rejects(new ListGroupBansUseCase({ groups }).execute({ partnerId: OID(2), groupId: OID(1) }), /Group not found/);
  });

  it('exposes string ids on pending requests for the info panel', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    // Raw store rows carry `_id` only — the panel needs a string `id` it can
    // send back to the approve/reject endpoint (regression: `undefined` id
    // used to surface as "requestId: Invalid id").
    groups.state.requests.set('req1', { _id: OID(77), groupId: OID(1), partnerId: OID(4), status: 'pending' });
    const detail = await new GetGroupUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1) });
    assert.equal(detail.pendingRequests?.length, 1);
    assert.equal(detail.pendingRequests?.[0].id, OID(77));
  });

  it('swaps the group avatar and retires the previous Cloudinary asset', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    const images = {
      uploaded: [],
      destroyed: [],
      seq: 0,
      async upload(buffer, { publicId } = {}) {
        this.uploaded.push({ bytes: buffer.length, publicId });
        this.seq += 1;
        return { url: `https://res.cloudinary.com/d/image/upload/v1/groups/g-${this.seq}.png` };
      },
      async destroy(publicId) { this.destroyed.push(publicId); return true; },
    };
    const set = new SetGroupPhotoUseCase({ groups, images });
    const first = await set.execute({ partnerId: OID(9), groupId: OID(1), buffer: Buffer.from([1, 2, 3]) });
    assert.equal(first.photo, 'https://res.cloudinary.com/d/image/upload/v1/groups/g-1.png');
    // First avatar had nothing to retire (group started photo-less).
    assert.deepEqual(images.destroyed, []);
    // Strangers cannot change the avatar.
    await assert.rejects(set.execute({ partnerId: OID(2), groupId: OID(1), buffer: Buffer.from([1]) }), /admin/);
    // Second swap retires the first asset; empty buffers are rejected.
    await set.execute({ partnerId: OID(9), groupId: OID(1), buffer: Buffer.from([9]) });
    assert.deepEqual(images.destroyed, ['groups/g-1']);
    await assert.rejects(set.execute({ partnerId: OID(9), groupId: OID(1), buffer: Buffer.alloc(0) }), /No photo/);
  });

  it('accepts attachment-only messages and rejects empty ones', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const send = new SendGroupMessageUseCase({ groups });
    const file = { url: 'https://img.test/a.png', mime: 'image/png', size: 10 };
    const msg = await send.execute({ partnerId: OID(2), groupId: OID(1), body: '   ', attachments: [file] });
    assert.equal(msg.attachments.length, 1);
    await assert.rejects(
      send.execute({ partnerId: OID(2), groupId: OID(1), body: '   ', attachments: [] }),
      /text or an attachment/,
    );
    await assert.rejects(
      send.execute({ partnerId: OID(2), groupId: OID(1), body: '', attachments: [{ url: 'http://x', mime: 'image/png', size: 1 }] }),
      /Invalid attachment url/,
    );
  });

  it('marks thread messages seen by members with newer read watermarks', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const send = new SendGroupMessageUseCase({ groups });
    await send.execute({ partnerId: OID(2), groupId: OID(1), body: 'hello', attachments: [] });
    const future = new Date(Date.now() + 60_000).toISOString();
    groups.readStates = async () => [
      { partnerId: OID(9), lastReadAt: future },
      { partnerId: OID(2), lastReadAt: future },
      { partnerId: OID(4), lastReadAt: null },
    ];
    const thread = await new GroupThreadUseCase({ groups }).execute({ partnerId: OID(2), groupId: OID(1) });
    assert.equal(thread.length, 1);
    // Sender excluded, null watermarks ignored.
    assert.deepEqual(thread[0].seenBy, [OID(9)]);
  });

  it('caps membership at 300', async () => {
    const groups = fakeGroups();
    groups.state.groups.set(OID(3), groupDoc({ _id: OID(3), joinPolicy: 'open' }));
    for (let i = 0; i < 300; i++) state_add(groups, OID(3), `b${i}`);
    const join = new JoinGroupUseCase({ groups, partners });
    await assert.rejects(join.execute({ partnerId: OID(9), groupId: OID(3) }), /full/);
    function state_add(g, gid, pid) { g.state.members.set(`${gid}:${pid}`, { role: 'member', joinedAt: new Date(), muted: false }); }
  });

  it('only authors edit own messages; admins can delete any', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const send = new SendGroupMessageUseCase({ groups });
    const msg = await send.execute({ partnerId: OID(2), groupId: OID(1), body: 'hello team', attachments: [] });
    assert.ok(msg.id);
    const { EditGroupMessageUseCase, DeleteGroupMessageUseCase } = await import('./Group.usecases.js');
    await assert.rejects(new EditGroupMessageUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1), messageId: msg._id ?? msg.id, body: 'edited' }), /own message/);
    const edited = await new EditGroupMessageUseCase({ groups }).execute({ partnerId: OID(2), groupId: OID(1), messageId: msg._id ?? msg.id, body: 'hello team!' });
    assert.equal(edited.body, 'hello team!');
    assert.ok(edited.editedAt);
    // Admin deletes another member's message.
    const del = new DeleteGroupMessageUseCase({ groups });
    assert.deepEqual(await del.execute({ partnerId: OID(9), groupId: OID(1), messageId: msg._id ?? msg.id }), { deleted: true });
    // Stranger cannot delete.
    groups.state.members.set(`${OID(1)}:${OID(5)}`, { role: 'member', joinedAt: new Date(3), muted: false });
    const msg2 = await send.execute({ partnerId: OID(2), groupId: OID(1), body: 'again', attachments: [] });
    await assert.rejects(del.execute({ partnerId: OID(5), groupId: OID(1), messageId: msg2._id ?? msg2.id }), /admin/);
  });

  it('reports flow to verdict with optional ban', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const send = new SendGroupMessageUseCase({ groups });
    const msg = await send.execute({ partnerId: OID(2), groupId: OID(1), body: 'buy now', attachments: [] });
    const { ReportGroupMessageUseCase, DecideGroupReportUseCase } = await import('./Group.usecases.js');
    await new ReportGroupMessageUseCase({ groups }).execute({ partnerId: OID(2), groupId: OID(1), messageId: msg._id ?? msg.id, reason: 'spam' });
    assert.equal(groups.state.reports.length, 1);
    const out = await new DecideGroupReportUseCase({ groups }).execute({ partnerId: OID(9), groupId: OID(1), reportId: groups.state.reports[0].id, decision: 'remove', banMember: true });
    assert.equal(out.decision, 'remove');
    assert.equal(await groups.isBanned(OID(1), OID(2)), true);
  });
});

describe('team chat bridge', () => {
  const teamDoc = { _id: OID(5), teamName: 'Anis Strategic', description: 'cell', partnerId: OID(9), members: [OID(9), OID(2), OID(4)] };
  const teams = { findById: async (id) => (String(id) === OID(5) ? { ...teamDoc } : null) };

  it('creates the team group on first visit and seeds the roster', async () => {
    const groups = fakeGroups();
    const out = await new FindOrCreateTeamGroupUseCase({ groups, teams }).execute({ partnerId: OID(9), teamId: OID(5) });
    assert.equal(out.created, true);
    assert.equal(out.joined, true);
    assert.equal(await groups.isMember(out.groupId, OID(9)), true);
    assert.equal(await groups.isMember(out.groupId, OID(2)), true);
    assert.equal(await groups.isMember(out.groupId, OID(4)), true);
    const created = groups.state.groups.get(out.groupId);
    assert.equal(created.name, 'Anis Strategic');
    assert.equal(String(created.teamId), OID(5));
  });

  it('returns the existing group without duplicating', async () => {
    const groups = fakeGroups();
    groups.state.groups.set(OID(8), groupDoc({ _id: OID(8), teamId: OID(5), joinPolicy: 'approval' }));
    groups.state.members.set(`${OID(8)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const out = await new FindOrCreateTeamGroupUseCase({ groups, teams }).execute({ partnerId: OID(2), teamId: OID(5) });
    assert.equal(out.created, false);
    assert.equal(out.joined, true);
    assert.equal(out.groupId, OID(8));
  });

  it('reports pending state for roster members stuck at approval', async () => {
    const groups = fakeGroups();
    groups.state.groups.set(OID(8), groupDoc({ _id: OID(8), teamId: OID(5), joinPolicy: 'approval' }));
    groups.state.members.set(`${OID(8)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    const UC = FindOrCreateTeamGroupUseCase;
    const cold = await new UC({ groups, teams }).execute({ partnerId: OID(4), teamId: OID(5) });
    assert.deepEqual([cold.joined, cold.pending], [false, false]);
    groups.state.requests.set('req-team', { _id: OID(70), groupId: OID(8), partnerId: OID(4), status: 'pending' });
    const warm = await new UC({ groups, teams }).execute({ partnerId: OID(4), teamId: OID(5) });
    assert.deepEqual([warm.joined, warm.pending], [false, true]);
  });

  it('refuses non-team-members and unknown teams', async () => {
    const groups = fakeGroups();
    const UC = FindOrCreateTeamGroupUseCase;
    await assert.rejects(new UC({ groups, teams }).execute({ partnerId: OID(3), teamId: OID(5) }), /Only team members/);
    await assert.rejects(new UC({ groups, teams }).execute({ partnerId: OID(9), teamId: OID(6) }), /Team not found/);
  });

  it('opens orphaned chats gracefully when the team is gone', async () => {
    const groups = fakeGroups();
    groups.state.groups.set(OID(8), groupDoc({ _id: OID(8), teamId: OID(6), joinPolicy: 'approval' }));
    groups.state.members.set(`${OID(8)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const out = await new FindOrCreateTeamGroupUseCase({ groups, teams }).execute({ partnerId: OID(2), teamId: OID(6) });
    assert.deepEqual([out.joined, out.teamGone, out.created], [true, true, false]);
    assert.equal(out.groupId, OID(8));
  });
});

describe('group search', () => {
  it('exposes a roster-free invite preview for link sharing', async () => {
    const groups = fakeGroups();
    groups.state.members.set(`${OID(1)}:${OID(9)}`, { role: 'admin', joinedAt: new Date(1), muted: false });
    groups.state.members.set(`${OID(1)}:${OID(2)}`, { role: 'member', joinedAt: new Date(2), muted: false });
    const invite = await new GetGroupInviteUseCase({ groups }).execute({ groupId: OID(1) });
    assert.equal(invite.name, 'Team Alpha');
    assert.equal(invite.memberCount, 2);
    assert.ok(!('members' in invite));
    await assert.rejects(new GetGroupInviteUseCase({ groups }).execute({ groupId: OID(8) }), /Group not found/);
  });
  it('returns safe fields only', async () => {
    const { SearchGroupsUseCase } = await import('./Group.usecases.js');
    const directory = [
      { id: OID(1), name: 'Hustlers', description: 'd', photo: null, joinPolicy: 'open', memberCount: 12, createdAt: new Date().toISOString() },
    ];
    const uc = new SearchGroupsUseCase({
      groups: {
        async searchGroups(q) {
          const needle = String(q ?? '').toLowerCase();
          return directory.filter((g) => g.name.toLowerCase().includes(needle));
        },
      },
    });
    const rows = await uc.execute({ q: 'hus' });
    assert.equal(rows[0].name, 'Hustlers');
    assert.ok(!('members' in rows[0]));
    assert.deepEqual(await uc.execute({ q: 'x' }), []);
  });
});
