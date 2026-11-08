import { CampaignModel } from '../../../apps/campaign/models/campaign.model.js';

/** Minimal ownership lookup shared with the crm create path. */
export class MongoCampaignLookup {
  async findOwned(campaignId, partnerId) {
    return CampaignModel.findOne({ _id: campaignId, createdBy: partnerId }).select('_id').lean();
  }
}
