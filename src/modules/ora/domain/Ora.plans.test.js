import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_MAX_ITEMS,
  lagosDateKey,
  normalizePlanItems,
  parsePlanDraft,
  planDraftFromReply,
} from './Ora.plans.js';

test('date keys use the Lagos operating day', () => {
  assert.equal(lagosDateKey(new Date('2026-11-07T22:30:00Z')), '2026-11-07');
  assert.equal(lagosDateKey(new Date('2026-11-07T23:30:00Z')), '2026-11-08');
});

test('plan items are trimmed, capped and deduped', () => {
  const items = normalizePlanItems([
    { title: '  Follow up with Paul  ', detail: '  Overdue by 2 days ' },
    { title: 'follow up with paul' },
    { title: 'Review goal pace', detail: 'x'.repeat(500) },
    { title: 'Third item' },
    { title: 'Fourth item' },
  ]);
  assert.equal(items.length, PLAN_MAX_ITEMS);
  assert.deepEqual(items[0], { title: 'Follow up with Paul', detail: 'Overdue by 2 days' });
  assert.equal(items[1].detail.length, 240);
});

test('links must be known dashboard pages', () => {
  const items = normalizePlanItems([
    { title: 'Open pipeline', link: '/dashboard/prospects/pipeline' },
    { title: 'Bad link', link: 'https://evil.example.com' },
    { title: 'Home', link: '/dashboard' },
  ]);
  assert.equal(items[0].link, '/dashboard/prospects/pipeline');
  assert.equal(items[1].link, undefined);
  assert.equal(items[2].link, '/dashboard');
});

test('a strict empty plan is rejected, a lenient one is empty', () => {
  assert.throws(() => normalizePlanItems([]), /at least one plan item/i);
  assert.deepEqual(normalizePlanItems([], { strict: false }), []);
  assert.deepEqual(normalizePlanItems([{ title: '' }], { strict: false }), []);
});

test('drafts parse from JSON and bullet lines', () => {
  const json = parsePlanDraft(JSON.stringify([
    { title: 'Follow up with Paul', detail: 'Overdue', link: '/dashboard/prospects/pipeline' },
  ]));
  assert.equal(json.length, 1);
  assert.equal(json[0].title, 'Follow up with Paul');

  const lines = parsePlanDraft('- Follow up with Paul\n2) Check goal pace');
  assert.deepEqual(lines.map((item) => item.title), ['Follow up with Paul', 'Check goal pace']);
  assert.deepEqual(parsePlanDraft(''), []);
});

test('a missing draft falls back to the numbered list in the reply', () => {
  const items = planDraftFromReply([
    "Here's a tight plan for today.",
    '',
    '1. **Get placed with a campaign mentor** — your commissions are waiting on placement.',
    '2. **Work your one prospect** — a single follow-up keeps momentum.',
    '3. **Check in on your team** — a quick pulse check helps activation.',
    '',
    'Approve and I will save them.',
  ].join('\n'));
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Get placed with a campaign mentor');
  assert.match(items[0].detail, /commissions are waiting/);
});
