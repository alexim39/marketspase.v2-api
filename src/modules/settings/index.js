/**
 * Public entry for the settings slice (member profile management).
 * Strangler start: profile-photo upload only (Cloudinary, session-owned).
 * Legacy profile/profile-image endpoints keep working untouched.
 */
export { default, buildSettingsRouter } from './interface/Settings.routes.js';
