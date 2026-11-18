/**
 * Fire-and-forget campaign runner. The HTTP request debits the wallet and
 * returns immediately; this keeps provider latency out of the request path.
 */
export const SmsCampaignProcessor = {
  schedule(campaignId) {
    if (!campaignId) return;
    setImmediate(async () => {
      try {
        const { smsService } = await import('./Sms.service.js');
        await smsService.processCampaign(String(campaignId));
      } catch {
        // The campaign row keeps its status; the retry endpoint can recover it.
      }
    });
  },
};

export const runSmsCampaignDueJob = async (deps = {}) => {
  const service = deps.service ?? (await import('./Sms.service.js')).smsService;
  return service.processDueScheduled(deps.limit ?? 10);
};

export default runSmsCampaignDueJob;
