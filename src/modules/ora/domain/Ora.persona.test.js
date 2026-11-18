import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, greetingFor, startersForLevel } from './Ora.persona.js';

test('Ora prompt teaches the MarketSpase plan and activation facts', () => {
  const prompt = buildSystemPrompt({
    displayName: 'Ada',
    commissionRank: 'Builder',
    commissionDepth: 2,
    placed: true,
  });
  assert.match(prompt, /MarketSpase/);
  assert.match(prompt, /AI-based, product-backed online business/);
  assert.match(prompt, /Signature Clothing Set/);
  assert.match(prompt, /₦38,000/);
  assert.match(prompt, /free account/i);
  assert.match(prompt, /KYC/);
  assert.match(prompt, /Four ranks only/);
  assert.match(prompt, /Partner . Builder . Leader . Ambassador/);
  assert.match(prompt, /Levels 1–2/);
  assert.match(prompt, /gross margin/i);
  assert.match(prompt, /Mentor bonus/i);
  assert.match(prompt, /checked automatically against the requirements/i);
  assert.match(prompt, /under 60 words/i);
  assert.match(prompt, /support\.handoff/);
  assert.doesNotMatch(prompt, /Diamond Project/);
  assert.doesNotMatch(prompt, /G8/);
});

test('Ora treats an unactivated account as a member, not a partner', () => {
  const prompt = buildSystemPrompt({
    displayName: 'Bola',
    accountState: 'member',
    kycStatus: 'not_started',
  });
  assert.match(prompt, /Account: Member/);
  assert.match(prompt, /not activated yet/);
  assert.doesNotMatch(prompt, /Commission rank:/);

  const greeting = greetingFor({ displayName: 'Bola', accountState: 'member' });
  assert.match(greeting, /member right now/);
  assert.doesNotMatch(greeting, /You're a Partner/);

  const starters = startersForLevel('Partner', { accountState: 'member' });
  assert.ok(starters.includes('What is MarketSpase?'));
  assert.ok(starters.includes('What does activation include?'));
});

test('Ora starters split growth and leadership ranks', () => {
  const partner = startersForLevel('partner');
  const leader = startersForLevel('Leader');
  assert.equal(partner.length, 6);
  assert.equal(leader.length, 6);
  assert.ok(partner.includes('How do I recruit more partners?'));
  assert.ok(leader.includes('Who in my team requires attention?'));
});

test('Ora greeting names the commission rank and earning depth', () => {
  const greeting = greetingFor({ displayName: 'Ada', commissionRank: 'Ambassador', commissionDepth: 5 });
  assert.match(greeting, /Ambassador/);
  assert.match(greeting, /Level 5/);
  assert.doesNotMatch(greeting, /G8/);
});
