import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runBirthdayJob } from './birthday.js';
import { userBirthdayEmailTemplate } from '../apps/partner/services/email/birthday.js';

const today = new Date(2026, 10, 11, 8, 0, 0);

const fakePartners = (seed) => {
  const rows = seed.map((row) => ({ suspendedAt: null, birthdayGreetingYear: null, birthdayEmailYear: null, ...row }));
  return {
    rows,
    find(filter) {
      const matched = rows.filter((row) => row.dobMonth === filter.dobMonth
        && row.dobDay === filter.dobDay
        && (filter.suspendedAt !== null || row.suspendedAt == null));
      return { select: () => ({ lean: async () => matched }) };
    },
    async updateOne(filter, update) {
      const row = rows.find((item) => String(item._id) === String(filter._id));
      if (row && update.$set) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
  };
};

const deps = ({ seed, prefs = {}, mailer = async () => {}, notify = async () => {} } = {}) => {
  const partners = fakePartners(seed);
  const sent = [];
  const emailed = [];
  const notified = [];
  return {
    partners,
    sent,
    emailed,
    notified,
    job: {
      partners,
      today,
      preferences: { getPreferences: async (id) => prefs[String(id)] ?? null },
      mailer: async (...args) => { emailed.push(args); return mailer(...args); },
      template: userBirthdayEmailTemplate,
      notify: { execute: async (input) => { notified.push(input); return notify(input); } },
      _sent: sent,
    },
  };
};

const birthdayPartner = (over = {}) => ({
  _id: 'p1',
  name: 'Ada',
  email: 'ada@example.com',
  dobDatePicker: new Date(1990, 10, 11),
  dobMonth: 11,
  dobDay: 11,
  ...over,
});

describe('birthday job', () => {
  it('sends one in-app greeting and one branded email, then records both', async () => {
    const f = deps({ seed: [birthdayPartner()] });
    const result = await runBirthdayJob(f.job);
    assert.equal(result.sent.inApp, 1);
    assert.equal(result.sent.email, 1);
    assert.equal(f.notified.length, 1);
    assert.equal(f.emailed.length, 1);
    assert.equal(f.partners.rows[0].birthdayGreetingYear, 2026);
    assert.equal(f.partners.rows[0].birthdayEmailYear, 2026);
    assert.match(f.emailed[0][2], /MarketSpase/);
    assert.doesNotMatch(f.emailed[0][2], /Diamond Project|c21fg\.online/);
  });

  it('does not send the same channel twice in one year', async () => {
    const f = deps({ seed: [birthdayPartner()] });
    await runBirthdayJob(f.job);
    f.emailed.length = 0;
    f.notified.length = 0;
    const second = await runBirthdayJob(f.job);
    assert.equal(second.sent.inApp, 0);
    assert.equal(second.sent.email, 0);
    assert.equal(second.skipped.alreadySent, 1);
    assert.equal(f.emailed.length, 0);
    assert.equal(f.notified.length, 0);
  });

  it('skips suspended accounts and members who opted out', async () => {
    const suspended = birthdayPartner({ _id: 'p2', email: 'suspended@example.com', suspendedAt: new Date() });
    const optedOut = birthdayPartner({ _id: 'p3' });
    const f = deps({
      seed: [suspended, optedOut],
      prefs: {
        p3: {
          channels: { birthday: { inApp: false, email: false, sms: false, push: false } },
          emailDigest: 'off',
        },
      },
    });
    const result = await runBirthdayJob(f.job);
    assert.equal(result.checked, 1);
    assert.equal(result.sent.inApp, 0);
    assert.equal(result.sent.email, 0);
    assert.equal(result.skipped.optedOut, 1);
  });

  it('honours an email opt-out while still sending the in-app greeting', async () => {
    const f = deps({
      seed: [birthdayPartner()],
      prefs: {
        p1: {
          channels: { birthday: { inApp: true, email: false, sms: false, push: false } },
          emailDigest: 'immediate',
        },
      },
    });
    const result = await runBirthdayJob(f.job);
    assert.equal(result.sent.inApp, 1);
    assert.equal(result.sent.email, 0);
    assert.equal(f.emailed.length, 0);
    assert.equal(f.notified.length, 1);
  });

  it('leaves a failed email unmarked so a retry can send it', async () => {
    const f = deps({
      seed: [birthdayPartner()],
      mailer: async () => { throw new Error('mail unavailable'); },
    });
    const result = await runBirthdayJob(f.job);
    assert.equal(result.sent.inApp, 1);
    assert.equal(result.sent.email, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(f.partners.rows[0].birthdayGreetingYear, 2026);
    assert.equal(f.partners.rows[0].birthdayEmailYear, null);
  });

  it('skips an invalid date without sending or marking the record', async () => {
    const f = deps({ seed: [birthdayPartner({ dobDatePicker: 'not-a-date' })] });
    const result = await runBirthdayJob(f.job);
    assert.equal(result.sent.inApp, 0);
    assert.equal(result.sent.email, 0);
    assert.equal(result.skipped.invalidDate, 1);
    assert.equal(f.partners.rows[0].birthdayGreetingYear, null);
    assert.equal(f.partners.rows[0].birthdayEmailYear, null);
  });
});
