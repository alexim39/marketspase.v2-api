/**
 * Public entry for the reports slice (upline <-> downline reporting).
 * Reports flow up to the direct upline; requests flow down to own downline.
 */
export { default, buildReportsRouter } from './interface/Reports.routes.js';
