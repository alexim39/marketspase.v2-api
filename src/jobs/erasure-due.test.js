import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runErasureDueJob } from './erasure-due.js';

const DAY = 86400000;
const now = new Date('2026-06-01T00:00:00Z');

/** In-memory partners honoring the comparison operators the job relies on
 *  (including BSON's null-below-dates ordering for $lte — the trap the
 *  due-query guards exist for). */
const memPartners = (rows) => {
  const data = rows.map((r) => ({ ...r }));
  const val = (doc, k) => doc[k];
  const match = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
    const v = val(doc, k);
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        const a = arg instanceof Date ? arg.getTime() : arg;
        const has = v !== undefined;
        const t = v instanceof Date ? v.getTime() : v;
        switch (op) {
          case '$gt': return has && !(t === null) && t > a;
          case '$gte': return has && t !== null && t >= a;
          case '$lt': return has && t !== null && t < a;
          // BSON orders null (and missing) BELOW every date/number.
          case '$lte': return !has || t === null || t <= a;
          case '$ne': return !has || t === null || t !== a;
          case '$exists': return arg ? has : !has;
          case '$in': return Array.isArray(arg) && arg.includes(v);
          default: return false;
        }
      });
    }
    return v === cond;
  });
  const chain = (rows) => ({
    _rows: rows,
    select() { return this; },
    limit(n) { this._rows = this._rows.slice(0, n); return this; },
    lean() { return Promise.resolve(this._rows.map((r) => ({ ...r }))); },
  });
  return {
    finds: [],
    lastFind: null,
    updates: [],
    find(filter) {
      this.finds.push(filter);
      this.lastFind = filter;
      return chain(data.filter((d) => match(d, filter)));
    },
    async findById(id) {
      const r = data.find((d) => String(d._id) === String(id));
      return r ? { ...r } : null;
    },
    async updateOne(filter, update) {
      const hit = data.find((d) => match(d, filter));
      if (!hit) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(hit, update.$set);
      if (update.$unset) for (const k of Object.keys(update.$unset)) delete hit[k];
      this.updates.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async countDocuments(filter) {
      return data.filter((d) => match(d, filter)).length;
    },
    row(id) { return data.find((d) => String(d._id) === String(id)); },
  };
};

const dueRow = (over = {}) => ({
  _id: 'due1', name: 'Ama', surname: 'K', username: 'amak', email: 'a@x.test',
  role: 'user', balance: 0, partnerOf: null,
  eraseRequestedAt: new Date(now.getTime() - 30 * DAY),
  eraseScheduledFor: new Date(now.getTime() - 1000),
  eraseReminderAt: new Date(now.getTime() - 3 * DAY),
  ...over,
});

const jobDeps = (rows, extra = {}) => {
  const calls = { erase: [], txns: [], mails: [], audits: [] };
  return {
    calls,
    deps: {
      now,
      partners: memPartners(rows),
      erase: { async execute(input) { calls.erase.push(input); return { erased: { id: input.partnerId }, removed: {} }; } },
      recordTransaction: async (doc) => { calls.txns.push(doc); return doc; },
      send: async (to, subject, html) => { calls.mails.push({ to, subject, html }); return true; },
      audit: async (entry) => { calls.audits.push(entry); return null; },
      ...extra,
    },
  };
};

describe('erasure-due job', () => {
  it('executes due rows: erase with self flag, forfeiture, audit, notices', async () => {
    const { calls, deps } = jobDeps([dueRow({ balance: 1500 })]);
    const out = await runErasureDueJob(deps);
    assert.equal(out.executed, 1);
    assert.deepEqual(calls.erase, [{ requesterId: 'due1', partnerId: 'due1', viaSelfRequest: true }]);
    assert.equal(calls.txns.length, 1);
    assert.equal(calls.txns[0].amount, -1500);
    assert.equal(calls.txns[0].transactionType, 'forfeiture');
    assert.ok(calls.audits.some((a) => a.action === 'account.erase-self'));
    // requester receipt + admin notice (no upline on this row)
    assert.ok(calls.mails.some((m) => m.to === 'a@x.test' && /deleted/.test(m.subject)));
  });

  it('never sweeps unstamped partners (bare $lte would match null/missing)', async () => {
    const { calls, deps } = jobDeps([
      { _id: 'plain', name: 'P', username: 'p', email: 'p@x.test', role: 'user', balance: 0 },
      dueRow(),
    ]);
    const out = await runErasureDueJob(deps);
    assert.equal(out.executed, 1);
    assert.deepEqual(calls.erase.map((c) => c.partnerId), ['due1']);
    // The due filter must carry the null/missing guards (the reminder
    // filter also has $lte — tell them apart by its absent $gt).
    const dueFilter = deps.partners.finds.find((f) => f.eraseScheduledFor?.$lte && !f.eraseScheduledFor?.$gt);
    assert.ok(dueFilter, 'due sweep query issued');
    const f = dueFilter.eraseScheduledFor;
    assert.ok(f.$exists === true && f.$ne === null && f.$lte instanceof Date);
  });

  it('aborts on regressed gates: stamps cleared, requester told, erase untouched', async () => {
    const row = dueRow({ _id: 'busy1' });
    const downline = { _id: 'kid1', partnerOf: 'busy1', role: 'user', email: 'k@x.test' };
    const { calls, deps } = jobDeps([row, downline]);
    const out = await runErasureDueJob(deps);
    assert.equal(out.aborted, 1);
    assert.equal(calls.erase.length, 0);
    assert.equal(calls.txns.length, 0);
    assert.equal(deps.partners.row('busy1').eraseScheduledFor, undefined);
    assert.ok(calls.mails.some((m) => m.to === 'a@x.test' && /cancelled/i.test(m.subject)));
    assert.ok(calls.audits.some((a) => a.action === 'account.erase-aborted'));
  });

  it('executes mid-tree rows with downline (usecase moves them at execution)', async () => {
    const row = dueRow({ _id: 'mid1', partnerOf: 'grand1' });
    const downline = { _id: 'kid1', partnerOf: 'mid1', role: 'user', email: 'k@x.test' };
    const { calls, deps } = jobDeps([row, downline]);
    const out = await runErasureDueJob(deps);
    assert.equal(out.executed, 1);
    assert.equal(out.aborted, 0);
    assert.deepEqual(calls.erase.map((c) => c.partnerId), ['mid1']);
  });

  it('reminds once inside 48h via the atomic claim, then stays quiet', async () => {
    const row = {
      _id: 'soon1', name: 'S', username: 's', email: 's@x.test', role: 'user', balance: 0,
      eraseRequestedAt: new Date(now.getTime() - 28 * DAY),
      eraseScheduledFor: new Date(now.getTime() + 20 * 3600000),
      eraseReminderAt: null,
    };
    const first = jobDeps([row]);
    const out1 = await runErasureDueJob(first.deps);
    assert.equal(out1.reminded, 1);
    assert.equal(out1.executed, 0);
    // Second run sees the stamp — no resend.
    const sent = first.calls.mails.length;
    const out2 = await runErasureDueJob({ ...first.deps, partners: memPartners([
      { ...row, eraseReminderAt: new Date(now.getTime()) },
    ]) });
    assert.equal(out2.reminded, 0);
    assert.equal(first.calls.mails.length, sent);
  });

  it('keeps stamps on unknown errors so the next run retries', async () => {
    const { calls, deps } = jobDeps([dueRow({ _id: 'flaky1' })], {
      erase: { async execute(input) { calls.erase.push(input); throw new Error('db blip'); } },
    });
    const out = await runErasureDueJob(deps);
    assert.equal(out.executed, 0);
    assert.equal(calls.erase.length, 1);
    assert.equal(out.failed.length, 1);
    assert.ok(deps.partners.row('flaky1').eraseScheduledFor instanceof Date);
  });
});
