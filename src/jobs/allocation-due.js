import { AllocateCampaignLeadsUseCase } from '../modules/crm/application/Prospect.allocate.js';
import { CampaignModel } from '../apps/campaign/models/campaign.model.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { sendEmail } from '../services/emailService.js';
import { JobRunModel, withJobHealth } from './job-health.js';

/**
 * Campaign allocation sweep (every 30 minutes, server-local).
 * Walks Active campaigns with allocation enabled and tops each one up
 * within its daily/total caps, then notifies owners once per run that
 * received leads. Jobs never throw into the scheduler — per-campaign
 * outcomes carry the errors. `runAllocationDueJob` is exported for
 * tests, the manual top-up endpoint, and the activation kick.
 */

let running = false;

export const buildAllocationDueJob = (deps = {}) => {
  const allocate = deps.allocate ?? new AllocateCampaignLeadsUseCase({});
  const notify = async ({ partnerId, delivered, campaignName, campaignId = null, immediate = false }) => {
    const title = `${delivered} new campaign lead${delivered === 1 ? '' : 's'} allocated`;
    const body = `${campaignName ?? 'Your campaign'} matched ${delivered} new ${delivered === 1 ? 'person' : 'people'} from the shared pool — find them in your personal-list (My Page Leads), ready to work.`;
    try {
      const stored = new MongoStoredNotificationStore();
      await new NotifyUseCase({ stored }).execute({
        recipientId: String(partnerId),
        category: 'marketing',
        priority: 'medium',
        title,
        body,
        icon: 'campaign',
        link: '/dashboard/prospects/personal-list',
        key: `campaign-allocated:${campaignId ?? 'run'}:${Date.now()}`,
      });
    } catch { /* in-app is best-effort */ }
    // Email is a daily digest, not per-run: explicit top-ups mail at once,
    // sweeps only mail when no digest went out in the last 24 hours.
    try {
      let send = immediate;
      if (!immediate && campaignId) {
        const c = await CampaignModel.findById(campaignId).select('allocation.lastDigestAt').lean().catch(() => null);
        const last = c?.allocation?.lastDigestAt ? new Date(c.allocation.lastDigestAt).getTime() : 0;
        send = Date.now() - last > 86400000;
      }
      if (send) {
        const member = await PartnersModel.findById(partnerId).select('email').lean();
        if (member?.email) await sendEmail(member.email, title, `<p>${body}</p>`);
        if (campaignId) {
          await CampaignModel.updateOne({ _id: campaignId }, { $set: { 'allocation.lastDigestAt': new Date() } }).catch(() => null);
        }
      }
    } catch { /* email is best-effort */ }
  };
  return { allocate, notify };
};

/** Allocate for one campaign now (activation kick + manual top-up). */
export async function runAllocationForCampaign(campaignId, deps = {}) {
  const { allocate, notify } = buildAllocationDueJob(deps);
  const runs = deps.runs ?? JobRunModel;
  const result = await withJobHealth(runs, 'campaign-allocation', () =>
    allocate.execute({ campaignId, limit: 10 }),
  );
  if (result.delivered > 0) {
    await notify({ partnerId: result.ownerId, delivered: result.delivered, campaignName: result.campaignName, campaignId, immediate: true });
  }
  return result;
}

export async function runAllocationDueJob(deps = {}) {
  const started = Date.now();
  if (running) return { checked: 0, delivered: 0, skipped: true, failed: [] };
  running = true;
  const failed = [];
  let checked = 0;
  let delivered = 0;
  try {
    const { allocate, notify } = buildAllocationDueJob(deps);
    const campaigns = await CampaignModel.find({
      deliveryStatus: 'Active',
      $and: [
        { $or: [{ 'allocation.enabled': { $ne: false } }, { allocation: { $exists: false } }] },
        { 'allocation.paused': { $ne: true } },
      ],
    }).select('_id campaignName createdBy allocation deliveryStatus').sort({ 'allocation.lastRunAt': 1 }).limit(200).lean();
    for (const c of campaigns ?? []) {
      checked += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await allocate.execute({ campaignId: String(c._id), limit: 10 });
        delivered += result.delivered;
        if (result.delivered > 0) {
          // eslint-disable-next-line no-await-in-loop
          await notify({ partnerId: result.ownerId, delivered: result.delivered, campaignName: result.campaignName, campaignId: String(c._id) });
        }
      } catch (error) {
        failed.push({ campaignId: String(c._id), error: error?.message ?? String(error) });
      }
    }
    if (checked > 0 || failed.length > 0) {
      console.log(`[jobs] allocation-due: ${delivered} leads to ${checked} campaigns in ${Date.now() - started}ms (${failed.length} failed)`);
    }
    return { checked, delivered, failed };
  } catch (error) {
    console.error('[jobs] allocation-due crashed:', error?.message ?? error);
    return { checked, delivered, failed: [{ error: error?.message ?? String(error) }] };
  } finally {
    running = false;
  }
}
