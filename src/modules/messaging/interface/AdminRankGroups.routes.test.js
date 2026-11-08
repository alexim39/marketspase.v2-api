import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAdminRankGroupsRouter } from './AdminRankGroups.routes.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(server));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const OID = (n) => String(n).padStart(24, 'c');

const groups = () => {
  const rows = [
    { id: OID(1), rankGroup: 'Partner', name: 'Partner Circle', description: 'Partner room', joinPolicy: 'approval', createdBy: OID(9), pinnedMessageId: OID(11) },
    { id: OID(2), rankGroup: 'Builder', name: 'Builder Circle', description: 'Builder room', joinPolicy: 'approval', createdBy: OID(9), pinnedMessageId: OID(12) },
    { id: OID(3), rankGroup: 'Leader', name: 'Leader Circle', description: 'Leader room', joinPolicy: 'approval', createdBy: OID(9), pinnedMessageId: OID(13) },
    { id: OID(4), rankGroup: 'Ambassador', name: 'Ambassador Circle', description: 'Ambassador room', joinPolicy: 'approval', createdBy: OID(9), pinnedMessageId: OID(14) },
  ];
  const members = [
    { id: OID(9), name: 'Admin', username: 'admin', photo: null, role: 'admin', muted: false, joinedAt: new Date(0).toISOString() },
    { id: OID(5), name: 'Member', username: 'member', photo: null, role: 'member', muted: false, joinedAt: new Date(0).toISOString() },
  ];
  const messages = [
    { id: OID(11), groupId: OID(1), senderId: OID(9), body: 'Welcome to Partner Circle', attachments: [], createdAt: new Date(0).toISOString() },
    { id: OID(21), groupId: OID(1), senderId: OID(5), body: 'Hello team', attachments: [], createdAt: new Date(1).toISOString() },
  ];
  return {
    created: [],
    deleted: [],
    async listRankGroups() { return rows; },
    async findByRankGroup(rank) { return rows.find((r) => r.rankGroup === rank) ?? null; },
    async memberCount(id) { return Number(String(id).slice(-1)); },
    async listAdminIds() { return [OID(9)]; },
    async isMember() { return true; },
    async isBanned() { return false; },
    async addMember() { return true; },
    async memberRole(_gid, pid) { return String(pid) === OID(9) ? 'admin' : 'member'; },
    async membersWithProfiles() { return members; },
    async thread() { return messages; },
    async listBans() { return []; },
    async listReports() { return []; },
    async findGroupMessage(id) { return messages.find((m) => String(m.id) === String(id)) ?? null; },
    async deleteGroupMessage(id) { this.deleted.push(String(id)); return true; },
    async createGroupMessage({ groupId, senderId, body }) {
      const message = {
        id: OID(30 + this.created.length), groupId, senderId, body, attachments: [],
        createdAt: new Date().toISOString(),
      };
      this.created.push(message);
      return message;
    },
    async updateGroup(id, patch) {
      const group = rows.find((r) => String(r.id) === String(id));
      if (group) Object.assign(group, patch);
      return group ?? null;
    },
    async getGroup(id) { return rows.find((r) => String(r.id) === String(id)) ?? null; },
    async banMember() { return true; },
    async unbanMember() { return true; },
  };
};

const rankGroups = () => ({
  async ensureGroups() { return { ready: true, created: 0, total: 4, cached: true }; },
  async syncAll() { return { synced: 7, skipped: 0 }; },
});

const buildApp = (over = {}) => {
  const app = express();
  app.use(express.json());
  app.use(buildAdminRankGroupsRouter({
    groups: groups(),
    rankGroups: rankGroups(),
    auth: (req, _res, next) => { req.auth = { partnerId: OID(9), role: 'admin' }; next(); },
    admin: (_req, _res, next) => next(),
    ...over,
  }));
  return app;
};

describe('admin rank group routes', () => {
  it('returns the four official groups with health and counts', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.length, 4);
    assert.deepEqual(body.data.map((r) => r.rank), ['Partner', 'Builder', 'Leader', 'Ambassador']);
    assert.equal(body.data[0].name, 'Partner Circle');
    assert.equal(body.data[0].memberCount, 1);
    assert.equal(body.data[0].adminCount, 1);
    assert.equal(body.data[0].pinned, true);
  });

  it('repairs groups and reports the sync result', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/sync`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.seed.ready, true);
    assert.equal(body.data.sync.synced, 7);
  });

  it('serves the moderation detail with messages, members and pinned welcome', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/Partner`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.name, 'Partner Circle');
    assert.equal(body.data.memberCount, 2);
    assert.equal(body.data.adminCount, 1);
    assert.equal(body.data.pinnedMessage.body, 'Welcome to Partner Circle');
    assert.equal(body.data.messages.length, 2);
    assert.equal(body.data.messages[0].senderName, 'Admin');
    assert.equal(body.data.members.length, 2);
  });

  it('sends, deletes and re-pins group content from the admin desk', async (t) => {
    const store = groups();
    const app = buildApp({ groups: store });
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const send = await fetch(`${base}/Partner/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Admin reply' }),
    });
    assert.equal(send.status, 201);
    assert.equal(store.created.length, 1);
    assert.equal(store.created[0].body, 'Admin reply');

    const remove = await fetch(`${base}/Partner/messages/${OID(21)}`, { method: 'DELETE' });
    assert.equal(remove.status, 200);
    assert.deepEqual(store.deleted, [OID(21)]);

    const pin = await fetch(`${base}/Partner/pinned`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'New welcome' }),
    });
    assert.equal(pin.status, 200);
    assert.equal(store.created.at(-1).body, 'New welcome');
  });
});
