/**
 * Public entry for the identity-access slice.
 * Default export is the mounted router (note: named + default both exposed —
 * see support-ticketing fix where a named-only barrel broke `server.js`).
 */
export { default, buildAuthRouter } from './interface/Auth.routes.js';
export { default as AdminRouter, buildAdminRouter } from './interface/Admin.routes.js';
export { requireRole } from './interface/RequireRole.js';
export { SignupUseCase } from './application/Signup.usecase.js';
export { SigninUseCase } from './application/Signin.usecase.js';
export { sessionCookieFlags } from './interface/Auth.controller.js';
