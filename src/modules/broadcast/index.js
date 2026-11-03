/**
 * Public entry for the broadcast slice (platform-wide admin notices).
 * In-app only — email-at-scale stays out until a queued mailer exists.
 */
export { default as BroadcastRouter, buildBroadcastRouter } from './interface/Broadcast.routes.js';
export { default } from './interface/Broadcast.routes.js';
export { SendBroadcastUseCase, ListBroadcastsUseCase } from './application/Broadcast.usecases.js';
export { BROADCAST_CAP, createBroadcastInput } from './domain/Broadcast.js';
