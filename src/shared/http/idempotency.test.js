import test from 'node:test';
import assert from 'node:assert/strict';
import { idempotency } from './idempotency.js';

const makeStore = () => {
  const rows = new Map();
  return {
    rows,
    async claim(input) {
      const id = `${input.actorId}:${input.key}`;
      if (rows.has(id)) return { record: rows.get(id), created: false };
      const record = { _id: id, ...input };
      rows.set(id, record);
      return { record, created: true };
    },
    async complete(id, status, body) {
      const row = [...rows.values()].find((r) => r._id === id);
      if (row) Object.assign(row, { status: 'completed', responseStatus: status, responseBody: body });
    },
    async abandon(id) {
      rows.delete(id);
    },
  };
};

const makeRes = () => {
  const out = { headers: {} };
  const res = {
    out,
    statusCode: 200,
    set(key, value) { out.headers[key] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { out.body = body; return res; },
  };
  return res;
};

test('idempotency replays a completed response and rejects a different body', async () => {
  const store = makeStore();
  const mw = idempotency({ store });

  const req = {
    method: 'POST', baseUrl: '/v1', path: '/withdrawals', body: { amountNgn: 1000 },
    headers: { 'idempotency-key': 'abcdefgh' }, cookies: {}, ip: '1.2.3.4',
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  const res = makeRes();
  let nexts = 0;
  await mw(req, res, () => { nexts += 1; });
  res.status(201).json({ ok: true });
  assert.equal(nexts, 1);
  assert.equal(store.rows.size, 1);

  const replay = makeRes();
  await mw(req, replay, () => { throw new Error('must not call next'); });
  assert.equal(replay.statusCode, 201);
  assert.deepEqual(replay.out.body, { ok: true });
  assert.equal(replay.out.headers['Idempotency-Replayed'], 'true');

  const changed = { ...req, body: { amountNgn: 2000 } };
  const conflict = makeRes();
  await mw(changed, conflict, () => { throw new Error('must not call next'); });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.out.body.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('idempotency passes through when no key is supplied', async () => {
  const store = makeStore();
  const mw = idempotency({ store });
  let nexts = 0;
  await mw({ method: 'POST', headers: {}, get: () => undefined }, makeRes(), () => { nexts += 1; });
  assert.equal(nexts, 1);
  assert.equal(store.rows.size, 0);
});
