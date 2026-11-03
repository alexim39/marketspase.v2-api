import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setRevocationChecker } from '../../identity-access/infrastructure/SessionRevocation.js';
import { roomFor, groupRoom, takeToken, verifySocketToken, cookieToken, buildMessagingGateway } from './Messaging.gateway.js';

const OID = (n) => String(n).padStart(24, 'a');

before(() => {
  process.env.JWTTOKENSECRET = process.env.JWTTOKENSECRET || 'test-secret';
  setRevocationChecker(async (id) => id === 'revoked-user');
});

describe('gateway helpers', () => {
  it('rooms are namespaced per partner', () => {
    assert.equal(roomFor('abc'), 'user:abc');
  });

  it('takeToken allows up to the limit per window, then blocks', () => {
    const bucket = [];
    for (let i = 0; i < 30; i++) assert.equal(takeToken(bucket, 1000 + i, 30), true);
    assert.equal(takeToken(bucket, 1000 + 30, 30), false);
    assert.equal(takeToken(bucket, 1000 + 60001, 30), true);
  });

  it('verifySocketToken accepts a live session', async () => {
    const token = jwt.sign({ id: 'partner-1' }, process.env.JWTTOKENSECRET);
    assert.equal(await verifySocketToken(token), 'partner-1');
  });

  it('verifySocketToken rejects garbage and revoked sessions', async () => {
    await assert.rejects(verifySocketToken('nope'), /token/i);
    const revoked = jwt.sign({ id: 'revoked-user' }, process.env.JWTTOKENSECRET);
    await assert.rejects(verifySocketToken(revoked), /revoked/i);
  });

  it('reads the jwt cookie as an auth fallback', async () => {
    assert.equal(cookieToken('jwt=abc.def.ghi; other=1'), 'abc.def.ghi');
    assert.equal(cookieToken('other=1; jwt=xyz'), 'xyz');
    assert.equal(cookieToken(null), null);
    assert.equal(cookieToken('other=1'), null);
    const fromCookie = cookieToken('jwt=' + jwt.sign({ id: 'partner-1' }, process.env.JWTTOKENSECRET));
    assert.equal(await verifySocketToken(fromCookie), 'partner-1');
  });
});

const fakeSocket = (partnerId) => {
  const handlers = {};
  return {
    data: { partnerId },
    handlers,
    joined: [],
    on(event, fn) { handlers[event] = fn; },
    join(room) { this.joined.push(room); },
    async fire(event, payload) {
      let replied;
      await handlers[event](payload, (v) => { replied = v; });
      return replied;
    },
  };
};

const gatewayDeps = (over = {}) => {
  const emitted = [];
  const rooms = { to: (id) => ({ emit: (ev, payload) => emitted.push({ to: id, ev, payload }) }) };
  return {
    emitted,
    rooms,
    direct: {
      async execute({ senderId, to, body }) {
        return { id: OID(9), senderId, recipientId: to, body, createdAt: new Date().toISOString() };
      },
    },
    read: { async execute() { return { read: true }; } },
    findMessage: async () => ({ senderId: OID(2) }),
    network: { async findNode() { return null; }, async findChildren() { return []; } },
    partners: {
      async updateOne() { return null; },
      findById() { return { select: () => ({ lean: async () => ({ name: 'Ada', surname: 'Obi' }) }) }; },
    },
    ...over,
  };
};

describe('messaging gateway', () => {
  it('sends through the shared use case and emits to both rooms', async () => {
    const deps = gatewayDeps();
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    const ack = await socket.fire('message:send', { to: OID(2), body: 'hello', clientId: 'c1' });
    assert.equal(ack.ok, true);
    assert.equal(ack.clientId, 'c1');
    const news = deps.emitted.filter((e) => e.ev === 'message:new');
    assert.deepEqual(news.map((e) => e.to).sort(), [OID(1), OID(2)].sort());
  });

  it('rejects strangers, empties and rate floods without touching the use case', async () => {
    let calls = 0;
    const deps = gatewayDeps({ direct: { async execute() { calls++; return { id: OID(9) }; } } });
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    assert.match((await socket.fire('message:send', { to: 'nope', body: 'hi' })).error, /recipient/i);
    assert.match((await socket.fire('message:send', { to: OID(2), body: '   ' })).error, /1–2000/);
    for (let i = 0; i < 30; i++) await socket.fire('message:send', { to: OID(2), body: `m${i}` });
    assert.match((await socket.fire('message:send', { to: OID(2), body: 'flood' })).error, /Slow down/);
    assert.equal(calls, 30);
  });

  it('relays typing and read receipts to the other side', async () => {    const deps = gatewayDeps();
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    await socket.fire('typing:start', { to: OID(2) });
    assert.deepEqual(deps.emitted.at(-1), { to: OID(2), ev: 'typing', payload: { from: OID(1), typing: true } });
    const ack = await socket.fire('message:read', { messageId: OID(7) });
    assert.equal(ack.ok, true);
    assert.deepEqual(deps.emitted.at(-1), { to: OID(2), ev: 'message:read', payload: { messageId: OID(7), readerId: OID(1) } });
  });
});

describe('offline push nudge', () => {
  const pushDeps = (live, send) => ({
    hasLiveSockets: () => live,
    push: {
      sender: { async send(payload) { return send(payload); } },
      subscriptions: {
        async listSubscriptions() { return [{ endpoint: 'e1' }]; },
        async pruneSubscription(id, endpoint) { pruned.push(endpoint); },
      },
    },
  });
  let pruned;
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('pushes when the recipient has no live socket', async () => {
    pruned = [];
    const sent = [];
    const deps = gatewayDeps(pushDeps(false, async (p) => { sent.push(p); return {}; }));
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    const ack = await socket.fire('message:send', { to: OID(2), body: 'hello there' });
    assert.equal(ack.ok, true);
    await tick();
    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /Ada Obi/);
    assert.equal(sent[0].subscription.endpoint, 'e1');
    assert.deepEqual(pruned, []);
  });

  it('stays quiet when the recipient is live', async () => {
    pruned = [];
    let calls = 0;
    const deps = gatewayDeps(pushDeps(true, async () => { calls++; return {}; }));
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    await socket.fire('message:send', { to: OID(2), body: 'hi' });
    await tick();
    assert.equal(calls, 0);
  });

  it('prunes dead endpoints instead of failing', async () => {
    pruned = [];
    const deps = gatewayDeps(pushDeps(false, async () => ({ gone: true })));
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    const ack = await socket.fire('message:send', { to: OID(2), body: 'hi' });
    assert.equal(ack.ok, true);
    await tick();
    assert.deepEqual(pruned, ['e1']);
  });
});

describe('group chat over sockets', () => {
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const baseGroup = {
    async isMember(gid, pid) { return String(pid) === OID(1); },
    async createGroupMessage({ groupId, senderId, body }) {
      return { id: OID(5), groupId, senderId, body, createdAt: new Date().toISOString() };
    },
    async memberGroups() { return [OID(7)]; },
    async getGroup() { return { name: 'Hustlers' }; },
    async notifyTargets() { return [OID(2)]; },
  };
  const basePush = {
    sent: [],
    subscriptions: { async listSubscriptions() { return [{ endpoint: 'e9' }]; }, async pruneSubscription() {} },
    async sender() { return { delivered: true }; },
  };
  const groupDeps = (over = {}) => gatewayDeps({
    groups: { ...baseGroup, ...(over.groups ?? {}) },
    push: { ...basePush, ...(over.push ?? {}) },
    ...(over.hasLiveSockets !== undefined ? { hasLiveSockets: over.hasLiveSockets } : {}),
  });

  it('fans group messages out to the group room after a membership check', async () => {
    const deps = groupDeps();
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    assert.ok(socket.joined.includes(roomFor(OID(1))), 'joins own room on connect');
    assert.ok(socket.joined.includes(`group:${OID(7)}`), 'auto-joins member groups on connect');
    const ack = await socket.fire('message:send', { groupId: OID(7), body: 'team huddle', clientId: 'g1' });
    assert.equal(ack.ok, true);
    assert.equal(ack.clientId, 'g1');
    const news = deps.emitted.filter((e) => e.ev === 'message:new');
    assert.equal(news.length, 1);
    assert.equal(news[0].to, `group:${OID(7)}`);
    assert.equal(news[0].payload.groupId, OID(7));
  });

  it('validates group attachments and allows attachment-only messages', async () => {
    const seen = [];
    const deps = groupDeps({ groups: { ...baseGroup, async createGroupMessage(input) { seen.push(input); return { id: OID(5), ...input }; } } });
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    const bad = await socket.fire('message:send', {
      groupId: OID(7), body: 'x',
      attachments: [{ url: 'http://evil/x.png', mime: 'image/png', size: 10 }],
    });
    assert.equal(bad.ok, false);
    const good = await socket.fire('message:send', {
      groupId: OID(7), body: '',
      attachments: [{ url: 'https://img.test/a.png', mime: 'image/png', size: 10 }],
    });
    assert.equal(good.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].attachments.length, 1);
    const empty = await socket.fire('message:send', { groupId: OID(7), body: '   ' });
    assert.equal(empty.ok, false);
  });

  it('rejects strangers and validates group payloads', async () => {
    const deps = groupDeps({ groups: { ...groupDeps().groups, async isMember() { return false; } } });
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(2));
    await onConnection(null)(socket);
    const ack = await socket.fire('message:send', { groupId: OID(7), body: 'sneaky' });
    assert.equal(ack.ok, false);
    assert.match(ack.error, /not in this group/);
    const bad = await socket.fire('message:send', { groupId: 'nope', body: 'x' });
    assert.equal(bad.ok, false);
  });

  it('joins group rooms only after a membership check', async () => {
    const deps = groupDeps();
    const { onConnection } = buildMessagingGateway(deps);
    const socket = { ...fakeSocket(OID(1)), joined: [], leave() {} };
    await onConnection(null)(socket);
    // Auto-join on connect covers member groups; explicit join is idempotent.
    assert.ok(socket.joined.includes(`group:${OID(7)}`));
    const ok = await socket.fire('group:join', { groupId: OID(7) });
    assert.equal(ok.ok, true);
    const nope = await socket.fire('group:join', { groupId: 'bad' });
    assert.equal(nope.ok, false);
  });

  it('pushes group messages to offline unmuted members only', async () => {
    const sent = [];
    const seen = [];
    const deps = groupDeps({
      hasLiveSockets: () => false,
      groups: {
        async isMember() { return true; },
        async createGroupMessage({ groupId, senderId, body }) {
          return { id: OID(5), groupId, senderId, body, createdAt: new Date().toISOString() };
        },
        async memberGroups() { return [OID(7)]; },
        async getGroup() { return { name: 'Hustlers' }; },
        async notifyTargets() { return [OID(2), OID(3)]; },
      },
      push: {
        sender: { async send({ title }) { sent.push(title); return { delivered: true }; } },
        subscriptions: { async listSubscriptions(id) { seen.push(id); return id === OID(2) ? [{ endpoint: 'e2' }] : []; }, async pruneSubscription() {} },
      },
    });
    const { onConnection } = buildMessagingGateway(deps);
    const socket = fakeSocket(OID(1));
    await onConnection(null)(socket);
    const ack = await socket.fire('message:send', { groupId: OID(7), body: 'hi team' });
    assert.equal(ack.ok, true);
    await tick();
    assert.deepEqual(seen.sort(), [OID(2), OID(3)].sort());
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Hustlers/);
  });
});
