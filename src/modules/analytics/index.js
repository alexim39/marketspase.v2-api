/**
 * Public entry for the analytics slice (funnel, team health, action center).
 * Read-only derivations over source aggregates — no writes, no caching.
 */
export { default, buildAnalyticsRouter } from './interface/Analytics.routes.js';
export { buildFunnel, scoreHealth } from './domain/Analytics.engine.js';
