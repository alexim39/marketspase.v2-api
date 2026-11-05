// Strangler note: reuse the legacy compiled models so both stacks share
// ONE collection + ONE schema (same rationale as Auth.models.js).
// Prospect schema text moves into this folder at final cutover.
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

export { ProspectModel, PartnersModel };
