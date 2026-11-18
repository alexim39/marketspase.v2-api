import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftBroadcastUseCase } from './Broadcast.draft.js';

test('draft returns structured subject, body and SMS from Ora', async () => {
  let seen = null;
  const uc = new DraftBroadcastUseCase({
    client: {
      complete: async (input) => {
        seen = input;
        return JSON.stringify({
          subject: 'A clearer way to start',
          body: 'Hi {{first_name}}, here is a simple way to get started this week.',
          sms: 'Hi {{first_name}}, ready to start? Reply for the details.',
        });
      },
    },
  });
  const out = await uc.execute({
    purpose: 'promotion',
    tone: 'friendly',
    audience: { source: 'platform', accountState: 'member' },
    channels: { email: true, sms: true },
    current: { title: 'Start this week' },
  });
  assert.equal(out.subject, 'A clearer way to start');
  assert.match(out.body, /simple way/);
  assert.match(out.smsBody, /ready to start/);
  assert.match(seen.messages[0].content, /registered members/);
  assert.match(seen.messages[0].content, /email, SMS/);
});

test('draft falls back to the reply text when JSON is missing', async () => {
  const uc = new DraftBroadcastUseCase({
    client: { complete: async () => '  A plain spoken update for members.  ' },
  });
  const out = await uc.execute({ current: { title: 'Update' } });
  assert.equal(out.body, 'A plain spoken update for members.');
  assert.equal(out.subject, 'Update');
});

test('draft requires a configured client', async () => {
  const uc = new DraftBroadcastUseCase({});
  await assert.rejects(uc.execute({}), /not configured/);
});
