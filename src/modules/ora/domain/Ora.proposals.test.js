import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROPOSALS, extractProposalBlock } from './Ora.proposals.js';

test('extracts a valid opportunity proposal and strips the block from the reply', () => {
  const raw = 'You have 2 overdue follow-ups. Should I send Paul a reminder?\n\n```actions\n[{"opportunityId":"opp:followup:p1","label":"Send reminder SMS","summary":"Short check-in to Paul"}]\n```';
  const { text, proposals } = extractProposalBlock(raw);
  assert.match(text, /Should I send Paul/);
  assert.equal(text.includes('```'), false);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].opportunityId, 'opp:followup:p1');
  assert.equal(proposals[0].label, 'Send reminder SMS');
});

test('supports capability proposals for opening an area', () => {
  const { proposals } = extractProposalBlock('Open the reminders page.\n```actions\n[{"capability":"pipeline.reminders","label":"Open reminders"}]\n```');
  assert.deepEqual(proposals, [{
    capability: 'pipeline.reminders',
    label: 'Open reminders',
    summary: '',
    draft: '',
  }]);
});

test('ignores malformed or oversized blocks', () => {
  assert.deepEqual(extractProposalBlock('No action').proposals, []);
  assert.deepEqual(extractProposalBlock('x\n```actions\nnot json\n```').proposals, []);
  const many = Array.from({ length: 6 }, (_, i) => ({ capability: `x.${i}` }));
  const raw = `x\n\`\`\`actions\n${JSON.stringify(many)}\n\`\`\``;
  assert.equal(extractProposalBlock(raw).proposals.length, MAX_PROPOSALS);
});
