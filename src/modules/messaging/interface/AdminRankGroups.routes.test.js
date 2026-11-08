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
    { id: OID(1), rankGroup: 'Partner', name: 'Partner Circle', description: 'Partner room', joinPolicy: 'approval', pinnedMessageId: OID(11) },
    { id: OID(2), rankGroup: 'Builder', name: 'Builder Circle', description: 'Builder room', joinPolicy: 'approval', pinnedMessageId: OID(12) },
    { id: OID(3), rankGroup: 'Leader', name: 'Leader Circle', description: 'Leader room', joinPolicy: 'approval', pinnedMessageId: OID(13) },
    { id: OID(4), rankGroup: 'Ambassador', name: 'Ambassador Circle', description: 'Ambassador room', joinPolicy: 'approval', pinnedMessageId: OID(14) },
  ];
  return {
    async listRankGroups() { return rows; },
    async memberCount(id) { return Number(String(id).slice(-1)); },
    async listAdminIds() { return [OID(9)]; },
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
});
