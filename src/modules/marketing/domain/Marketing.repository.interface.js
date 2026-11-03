/**
 * Contracts for the marketing slice. Campaigns live in the legacy
 * collection (strangler read-model, same pattern as the network slice);
 * only reads happen here — creation stays on the legacy routes.
 */
export class CampaignStats {
  async listCampaigns(partnerId) { throw new Error('Not implemented'); }
  async countLinkWindow(partnerId, start, end) { throw new Error('Not implemented'); }
  async countExactWindow(partnerId, campaignId, start, end) { throw new Error('Not implemented'); }
  async findOwned(campaignId, partnerId) { throw new Error('Not implemented'); }
}
