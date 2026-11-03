import { CampaignModel } from '../apps/campaign/models/campaign.model.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { sendEmail } from '../services/emailService.js';
import { recordAudit } from '../modules/audit/index.js';

/**
 * Campaign flight expiry (daily, server-local): fixed-flight campaigns
 * whose end date has passed move Active → Ended automatically — spend
 * (and per-lead allocation debits) must never continue past the flight
 * the partner paid for. Continuous campaigns (noEndDate) are untouched.
 * Transitions are atomic per row (only still-Active rows move), every end
 * notifies the partner and writes an audit row, and the job never throws
 * into the scheduler.
 */
export const buildCampaignExpiryDueJob = (deps = {}) => {
  const campaigns = deps.campaigns ?? CampaignModel;
  const notify = deps.notify ?? (async ({ partnerId, campaignName }) => {
    const title = 'Your ad campaign has ended';
    const body = `"${campaignName ?? 'Your campaign'}" reached the end of its flight and is now closed. See what it earned under Marketing → What campaigns earned.`;
    try {
      const stored = new MongoStoredNotificationStore();
      await new NotifyUseCase({ stored }).execute({
        recipientId: String(partnerId),
        category: 'marketing',
        priority: 'medium',
        title,
        body,
        icon: 'campaign',
        link: '/dashboard/tools/campaigns/manage',
        key: `campaign-ended:${Date.now()}`,
      });
    } catch { /* in-app is best-effort */ }
    try {
      const member = await PartnersModel.findById(partnerId).select('email').lean();
      if (member?.email) await sendEmail(member.email, title, `<p>${body}</p>`);
    } catch { /* email is best-effort */ }
  });
  const audit = deps.audit ?? (async (entry) => {
    void recordAudit(entry);
  });
  return { campaigns, notify, audit };
};

export async function runCampaignExpiryDueJob(deps = {}, now = new Date()) {
  const started = Date.now();
  try {
    const { campaigns, notify, audit } = buildCampaignExpiryDueJob(deps);
    const rows = await campaigns.find({
      deliveryStatus: 'Active',
      'adDuration.noEndDate': false,
      'adDuration.campaignEndDate': { $lt: now },
    }).select('_id campaignName createdBy').sort({ 'adDuration.campaignEndDate': 1 }).limit(200).lean().catch(() => []);
    let ended = 0;
    const failed = [];
    for (const c of rows ?? []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const moved = await campaigns.findOneAndUpdate(
          { _id: c._id, deliveryStatus: 'Active' },
          { $set: { deliveryStatus: 'Ended' } },
        ).lean().catch(() => null);
        if (!moved) continue;
        ended += 1;
        // eslint-disable-next-line no-await-in-loop
        await notify({ partnerId: String(c.createdBy), campaignName: c.campaignName }).catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        await audit({
          actorId: 'system', action: 'campaign.decide',
          targetType: 'campaign', targetId: String(c._id),
          detail: { from: 'Active', to: 'Ended', reason: 'flight-ended' },
        }).catch(() => null);
      } catch (error) {
        failed.push({ campaignId: String(c._id), error: error?.message ?? String(error) });
      }
    }
    if (ended > 0 || failed.length > 0) {
      console.log(`[jobs] campaign-expiry-due: ended ${ended} of ${(rows ?? []).length} in ${Date.now() - started}ms (${failed.length} failed)`);
    }
    return { checked: (rows ?? []).length, ended, failed };
  } catch (error) {
    console.error('[jobs] campaign-expiry-due crashed:', error?.message ?? error);
    return { checked: 0, ended: 0, failed: [{ error: error?.message ?? String(error) }] };
  }
}
