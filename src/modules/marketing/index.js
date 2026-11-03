/**
 * Public entry for the marketing slice (campaign ROI read-model).
 * Campaigns live in the legacy collection — this slice only reads.
 */
export { default, buildMarketingRouter } from './interface/Marketing.routes.js';
export { buildCampaignRoi, flightWindow } from './domain/Marketing.roi.js';
