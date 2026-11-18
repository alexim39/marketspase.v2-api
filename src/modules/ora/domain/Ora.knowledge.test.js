import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKETSPASE_ONE_LINER,
  formatHandoffGuide,
  formatObjectionGuide,
  formatPlatformKnowledge,
  formatResponseRules,
} from './Ora.knowledge.js';

test('the canonical MarketSpase one-liner is the approved wording', () => {
  assert.equal(
    MARKETSPASE_ONE_LINER,
    'MarketSpase is an AI-based, product-backed online business. The platform brings the interest, I plan the work and prepare the busywork, and you approve the next move. You can start free and decide on activation later.',
  );
});

test('platform knowledge carries the offer, activation, member journey and costs', () => {
  const facts = formatPlatformKnowledge();
  assert.match(facts, /AI-based, product-backed online business/);
  assert.match(facts, /Signature Clothing Set/);
  assert.match(facts, /₦38,000/);
  assert.match(facts, /identity check \(KYC\)/i);
  assert.match(facts, /new account is a member/i);
  assert.match(facts, /fair allocation/i);
  assert.match(facts, /three priorities and one momentum item/i);
  assert.match(facts, /Initial Planning Orientation/);
  assert.match(facts, /mentor bonus/i);
  assert.match(facts, /store service fee/i);
  assert.match(facts, /never promise/i);
  assert.doesNotMatch(facts, /Diamond Project/);
});

test('objection guide covers the high-frequency new-member questions', () => {
  const guide = formatObjectionGuide();
  for (const phrase of [
    'pyramid', 'pitch my friends', 'lost money', 'worried about the money',
    'don\'t have time', 'not a salesperson', 'proof', 'think about it',
    'Do I have to recruit', 'every day',
  ]) {
    assert.match(guide, new RegExp(phrase, 'i'));
  }
});

test('response rules enforce brevity and human language', () => {
  const rules = formatResponseRules();
  assert.match(rules, /under 60 words/i);
  assert.match(rules, /under 100 words/i);
  assert.match(rules, /one question or one next step/i);
  assert.match(rules, /never claim to be human/i);
  assert.match(rules, /former, legacy or alternative platform name/i);
  assert.match(rules, /displayed price or money that left the wallet/i);
});

test('handoff guide is consent-aware and approval-first', () => {
  const guide = formatHandoffGuide();
  assert.match(guide, /prefer not to be contacted yet/i);
  assert.match(guide, /support ticket/i);
  assert.match(guide, /never share contact details/i);
  assert.match(guide, /before the member approves/i);
});
