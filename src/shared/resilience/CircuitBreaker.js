import { AppError } from '../domain/AppError.js';

const registry = new Map();

/**
 * Small per-provider circuit breaker.
 *
 * Three consecutive transport/provider failures open the circuit for a
 * cooldown; one probe is allowed half-open. This keeps a dead provider from
 * consuming the request pool with 30-second timeouts. Money providers fail
 * closed (no fake success); AI can use its own cached fallback upstream.
 */
export class CircuitBreaker {
  constructor({
    name,
    failureThreshold = 3,
    cooldownMs = 60_000,
    openCode = 'PROVIDER_UNAVAILABLE',
    openMessage = 'This service is temporarily unavailable',
    openFix = 'Wait a moment and retry once.',
  } = {}) {
    this.name = name ?? 'provider';
    this.failureThreshold = Math.max(1, Number(failureThreshold) || 3);
    this.cooldownMs = Math.max(1000, Number(cooldownMs) || 60_000);
    this.openCode = openCode;
    this.openMessage = openMessage;
    this.openFix = openFix;
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = 0;
    this.lastErrorAt = null;
    this.lastSuccessAt = null;
    registry.set(this.name, this);
  }

  status() {
    const retryAfter = this.state === 'open'
      ? Math.max(1, Math.ceil((this.openedAt + this.cooldownMs - Date.now()) / 1000))
      : 0;
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      retryAfter,
      lastErrorAt: this.lastErrorAt,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  #open() {
    this.state = 'open';
    this.openedAt = Date.now();
  }

  async run(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half-open';
      } else {
        const retryAfter = Math.max(1, Math.ceil((this.openedAt + this.cooldownMs - Date.now()) / 1000));
        const error = new AppError(this.openMessage, 503, this.openCode, { retryAfter }, this.openFix);
        error.retryAfter = retryAfter;
        throw error;
      }
    }

    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      this.lastSuccessAt = new Date().toISOString();
      return result;
    } catch (error) {
      this.failures += 1;
      this.lastErrorAt = new Date().toISOString();
      if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
        this.#open();
      }
      throw error;
    }
  }
}

export const getBreaker = (name, options = {}) =>
  registry.get(name) ?? new CircuitBreaker({ name, ...options });

export const providerHealth = () =>
  [...registry.values()].map((breaker) => breaker.status());

export default CircuitBreaker;
