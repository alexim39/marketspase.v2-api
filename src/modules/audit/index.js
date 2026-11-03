/**
 * Public entry for the audit slice (admin action history).
 * `recordAudit` is the single call-site helper — best-effort, never throws,
 * safe to `void` or `await ... .catch(() => null)` at decision sites.
 */
export { AUDIT_ACTIONS, createAuditEntry } from './domain/AuditLog.js';
export { MongoAuditStore } from './infrastructure/Audit.store.js';
export { ListAuditUseCase } from './application/Audit.usecases.js';
export { default as AuditRouter, buildAuditRouter } from './interface/Audit.routes.js';
export { default } from './interface/Audit.routes.js';

import { MongoAuditStore } from './infrastructure/Audit.store.js';

let shared = null;
/** Fire-and-forget audit append bound to the shared store (never rejects). */
export const recordAudit = (input) => {
  try {
    shared ??= new MongoAuditStore();
    return shared.record(input);
  } catch {
    return Promise.resolve(null);
  }
};
