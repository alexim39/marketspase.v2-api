import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, providerHealth } from './CircuitBreaker.js';

test('opens after the threshold and exposes retryAfter', async () => {
  const breaker = new CircuitBreaker({ name: 'unit-test-breaker', failureThreshold: 2, cooldownMs: 1000 });
  const boom = async () => { throw new Error('down'); };
  await assert.rejects(breaker.run(boom));
  await assert.rejects(breaker.run(boom));
  assert.equal(breaker.status().state, 'open');
  await assert.rejects(breaker.run(async () => 'ok'), (error) => {
    assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
    assert.ok(error.retryAfter >= 1);
    return true;
  });
  assert.ok(providerHealth().some((entry) => entry.name === 'unit-test-breaker'));
});

test('a successful call closes the circuit', async () => {
  const breaker = new CircuitBreaker({ name: 'unit-test-close', failureThreshold: 1, cooldownMs: 10 });
  await assert.rejects(breaker.run(async () => { throw new Error('down'); }));
  assert.equal(breaker.status().state, 'open');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(await breaker.run(async () => 'ok'), 'ok');
  assert.equal(breaker.status().state, 'closed');
});
