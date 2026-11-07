#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

/**
 * Legacy-route usage audit.
 *
 * Reads structured API logs (one JSON object per line), keeps `http_request`
 * rows marked `legacy: true`, and prints request counts per method + path.
 * Run it on a captured stdout/stderr window before deleting a route:
 *
 *   node scripts/legacy-route-audit.mjs api.log
 *   Get-Content api.log | npm run audit:legacy
 *
 * Paths are normalised so `/prospect/getById/<id>` groups as one route.
 */
export const normalizePath = (path) => String(path ?? '')
  .replace(/[a-fA-F0-9]{24}/g, ':id')
  .replace(/\/\d+(?=\/|$)/g, '/:n');

export const summarize = (records, { since = null } = {}) => {
  const cutoff = since ? new Date(since).getTime() : null;
  const routes = new Map();

  for (const record of records) {
    if (!record || record.event !== 'http_request' || record.legacy !== true) continue;
    const ts = new Date(record.ts ?? 0).getTime();
    if (cutoff && Number.isFinite(ts) && ts < cutoff) continue;

    const path = normalizePath(record.path);
    const method = String(record.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;
    const row = routes.get(key) ?? {
      method,
      path,
      count: 0,
      statuses: {},
      lastSeen: null,
    };
    row.count += 1;
    const status = String(record.status ?? '');
    row.statuses[status] = (row.statuses[status] ?? 0) + 1;
    if (!row.lastSeen || String(record.ts ?? '') > row.lastSeen) {
      row.lastSeen = String(record.ts ?? '');
    }
    routes.set(key, row);
  }

  return [...routes.values()]
    .sort((a, b) => a.count - b.count || a.path.localeCompare(b.path));
};

export const formatReport = (rows) => {
  if (rows.length === 0) return 'No legacy requests found in this log window.';
  const lines = [
    `Legacy route usage — ${rows.reduce((sum, row) => sum + row.count, 0)} request(s), ${rows.length} route(s)`,
    '',
    'count  method  path                                   statuses',
    '-----  ------  -------------------------------------  --------',
  ];
  for (const row of rows) {
    const statuses = Object.entries(row.statuses)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status || '?'}:${count}`)
      .join(' ');
    lines.push(
      `${String(row.count).padStart(5)}  ${row.method.padEnd(6)}  ${row.path.padEnd(37)}  ${statuses}`,
    );
  }
  return lines.join('\n');
};

const readRecords = async (stream) => {
  const records = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON framework noise is ignored; only structured request lines count.
    }
  }
  return records;
};

const main = async () => {
  const args = process.argv.slice(2);
  const sinceArg = args.find((arg) => arg.startsWith('--since='));
  const json = args.includes('--json');
  const file = args.find((arg) => !arg.startsWith('--'));

  const input = file ? createReadStream(file) : process.stdin;
  const records = await readRecords(input);
  const rows = summarize(records, { since: sinceArg?.split('=')[1] ?? null });

  if (json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(rows)}\n`);
  }
};

if (process.argv[1] && process.argv[1].endsWith('legacy-route-audit.mjs')) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
