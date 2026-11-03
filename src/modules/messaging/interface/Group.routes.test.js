import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';
import { setRevocationChecker } from '../../identity-access/infrastructure/SessionRevocation.js';
import { buildGroupRouter } from './Group.routes.js';

before(() => {
  process.env.JWTTOKENSECRET = process.env.JWTTOKENSECRET || 'test-secret-group-routes';
  setRevocationChecker(async () => false);
});

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const OID = (n) => String(n).padStart(24, 'b');

/** Minimal in-memory group store — throws if an unexpected method is touched. */
const fakeGroups = () => {
  const members = new Map([[`${OID(1)}:${OID(9)}`, 'admin']]);
  const requests = new Map();
  return {
    __seedRequest(r) { requests.set(String(r._id), r); },
    async createGroup(input) {
      return { id: OID(1), ...input, createdBy: input.createdBy };
    },
    async getGroup(id) {
      return String(id) === OID(1)
        ? { id: OID(1), name: 'Hustlers', joinPolicy: 'approval', createdBy: OID(9), pinnedMessageId: null }
        : null;
    },
    async updateGroup(id, patch) {
      return { id: String(id), name: 'Hustlers', ...patch };
    },
    async memberRole(gid, pid) {
      return members.get(`${gid}:${pid}`) ?? null;
    },
    async membersWithProfiles(gid) {
      return [...members.entries()]
        .filter(([k]) => k.startsWith(`${gid}:`))
        .map(([k, role]) => ({ id: k.split(':')[1], role, muted: false }));
    },
    async listRequests() { return []; },
    async findRequestById(id) { return requests.get(String(id)) ?? null; },
    async decideRequest(id, { decision }) {
      const r = requests.get(String(id));
      if (r) r.status = decision === 'approve' ? 'approved' : 'rejected';
      return r ?? null;
    },
    async addMember(gid, pid) {
      members.set(`${gid}:${pid}`, 'member');
      return true;
    },
    async reportMessage() { return { created: true }; },
    async readStates() { return []; },
    async findGroupMessage() {
      return { _id: OID(70), id: OID(70), groupId: OID(1), senderId: OID(2), body: 'spammy' };
    },
    async listAdminIds() { return [OID(9)]; },
    async isMember(gid, pid) { return members.has(`${gid}:${pid}`); },
    async isBanned() { return false; },
    async memberCount() { return 1; },
    async requestJoin(gid, pid) {
      members.set(`${gid}:${pid}:requested`, 'pending');
      return { created: true };
    },
    async findAnyRequest() { return null; },
    async findByTeamId(tid) {
      return String(tid) === OID(6) ? { id: OID(8), name: 'Orphan', joinPolicy: 'approval' } : null;
    },
    async listBans() { return [{ partnerId: OID(2), reason: 'spam', name: 'Spammer' }]; },
  };
};

const fakeImages = (url = 'https://img.test/group.png') => ({
  uploaded: [],
  destroyed: [],
  async upload(buffer, { publicId } = {}) {
    this.uploaded.push({ bytes: buffer.length, publicId });
    return { url };
  },
  async destroy(publicId) {
    this.destroyed.push(publicId);
    return true;
  },
});

const buildApp = (over = {}) => {
  const app = express();
  app.use(express.json());
  app.use(buildGroupRouter({
    groups: fakeGroups(),
    stored: { list: async () => [] },
    notify: { execute: async () => ({}) },
    partners: { findById: async () => ({ _id: 'stub' }), find: async () => [] },
    teams: { findById: async () => { throw new Error('should not reach teams'); } },
    audit: { record: () => {} },
    images: fakeImages(),
    ...over,
  }));
  app.use(errorMiddleware);
  return app;
};

const token = (n = 9) => jwt.sign({ id: OID(n) }, process.env.JWTTOKENSECRET);

describe('group routes', () => {
  it('requires auth under /groups (401 without token)', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/groups/mine`);
    assert.equal(res.status, 401);
  });

  it('rejects malformed ids before any store touch', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const auth = { authorization: `Bearer ${token()}` };
    const badGet = await fetch(`http://127.0.0.1:${port}/groups/nope`, { headers: auth });
    assert.equal(badGet.status, 400);
    const badJoin = await fetch(`http://127.0.0.1:${port}/groups/nope/join`, { method: 'POST', headers: auth });
    assert.equal(badJoin.status, 400);
  });

  it('creates a group and serves it back to members only', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const headers = { authorization: `Bearer ${token()}`, 'content-type': 'application/json' };

    const created = await fetch(`http://127.0.0.1:${port}/groups/`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Hustlers' }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.data.name, 'Hustlers');

    // Strangers get 404 (never leak existence); members get the group.
    const stranger = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}`, {
      headers: { authorization: `Bearer ${token(2)}` },
    });
    assert.equal(stranger.status, 404);
    const member = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}`, { headers });
    assert.equal(member.status, 200);
  });

  it('queues join requests for approval groups', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const outsider = { authorization: `Bearer ${token(3)}` };
    const res = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/join`, { method: 'POST', headers: outsider });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.pending, true);
  });

  it('serves the ban list to admins, hides it from strangers', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const admin = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/bans`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    assert.equal(admin.status, 200);
    const bans = await admin.json();
    assert.equal(bans.data.length, 1);
    const stranger = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/bans`, {
      headers: { authorization: `Bearer ${token(2)}` },
    });
    assert.equal(stranger.status, 404);
  });

  it('approves and rejects join requests (covers the admin fan-out)', async (t) => {
    const groups = fakeGroups();
    groups.__seedRequest({ _id: OID(60), id: OID(60), groupId: OID(1), partnerId: OID(4), status: 'pending' });
    groups.__seedRequest({ _id: OID(61), id: OID(61), groupId: OID(1), partnerId: OID(5), status: 'pending' });
    const app = buildApp({ groups });
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const admin = { authorization: `Bearer ${token()}` };

    const ok = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/requests/${OID(60)}/decision`, {
      method: 'POST', headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.decision, 'approved');

    const no = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/requests/${OID(61)}/decision`, {
      method: 'POST', headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject' }),
    });
    assert.equal(no.status, 200);
    assert.equal((await no.json()).data.decision, 'rejected');

    // Garbage request ids still 400 before any fan-out.
    const bad = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/requests/nope/decision`, {
      method: 'POST', headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(bad.status, 400);
  });

  it('accepts message reports and notifies admins', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: OID(70), reason: 'spam' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).message.includes('notified'), true);
  });

  it('uploads a group avatar for admins, refuses strangers', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();

    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'avatar.png');
    const res = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/photo`, {
      method: 'POST', headers: { authorization: `Bearer ${token()}` }, body: form,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.photo, 'https://img.test/group.png');

    const strangerForm = new FormData();
    strangerForm.append('photo', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'avatar.png');
    const stranger = await fetch(`http://127.0.0.1:${port}/groups/${OID(1)}/photo`, {
      method: 'POST', headers: { authorization: `Bearer ${token(2)}` }, body: strangerForm,
    });
    assert.equal(stranger.status, 403);
  });

  it('resolves-or-creates the team group chat for team members', async (t) => {
    const teams = {
      findById: async (id) => (String(id) === OID(5)
        ? { _id: OID(5), teamName: 'Hustlers Cell', description: '', partnerId: OID(9), members: [OID(9)] }
        : null),
    };
    const app = buildApp({ teams });
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/groups/by-team/${OID(5)}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.joined, true);
    assert.equal(body.data.created, true);
    assert.ok(body.data.groupId);
  });

  it('refuses the team chat to non-team-members and unknown teams', async (t) => {
    const teams = {
      findById: async (id) => (String(id) === OID(5)
        ? { _id: OID(5), teamName: 'Hustlers Cell', description: '', partnerId: OID(9), members: [OID(9)] }
        : null),
    };
    const app = buildApp({ teams });
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();

    const stranger = await fetch(`http://127.0.0.1:${port}/groups/by-team/${OID(5)}`, {
      headers: { authorization: `Bearer ${token(2)}` },
    });
    assert.equal(stranger.status, 403);

    const orphan = await fetch(`http://127.0.0.1:${port}/groups/by-team/${OID(6)}`, {
      headers: { authorization: `Bearer ${token(2)}` },
    });
    assert.equal(orphan.status, 200);
    const orphanBody = await orphan.json();
    assert.equal(orphanBody.data.teamGone, true);
    assert.equal(orphanBody.data.groupId, OID(8));

    const missing = await fetch(`http://127.0.0.1:${port}/groups/by-team/${OID(7)}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    assert.equal(missing.status, 404);

    const bad = await fetch(`http://127.0.0.1:${port}/groups/by-team/nope`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    assert.equal(bad.status, 400);
  });

  it('serves a roster-free invite preview for link sharing', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/groups/invite/${OID(1)}`, {
      headers: { authorization: `Bearer ${token(2)}` },
    });
    assert.equal(res.status, 200);
    const invite = await res.json();
    assert.equal(invite.data.name, 'Hustlers');
    assert.ok(!('members' in invite.data));

    const missing = await fetch(`http://127.0.0.1:${port}/groups/invite/${OID(9)}`, {
      headers: { authorization: `Bearer ${token(2)}` },
    });
    assert.equal(missing.status, 404);

    const unauth = await fetch(`http://127.0.0.1:${port}/groups/invite/${OID(1)}`);
    assert.equal(unauth.status, 401);
  });
});
