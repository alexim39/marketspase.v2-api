/**
 * Public entry for the crm slice (prospect aggregate).
 * Survey-coupled flows (/import/*, /for/*, /all, /my/*, /move-back-to-survey/*)
 * stay on the legacy router until the `insight` slice owns the Survey model.
 */
export { default, buildProspectRouter } from './interface/Prospect.routes.js';
export {
  CreateProspectUseCase, UpdateProspectUseCase, UpdateProspectStatusUseCase, DeleteProspectUseCase,
} from './application/Prospect.commands.js';
export { buildProspectNotifications } from './domain/Prospect.notifications.js';
