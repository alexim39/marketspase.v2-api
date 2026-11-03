/**
 * In-process domain event bus (N-series notification architecture).
 * Business modules emit facts (`events.emit(...)`); the notification
 * slice subscribes — no cross-module imports, no hardcoded fan-out
 * inside producers. Handlers run per-emit with isolated failures:
 * one bad subscriber never breaks the emitter or its siblings.
 * Transport-compatible: swapping this for Redis/RabbitMQ later only
 * changes this file (same `on`/`emit` contract).
 */
export class DomainEvents {
  constructor() {
    this.handlers = new Map();
  }

  /** @returns unsubscribe function */
  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  /** @returns per-handler outcomes ({ok} or {error}) */
  async emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return [];
    const outcomes = [];
    for (const handler of set) {
      try {
        outcomes.push({ ok: await handler(payload) });
      } catch (error) {
        console.error(`[events] ${event} handler failed:`, error?.message ?? error);
        outcomes.push({ error: error?.message ?? String(error) });
      }
    }
    return outcomes;
  }
}

/** Shared singleton — explicit `events` deps default to this. */
export const domainEvents = new DomainEvents();
