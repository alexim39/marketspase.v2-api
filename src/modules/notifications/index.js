/**
 * Public entry for the notifications slice (unified derived feed + read-state).
 * No event bus: follow-ups/inactivity/conversions/releases are derived from
 * source aggregates on read; only read-state is stored (90d TTL).
 */
export { default, buildNotificationsRouter } from './interface/Notifications.routes.js';
