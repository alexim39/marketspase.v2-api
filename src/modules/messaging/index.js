/**
 * Public entry for the messaging slice (Communication Center).
 * Directs are relationship-scoped; announcements fan out per recipient
 * so read-state stays a single-query lookup.
 */
export { default, buildMessagingRouter } from './interface/Messaging.routes.js';
