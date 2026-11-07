import test from 'node:test';
import assert from 'node:assert/strict';
import { runOutboxDueJob } from './outbox-delivery.js';

test('delivers due jobs and retries failures', async () => {
  const jobs = [
    { _id: '1', channel: 'email', payload: { to: 'a@x.test' } },
    { _id: '2', channel: 'sms', payload: { to: '080' } },
  ];
  const completed = [];
  const retried = [];
  const outbox = {
    claimDue: async () => jobs.splice(0, jobs.length),
    complete: async (id) => completed.push(id),
    retry: async (id, error) => retried.push({ id, error: error.message }),
  };
  const senders = {
    email: async () => ({ sent: true }),
    sms: async () => { throw new Error('sms down'); },
  };
  const result = await runOutboxDueJob({ outbox, senders });
  assert.equal(result.checked, 2);
  assert.equal(result.delivered, 1);
  assert.deepEqual(completed, ['1']);
  assert.equal(retried[0].id, '2');
  assert.match(retried[0].error, /sms down/);
});
