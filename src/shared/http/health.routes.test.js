import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthRouter } from './health.routes.js';

const call = async (router, path = '/') => {
  const layer = router.stack.find((entry) => entry.route?.path === path);
  const handler = layer.route.stack[0].handle;
  let status = 200;
  let body = null;
  const res = {
    set() { return this; },
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler({}, res);
  return { status, body };
};

test('health reports a healthy database', async () => {
  const router = buildHealthRouter({ db: async () => ({ status: 'up', latencyMs: 2 }) });
  const out = await call(router);
  assert.equal(out.status, 200);
  assert.equal(out.body.checks.database.status, 'up');
  assert.equal(typeof out.body.checks.slowQueries.thresholdMs, 'number');
});

test('health returns 503 when the database is down', async () => {
  const router = buildHealthRouter({ db: async () => ({ status: 'down', reason: 'timeout' }) });
  const out = await call(router);
  assert.equal(out.status, 503);
  assert.equal(out.body.status, 'degraded');
});

test('liveness does not touch the database', async () => {
  const router = buildHealthRouter({ db: async () => { throw new Error('must not run'); } });
  const out = await call(router, '/live');
  assert.equal(out.status, 200);
  assert.equal(out.body.status, 'ok');
});
