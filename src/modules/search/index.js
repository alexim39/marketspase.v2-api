/**
 * Public entry for the search slice (global cross-entity search).
 * Visibility mirrors each source slice — search never widens access.
 */
export { default, buildSearchRouter } from './interface/Search.routes.js';
