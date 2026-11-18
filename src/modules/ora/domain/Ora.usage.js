/**
 * Ora usage windows are 24 hours from the first counted message. This port is
 * deliberately storage-agnostic so tests can use the in-memory implementation
 * while production uses MongoDB.
 */
export const ORA_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ORA_USAGE_WINDOW_HOURS = 24;

const isoDay = (date) => date.toISOString().slice(0, 10);

const shape = (row, now) => {
  const start = row?.windowStart ? new Date(row.windowStart) : null;
  const used = Math.max(0, Number(row?.count) || 0);
  return {
    used,
    windowStart: start,
    windowHours: ORA_USAGE_WINDOW_HOURS,
    dateKey: isoDay(start ?? now),
    resetsAt: new Date((start ?? now).getTime() + ORA_USAGE_WINDOW_MS).toISOString(),
  };
};

/**
 * Test/dev implementation. A page reload or a new AskOraUseCase instance does
 * not reset the count as long as it shares this store.
 */
export class InMemoryOraUsageStore {
  constructor() {
    this.windows = new Map();
  }

  active(partnerId, now) {
    const row = this.windows.get(String(partnerId));
    if (!row) return null;
    if (now.getTime() - row.windowStart.getTime() >= ORA_USAGE_WINDOW_MS) {
      this.windows.delete(String(partnerId));
      return null;
    }
    return row;
  }

  async usage(partnerId, now = new Date()) {
    return shape(this.active(partnerId, now), now);
  }

  async consume(partnerId, limit, now = new Date()) {
    const max = Number(limit) || 0;
    if (max <= 0) return { allowed: false, ...shape(null, now) };
    const key = String(partnerId);
    const row = this.active(key, now);
    if (!row) {
      const created = { windowStart: new Date(now), count: 1 };
      this.windows.set(key, created);
      return { allowed: true, ...shape(created, now) };
    }
    if (row.count >= max) return { allowed: false, ...shape(row, now) };
    row.count += 1;
    return { allowed: true, ...shape(row, now) };
  }

  async release(partnerId, windowStart) {
    const key = String(partnerId);
    const row = this.windows.get(key);
    if (!row || !windowStart) return;
    if (row.windowStart.getTime() !== new Date(windowStart).getTime()) return;
    row.count = Math.max(0, row.count - 1);
    if (row.count === 0) this.windows.delete(key);
  }
}
