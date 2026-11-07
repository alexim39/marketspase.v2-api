import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, normalizePath, summarize } from './legacy-route-audit.mjs';

const request = (over = {}) => ({
  event: 'http_request',
  legacy: true,
  method: 'GET',
  path: '/prospect/getById/507f1f77bcf86cd799439011',
  status: 200,
  ts: '2026-01-01T00:00:00.000Z',
  ...over,
});

test('normalizes object ids and numeric path segments', () => {
  assert.equal(
    normalizePath('/prospect/getById/507f1f77bcf86cd799439011'),
    '/prospect/getById/:id',
  );
  assert.equal(normalizePath('/campaign/123/allocate'), '/campaign/:n/allocate');
});

test('only counts legacy http_request rows', () => {
  const rows = summarize([
    request({ path: '/prospect/getById/507f1f77bcf86cd799439011' }),
    request({ path: '/prospect/getById/507f1f77bcf86cd799439012' }),
    request({ legacy: false, path: '/v1/auth/signin' }),
    { event: 'legacy_error', legacy: true, path: '/prospect/create' },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, '/prospect/getById/:id');
  assert.equal(rows[0].count, 2);
});

test('groups statuses and applies the since window', () => {
  const rows = summarize([
    request({ status: 200, ts: '2026-01-01T00:00:00.000Z' }),
    request({ status: 200, ts: '2026-01-02T00:00:00.000Z' }),
    request({ status: 404, ts: '2026-01-03T00:00:00.000Z' }),
    request({ path: '/campaign/visits', ts: '2025-12-31T00:00:00.000Z' }),
  ], { since: '2026-01-02T00:00:00.000Z' });

  const prospect = rows.find((row) => row.path === '/prospect/getById/:id');
  assert.equal(prospect.count, 2);
  assert.deepEqual(prospect.statuses, { 200: 1, 404: 1 });
  assert.equal(rows.some((row) => row.path === '/campaign/visits'), false);
});

test('formats a readable report', () => {
  const rows = summarize([request()]);
  const report = formatReport(rows);
  assert.match(report, /Legacy route usage/);
  assert.match(report, /GET/);
  assert.match(report, /\/prospect\/getById\/:id/);
  assert.equal(formatReport([]), 'No legacy requests found in this log window.');
});
