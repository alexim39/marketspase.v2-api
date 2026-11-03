import test from 'node:test';
import assert from 'node:assert/strict';
import { runDormantNudgeJob } from './dormant-nudge.js';
import { buildDormantNudge } from '../modules/notifications/infrastructure/LifecycleMailer.js';
import { MentionMailer } from '../modules/notifications/infrastructure/MentionMailer.js';
import { DigestMailer } from '../modules/notifications/infrastructure/DigestMailer.js';

const DAY = 86400000;
const NOW = new Date('2026-10-06T09:00:00Z');

const row = (over = {}) => ({
  _id: over._id ?? 'p1',
  name: 'Ada', surname: 'T', username: 'ada', email: 'ada@x.test',
  lastLoginAt: null, createdAt: new Date(NOW.getTime() - 10 * DAY),
  suspendedAt: null, dormantNudgeAt: null,
  ...over,
});

const fakes = (rows) => {
  const sent = [];
  const stamped = [];
  return {
    sent, stamped,
    partners: {
      find: () => ({
        sort: () => ({
          limit: () => ({ lean: async () => rows.map((r) => ({ ...r })) }),
        }),
      }),
      updateOne: async () => {
        stamped.push(true);
        return { modifiedCount: 1 };
      },
    },
    send: async (to, subject, html) => { sent.push({ to, subject, html }); },
  };
};

test('nudge fires once for silent partners, skips the rest', async () => {
  const f = fakes([
    row({ _id: 'silent', lastLoginAt: new Date(NOW.getTime() - 5 * DAY) }),
    row({ _id: 'never', lastLoginAt: null, createdAt: new Date(NOW.getTime() - 4 * DAY) }),
    row({ _id: 'active', lastLoginAt: new Date(NOW.getTime() - 1 * DAY) }),
    row({ _id: 'stamped', lastLoginAt: new Date(NOW.getTime() - 9 * DAY), dormantNudgeAt: new Date(NOW.getTime() - 6 * DAY) }),
    row({ _id: 'suspended', lastLoginAt: new Date(NOW.getTime() - 9 * DAY), suspendedAt: new Date(NOW.getTime() - 8 * DAY) }),
    row({ _id: 'noemail', lastLoginAt: new Date(NOW.getTime() - 9 * DAY), email: '' }),
  ]);
  const res = await runDormantNudgeJob({ ...f, now: NOW, days: 3 });
  assert.equal(res.sent, 2);
  assert.deepEqual(f.sent.map((s) => s.to), ['ada@x.test', 'ada@x.test']);
  assert.equal(f.stamped.length, 2);
  assert.equal(res.skipped['already-sent'], 1);
  assert.equal(res.skipped.suspended, 1);
  assert.equal(res.skipped['no-email'], 1);
  assert.equal(res.failed.length, 0);
});

test('send failures are counted and never resend without a stamp', async () => {
  const f = fakes([row({ _id: 'boom', lastLoginAt: new Date(NOW.getTime() - 5 * DAY) })]);
  f.send = async () => { throw new Error('smtp down'); };
  const res = await runDormantNudgeJob({ ...f, now: NOW, days: 3 });
  assert.equal(res.sent, 0);
  assert.equal(res.failed.length, 1);
  assert.equal(f.stamped.length, 0);
});

test('dormant template names the member and links sign-in', () => {
  const mail = buildDormantNudge({ memberName: 'Ada', daysAway: 5 });
  assert.match(mail.subject, /Ada/);
  assert.match(mail.html, /5 days/);
  assert.match(mail.html, /https:\/\/marketspase\.com\/partner\/signin/);
  assert.doesNotMatch(mail.html, /href="\//);
});

test('every mail template links absolute app URLs, never router-relative', async () => {
  const mention = new MentionMailer().buildMention({ authorName: 'A', excerpt: 'hi', sourceType: 'post' });
  assert.match(mention.html, /https:\/\/marketspase\.com\/dashboard\/community/);
  assert.doesNotMatch(mention.html, /href="\//);
  const sent = [];
  const digest = new DigestMailer({ send: async (to, subject, html) => { sent.push({ to, subject, html }); } });
  await digest.sendDigest({
    to: 'a@x.test',
    digest: { subject: 'D', groups: [{ label: 'G', count: 1, titles: ['T'], more: 0 }] },
  });
  assert.match(sent[0].html, /https:\/\/marketspase\.com\/dashboard\/notifications\/center/);
  assert.doesNotMatch(sent[0].html, /href="\//);
});
