import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, greetingFor, startersForLevel } from './Ora.persona.js';

test('Ora prompt teaches the four-rank growth plan, not the old ladder', () => {
  const prompt = buildSystemPrompt({
    displayName: 'Ada',
    commissionRank: 'Builder',
    commissionDepth: 2,
    placed: true,
  });
  assert.match(prompt, /Four ranks only/);
  assert.match(prompt, /Partner . Builder . Leader . Ambassador/);
  assert.match(prompt, /Levels 1–2/);
  assert.match(prompt, /gross margin/i);
  assert.match(prompt, /Mentor bonus/i);
  assert.match(prompt, /assigned by the AI Admin/i);
  assert.doesNotMatch(prompt, /G8/);
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
