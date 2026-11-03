/**
 * Public entry for the outreach slice (server-side bulk SMS).
 * Legacy charge-then-browser-gateway flow is superseded: one session-owned
 * call charges, sends and records. Legacy sms/billing routes stay mounted
 * for the log pages and old clients.
 */
export { default, buildOutreachRouter } from './interface/Outreach.routes.js';
export { normalizeNgPhone, smsPages, smsCost, MAX_SMS_RECIPIENTS, SMS_CHARGE_PER_PAGE } from './domain/Outreach.entity.js';
