/**
 * Public entry for the bonuses slice (configurable wallet-bonus campaigns).
 * Members claim once per campaign; wallet credit reuses the billing core.
 */
export { buildBonusRouter, buildAdminBonusRouter } from './interface/Bonus.routes.js';
export { ensureSeedBonus } from './infrastructure/Bonus.mongo.js';
