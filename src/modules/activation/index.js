/**
 * Public entry for the activation slice (onboarding close-the-loop).
 * No routes, no models — just cross-slice subscriptions wired once at
 * boot in server.js (never per-router, so tests stay isolated).
 */
export { subscribeActivation, buildActivationHandlers, activationKey, welcomeKey } from './application/Activation.subscribers.js';
