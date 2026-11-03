/**
 * Public entry for the dashboard slice (single aggregation endpoint).
 * Composes slice use cases — owns no queries, no writes, no cache.
 */
export { default, buildDashboardRouter } from './interface/Dashboard.routes.js';
