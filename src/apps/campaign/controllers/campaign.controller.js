import {CampaignModel} from './../models/campaign.model.js';
import { PartnersModel } from './../../partner/models/partner.model.js';
import { runInTransaction } from '../../../modules/identity-access/infrastructure/Auth.models.js';
import mongoose from 'mongoose';
import {TransactionModel} from '../../transaction/models/transaction.model.js';
import { NotifyUseCase } from '../../../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { recordAudit } from '../../../modules/audit/index.js';
import { sendEmail } from '../../../services/emailService.js';
import { buildProspectAccess } from '../../../modules/crm/application/Prospect.access.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';
import { allocationTier } from '../../../shared/geo/campaignZones.js';
import { ProspectModel } from '../../../modules/crm/infrastructure/Prospect.models.js';
import {
  AllocateCampaignLeadsUseCase, AllocationSummaryUseCase, ReportAllocationUseCase,
  VerdictAllocationUseCase, DEFAULT_PER_LEAD_PRICE,
} from '../../../modules/crm/application/Prospect.allocate.js';
import { CampaignAllocationModel } from '../models/allocation.model.js';
import { runAllocationForCampaign } from '../../../jobs/allocation-due.js';

// Session + ownership guard (campaigns hold wallet money — createdBy must be
// the session; reads are owner/upline/admin). Visits stay public (the
// :4201 site records them for anonymous visitors).
const guard = buildProspectAccess({
  findProspectById: async () => null,
  findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf placementParentId').lean().catch(() => null),
});
const sessionId = (req) => (req.auth?.partnerId ? String(req.auth.partnerId) : null);
const deny = (res, err) => res.status(err?.statusCode ?? 403).json({ message: err?.message ?? 'Forbidden', success: false });

const ADMIN_STATUSES = ['Pending', 'Active', 'Rejected', 'Ended', 'Cancelled'];
const ALLOWED_TRANSITIONS = {
  Pending: ['Active', 'Rejected', 'Cancelled'],
  Active: ['Ended'],
  Rejected: [],
  Ended: [],
  Cancelled: [],
};

/** Return the full held budget to the owner (reject + owner-cancel share it). */
async function refundHeldBudget(campaign, paymentMethod) {
  const owner = await PartnersModel.findById(campaign.createdBy);
  if (!owner) return 0;
  const amount = Number(campaign.budget?.budgetAmount ?? 0);
  if (!(amount > 0)) return 0;
  owner.balance = Number(owner.balance ?? 0) + amount;
  await owner.save();
  await TransactionModel.create({
    partnerId: owner._id,
    amount,
    status: 'Completed',
    paymentMethod,
    transactionType: 'Credit',
    reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
  });
  return amount;
}

/** Best-effort partner notice (in-app row + email) — never fails the transition. */
const notifyOwner = async (ownerId, { title, body, campaignId, status }) => {
  try {
    const stored = new MongoStoredNotificationStore();
    const notify = new NotifyUseCase({ stored });
    await notify.execute({
      recipientId: String(ownerId),
      category: 'marketing',
      priority: status === 'Rejected' ? 'high' : 'medium',
      title,
      body,
      icon: 'campaign',
      link: '/dashboard/campaigns',
      key: `campaign:${campaignId}:${status}`,
    }).catch(() => null);
    const owner = await PartnersModel.findById(ownerId).select('email name surname username').lean().catch(() => null);
    if (owner?.email) {
      await sendEmail(owner.email, title, `<p>${body}</p>`).catch(() => null);
    }
  } catch { /* notifications never fail admin actions */ }
};

/** Per-channel minimum holds — mirrors the legacy per-channel endpoints. */
const CHANNEL_MINIMUM = {
  facebook: 6500,
  youtube: 18000,
  linkedin: 10500,
};

const CHANNEL_LABEL = {
  facebook: 'Facebook',
  youtube: 'Youtube',
  linkedin: 'LinkedIn',
};

const httpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/**
 * Legacy campaign purchases: atomic debit + transaction row + campaign in one
 * transaction. Replaces the old read-modify-save sequence, which could debit a
 * partner and then fail the campaign save with no row to reconcile against.
 */
const purchaseCampaign = async ({ body, amount, label, campaign }) => runInTransaction(async (session) => {
  const lookup = PartnersModel.findById(body.createdBy);
  if (session) lookup.session(session);
  const partner = await lookup;
  if (!partner) throw httpError(400, 'Partner not found');
  if (!(Number(partner.balance ?? 0) >= amount)) {
    throw httpError(401, 'Insufficient balance for transaction');
  }

  const debit = await PartnersModel.updateOne(
    { _id: partner._id, balance: { $gte: amount } },
    { $inc: { balance: -Number(amount) } },
    { session },
  );
  if (!debit.modifiedCount) throw httpError(401, 'Insufficient balance for transaction');

  const [transaction] = await TransactionModel.create([{
    partnerId: partner._id,
    amount: Number(amount),
    status: 'Completed',
    paymentMethod: `${label} Ads`,
    transactionType: 'Debit',
    reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
  }], { session });

  const [created] = await CampaignModel.create([campaign], { session });
  return { campaign: created, transaction };
});

// Campaign creation is served by the v1 `/v1/campaigns` route. The legacy
// create endpoints (unified plus per-channel) were retired after the web
// client moved to v1; only read/management routes remain below.



// Route handler to fetch all Ads by createdBy — owner, upline or admin.
export const getCampaignsCreatedBy = async (req, res) => {
    try {
      const { createdBy } = req.params; // Assuming createdBy is passed as a query parameter

      try {
        await guard.requireListAccess(sessionId(req), createdBy);
      } catch (err) {
        return deny(res, err);
      }
  
      // Find Ads where createdBy matches the provided ID
      const ads = await CampaignModel.find({ createdBy });
  
      res.status(200).json({
        message: 'Ads retrieved successfully!',
        data: ads,
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Error retrieving Ads',
        error: error.message,
        success: false,
      });
    }
};




export const recordVisits = async (req, res) => {
  try {
    const { username, channel } = req.body;

    // Input validation
    if (!username) {
      return res.status(400).json({ message: 'Username is required', success: false });
    }

    // Step 1: Find the partner's ObjectId by username
    const partner = await PartnersModel.findOne({ username });
    if (!partner) {
      return res.status(404).json({ message: 'Partner not found', success: false });
    }

    // Step 2: Handle the channel
    if (!channel || channel === 'unknown' || !mongoose.Types.ObjectId.isValid(channel)) {
      // If channel is not provided or not a valid ObjectId, increment visits in the PartnersModel
      const updatedPartner = await PartnersModel.findOneAndUpdate(
        { _id: partner._id },
        { $inc: { visits: 1 } },
        { new: true }
      );

      if (updatedPartner) {
        return res.status(200).json({
          message: 'Partner visit recorded successfully',
          success: true,
          data: { visits: updatedPartner.visits ?? null },
        });
      } else {
        // This should ideally not happen if the partner was found, but handle defensively
        return res.status(500).json({
          message: 'Error updating partner visits',
          success: false,
        });
      }
    } else {
      // Step 3: Check if the channel exists in the CampaignModel and belongs to the partner
      const updatedCampaign = await CampaignModel.findOneAndUpdate(
        { _id: channel, createdBy: partner._id },
        { $inc: { visits: 1 } },
        { new: true }
      );

      if (updatedCampaign) {
        return res.status(200).json({
          message: 'Campaign visit recorded successfully',
          success: true,
          campaign: updatedCampaign,
        });
      } else {
        // If campaign does not exist, increment visits in the PartnersModel
        const updatedPartner = await PartnersModel.findOneAndUpdate(
          { _id: partner._id },
          { $inc: { visits: 1 } },
          { new: true }
        );
        return res.status(200).json({
          message: 'Partner visit recorded successfully',
          success: true,
          data: { visits: updatedPartner.visits ?? null },
        });
      }
    }
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      message: 'Failed to record visit',
      success: false,
    });
  }
}

// Admin queue: every campaign by status, oldest first (default Pending).
// Paginated — the queue must stay fast no matter how many partners submit.
export const listCampaignsForAdmin = async (req, res) => {
  try {
    const status = req.query.status ?? 'Pending';
    if (!ADMIN_STATUSES.includes(status) && status !== 'All') {
      return res.status(400).json({ message: 'Invalid status filter', success: false });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const filter = status === 'All' ? {} : { deliveryStatus: status };
    const [rows, total] = await Promise.all([
      CampaignModel.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      CampaignModel.countDocuments(filter),
    ]);
    // Allocation counts ride along so the desk sees fulfillment, not just spend.
    const allocatedByCampaign = await CampaignAllocationModel.aggregate([
      { $match: { campaignId: { $in: rows.map((r) => r._id) } } },
      { $group: { _id: '$campaignId', allocated: { $sum: 1 } } },
    ]).catch(() => []);
    const allocated = Object.fromEntries(
      (allocatedByCampaign ?? []).map((a) => [String(a._id), a.allocated])
    );
    const ownerIds = [...new Set(rows.map((r) => String(r.createdBy)).filter(Boolean))];
    const owners = ownerIds.length > 0
      ? await PartnersModel.find({ _id: { $in: ownerIds } }).select('username name surname email phone').lean().catch(() => [])
      : [];
    const labels = Object.fromEntries((owners ?? []).map((o) => [String(o._id), {
      username: o.username,
      name: [o.name, o.surname].filter(Boolean).join(' ') || o.username,
      email: o.email ?? null,
      phone: o.phone ?? null,
    }]));
    res.status(200).json({
      message: 'Campaigns retrieved successfully!',
      data: rows.map((r) => ({ ...r, allocated: allocated[String(r._id)] ?? 0, owner: labels[String(r.createdBy)] ?? null })),
      meta: { total, limit, skip },
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving campaigns', error: error.message, success: false });
  }
};

// Admin transition: Pending→Active/Rejected, Active→Ended. Reject refunds
// the held budget (credit mirroring the debit) so money never strands.
export const updateCampaignStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body ?? {};
    if (!ADMIN_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status', success: false });
    }
    const campaign = await CampaignModel.findById(id);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found', success: false });
    }
    const from = campaign.deliveryStatus ?? 'Pending';
    if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(status)) {
      return res.status(409).json({
        message: `Cannot move campaign from ${from} to ${status}`,
        success: false,
      });
    }
    campaign.deliveryStatus = status;
    await campaign.save();

    if (status === 'Rejected') {
      // Refund the held budget in full.
      await refundHeldBudget(campaign, 'Campaign Refund');
    }

    if (status === 'Ended') {
      // Spend close-out: the held budget ran off-platform, so the admin
      // attests what it bought. Permanent, partner-visible accountability.
      const rawSpend = req.body?.spentAmount;
      if (rawSpend === undefined || rawSpend === null || String(rawSpend).trim() === '') {
        return res.status(400).json({ message: 'Enter the amount spent before ending the campaign.', success: false });
      }
      const spent = Number(rawSpend);
      if (!Number.isFinite(spent) || spent < 0) {
        return res.status(400).json({ message: 'Enter a valid spend amount (0 or more).', success: false });
      }
      campaign.closeout = {
        spentAmount: Math.round(spent * 100) / 100,
        spendNote: String(req.body?.spendNote ?? '').trim().slice(0, 500),
        closedAt: new Date(),
        closedBy: sessionId(req),
      };
    }

    const title = status === 'Active'
      ? 'Your ad campaign is live'
      : status === 'Rejected'
        ? 'Your ad campaign was not approved'
        : 'Your ad campaign has ended';
    const body = status === 'Rejected' && reason
      ? `"${campaign.campaignName}": ${String(reason).slice(0, 500)} Your held budget was refunded in full.`
      : status === 'Rejected'
        ? `"${campaign.campaignName}" was not approved. Your held budget was refunded in full.`
        : status === 'Active'
          ? `"${campaign.campaignName}" is now running. Leads will land in your general contact list.`
          : `"${campaign.campaignName}" has ended. See what it earned under Marketing → What campaigns earned.`;
    await notifyOwner(campaign.createdBy, { title, body, campaignId: String(campaign._id), status });

    // Going live unlocks the matcher — first allocation kick runs now
    // (best-effort; the 30-minute sweep keeps topping up afterwards).
    if (status === 'Active') {
      void runAllocationForCampaign(String(campaign._id)).catch((error) => {
        console.error('[campaign] activation allocation failed:', error?.message ?? error);
      });
    }

    res.status(200).json({ message: `Campaign ${status.toLowerCase()} successfully!`, data: campaign, success: true });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'campaign.decide',
      targetType: 'campaign', targetId: String(campaign._id),
      detail: { from, to: status, name: campaign.campaignName ?? null },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating campaign', error: error.message, success: false });
  }
};

// Get a single campaign  
export const getCampaign = async (req, res) => {  
  try {  
    const { id } = req.params; // Assuming id is passed as a route parameter 

    // Find the campaign where id matches the provided ID  
    const campaign = await CampaignModel.findById(id);  

    if (!campaign) {  
      return res.status(400).json({  
        message: 'Campaign not found',  
        success: false,
      });  
    }

    // Campaigns hold wallet money — owner, upline or admin only.
    try {
      await guard.requireListAccess(sessionId(req), campaign.createdBy);
    } catch (err) {
      return deny(res, err);
    }
  
    res.status(200).json({  
      message: 'Campaign retrieved successfully!',  
      data: campaign,  
      success: true,
    });  
  } catch (error) {  
    res.status(500).json({  
      message: 'Error retrieving the campaign',  
      error: error.message,  
      success: false,
    });  
  }
};

// Ledger rows for one campaign (owner/upline/admin) with accepted-contact names.
export const campaignAllocations = async (req, res) => {
  try {
    const campaign = await CampaignModel.findById(req.params.id).select('_id createdBy').lean();
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found', success: false });
    }
    if (!(await guardCampaignAccess(req, res, campaign))) return;
    const rows = await CampaignAllocationModel.find({ campaignId: campaign._id })
      .sort({ createdAt: -1 }).limit(500).lean().catch(() => []);
    const poolIds = [...new Set((rows ?? []).map((r) => String(r.poolSurveyId)))];
    const accepted = poolIds.length > 0
      ? await ProspectModelSurveyLookup(poolIds)
      : [];
    const acceptedByPool = Object.fromEntries(accepted.map((a) => [String(a.poolSurveyId), a]));
    res.status(200).json({
      message: 'Campaign allocations retrieved successfully',
      data: (rows ?? []).map((r) => ({ ...r, accepted: acceptedByPool[String(r.poolSurveyId)] ?? null })),
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load campaign allocations', error: error.message, success: false });
  }
};

async function ProspectModelSurveyLookup(poolIds) {
  const { ProspectModel } = await import('../../../modules/crm/infrastructure/Prospect.models.js');
  const prospects = await ProspectModel.find({ surverId: { $in: poolIds } })
    .select('prospectName prospectSurname surverId status').lean().catch(() => []);
  return (prospects ?? []).map((p) => ({
    poolSurveyId: String(p.surverId),
    name: [p.prospectName, p.prospectSurname].filter(Boolean).join(' ') || 'Contact',
    stage: p?.status?.stage ?? p?.status ?? null,
  }));
}

// Owner/upline view guard for allocation reads (matches getCampaign).
const guardCampaignAccess = async (req, res, campaign) => {
  try {
    await guard.requireListAccess(sessionId(req), campaign.createdBy);
    return true;
  } catch (err) {
    deny(res, err);
    return false;
  }
};

const isAdminSession = async (req) => {
  const me = await PartnersModel.findById(sessionId(req)).select('role').lean().catch(() => null);
  return String(me?.role ?? '').toLowerCase() === 'admin';
};

// Manual top-up: run the matcher for one campaign now (owner/upline/admin).
export const allocateCampaignNow = async (req, res) => {
  try {
    const campaign = await CampaignModel.findById(req.params.id).lean();
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found', success: false });
    }
    if (!(await guardCampaignAccess(req, res, campaign))) return;
    // Money moves here (owner wallet debit per delivered lead) — uplines
    // may view but never spend: owner or admin only.
    const allocatorIsAdmin = await isAdminSession(req);
    const allocatorIsOwner = String(campaign.createdBy) === String(sessionId(req));
    if (!allocatorIsOwner && !allocatorIsAdmin) {
      return res.status(403).json({ message: 'Only the campaign owner or an admin can trigger allocation', success: false });
    }
    const result = await new AllocateCampaignLeadsUseCase({}).execute({
      campaignId: String(campaign._id),
      limit: Math.min(Math.max(Number(req.body?.limit) || 10, 1), 25),
    });
    if (result.delivered > 0) {
      await notifyOwner(campaign.createdBy, {
        title: `${result.delivered} campaign lead${result.delivered === 1 ? '' : 's'} allocated`,
        body: `${result.campaignName ?? 'Your campaign'} matched ${result.delivered} new ${result.delivered === 1 ? 'person' : 'people'} from the shared pool — find them in your personal-list (My Page Leads), ready to work.`,
        campaignId: String(campaign._id),
        status: 'Active',
      });
    }
    void recordAudit({
      actorId: sessionId(req), action: 'campaign.allocate',
      targetType: 'campaign', targetId: String(campaign._id),
      detail: { delivered: result.delivered, skipped: result.skipped },
    });
    res.status(200).json({ message: `Allocated ${result.delivered} lead${result.delivered === 1 ? '' : 's'}`, data: result, success: true });
  } catch (error) {
    res.status(500).json({ message: 'Allocation failed', error: error.message, success: false });
  }
};

// Per-campaign allocation funnel (owner/upline/admin).
export const allocationSummary = async (req, res) => {
  try {
    const admin = await isAdminSession(req);
    const data = await new AllocationSummaryUseCase({}).execute({
      campaignId: req.params.id,
      partnerId: sessionId(req),
      isAdmin: admin,
    });
    res.status(200).json({ message: 'Allocation summary retrieved successfully', data, success: true });
  } catch (error) {
    const code = /not found/i.test(error?.message ?? '') ? 404 : /not your campaign/i.test(error?.message ?? '') ? 403 : 500;
    res.status(code).json({ message: error.message, success: false });
  }
};

// All owned campaigns with their allocation funnels (Manage table, one round trip).
export const myAllocationSummaries = async (req, res) => {
  try {
    const me = sessionId(req);
    const campaigns = await CampaignModel.find({ createdBy: me }).select('_id').lean();
    const summary = new AllocationSummaryUseCase({});
    const rows = await Promise.all((campaigns ?? []).map((c) =>
      summary.execute({ campaignId: String(c._id), partnerId: me }).catch(() => null)
    ));
    res.status(200).json({
      message: 'Allocation summaries retrieved successfully',
      data: Object.fromEntries((rows ?? []).filter(Boolean).map((r) => [r.campaignId, r])),
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load allocation summaries', error: error.message, success: false });
  }
};

// Pause/resume allocation + tune caps (owner or admin).
export const updateAllocationSettings = async (req, res) => {
  try {
    const campaign = await CampaignModel.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found', success: false });
    }
    if (!(await guardCampaignAccess(req, res, campaign))) return;
    const admin = await isAdminSession(req);
    const owner = String(campaign.createdBy) === String(sessionId(req));
    if (!owner && !admin) {
      return res.status(403).json({ message: 'Only the owner or an admin can change allocation settings', success: false });
    }
    const patch = {};
    if (req.body?.paused !== undefined) patch['allocation.paused'] = !!req.body.paused;
    if (req.body?.enabled !== undefined) patch['allocation.enabled'] = !!req.body.enabled;
    if (req.body?.allowOutOfArea !== undefined) patch['allocation.allowOutOfArea'] = !!req.body.allowOutOfArea;
    for (const key of ['dailyCap', 'totalCap']) {
      if (req.body?.[key] !== undefined) {
        const n = Math.floor(Number(req.body[key]));
        if (!Number.isFinite(n) || n < 1 || n > 1000) {
          return res.status(400).json({ message: `${key} must be between 1 and 1000`, success: false });
        }
        patch[`allocation.${key}`] = n;
      }
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ message: 'Nothing to update', success: false });
    }
    await CampaignModel.updateOne({ _id: campaign._id }, { $set: patch });
    void recordAudit({
      actorId: sessionId(req), action: 'campaign.allocation.pause',
      targetType: 'campaign', targetId: String(campaign._id), detail: patch,
    });
    res.status(200).json({ message: 'Allocation settings updated', data: patch, success: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update allocation settings', error: error.message, success: false });
  }
};

// Partner reports one allocated lead as bad (owner only — checked in usecase).
export const reportAllocation = async (req, res) => {
  try {
    const data = await new ReportAllocationUseCase({}).execute({
      allocationId: req.params.allocationId,
      partnerId: sessionId(req),
      reason: req.body?.reason ?? '',
    });
    res.status(200).json({ message: 'Lead reported — an admin will review it', data, success: true });
  } catch (error) {
    const msg = error?.message ?? 'Failed to report lead';
    const code = /not found/i.test(msg) ? 404 : /not your allocation|no longer/i.test(msg) ? 403 : 500;
    res.status(code).json({ message: msg, success: false });
  }
};

// Batch campaign names for pipeline badges (per-row ownership check —
// foreign rows are silently skipped, never confirmed).
export const campaignNames = async (req, res) => {
  try {
    const ids = [...new Set(
      String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter((s) => /^[a-fA-F0-9]{24}$/.test(s)),
    )].slice(0, 50);
    const rows = ids.length > 0
      ? await CampaignModel.find({ _id: { $in: ids } }).select('_id campaignName createdBy').lean().catch(() => [])
      : [];
    const out = {};
    for (const r of rows ?? []) {
      try {
        await guard.requireListAccess(sessionId(req), r.createdBy);
        out[String(r._id)] = r.campaignName ?? 'Campaign';
      } catch { /* skip foreign rows silently */ }
    }
    res.status(200).json({ message: 'Campaign names retrieved', data: out, success: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load campaign names', error: error.message, success: false });
  }
};

// Admin verdict on a reported allocation (replace = credit + refill slot).
export const verdictAllocation = async (req, res) => {
  try {
    const data = await new VerdictAllocationUseCase({}).execute({
      allocationId: req.params.allocationId,
      decision: req.body?.decision,
      note: req.body?.note ?? '',
    });
    void recordAudit({
      actorId: sessionId(req), action: 'campaign.allocation.verdict',
      targetType: 'allocation', targetId: req.params.allocationId,
      detail: { decision: req.body?.decision, credited: data.credited ?? 0 },
    });
    const message = data.status === 'replaced'
      ? `Lead replaced — ₦${Number(data.credited).toLocaleString()} credited back`
      : 'Report dismissed — allocation stands';
    res.status(200).json({ message, data, success: true });
  } catch (error) {
    const msg = error?.message ?? 'Failed to decide report';
    const code = /not found/i.test(msg) ? 404 : /already decided|unknown decision/i.test(msg) ? 409 : 500;
    res.status(code).json({ message: msg, success: false });
  }
};

// Admin desk: every reported-but-undecided allocation with context.
export const listReportedAllocations = async (req, res) => {
  try {
    const rows = await CampaignAllocationModel.find({ status: 'reported-bad' })
      .sort({ createdAt: -1 }).limit(200).lean().catch(() => []);
    const campaignIds = [...new Set((rows ?? []).map((r) => String(r.campaignId)))];
    const partnerIds = [...new Set((rows ?? []).map((r) => String(r.partnerId)))];
    const [campaigns, partners] = await Promise.all([
      CampaignModel.find({ _id: { $in: campaignIds } }).select('campaignName category').lean().catch(() => []),
      PartnersModel.find({ _id: { $in: partnerIds } }).select('username name surname email phone').lean().catch(() => []),
    ]);
    const campaignLabels = Object.fromEntries((campaigns ?? []).map((c) => [String(c._id), { name: c.campaignName, category: c.category ?? '' }]));
    const partnerLabels = Object.fromEntries((partners ?? []).map((p) => [String(p._id), {
      username: p.username, name: [p.name, p.surname].filter(Boolean).join(' ') || p.username,
      email: p.email ?? null, phone: p.phone ?? null,
    }]));
    res.status(200).json({
      message: 'Reported allocations retrieved successfully',
      data: (rows ?? []).map((r) => ({
        ...r,
        campaign: campaignLabels[String(r.campaignId)] ?? null,
        partner: partnerLabels[String(r.partnerId)] ?? null,
      })),
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load reported allocations', error: error.message, success: false });
  }
};

// Owner self-cancel while Pending — same full refund as a reject, no admin wait.
export const cancelCampaign = async (req, res) => {
  try {
    const campaign = await CampaignModel.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found', success: false });
    }
    if (String(campaign.createdBy) !== String(sessionId(req))) {
      return res.status(403).json({ message: 'Only the campaign owner can cancel it', success: false });
    }
    if (campaign.deliveryStatus !== 'Pending') {
      return res.status(409).json({ message: 'Only pending campaigns can be cancelled', success: false });
    }
    campaign.deliveryStatus = 'Cancelled';
    await campaign.save();
    const refunded = await refundHeldBudget(campaign, 'Campaign Cancel Refund');
    await notifyOwner(campaign.createdBy, {
      title: 'Your ad campaign was cancelled',
      body: `"${campaign.campaignName}" was cancelled before review — ₦${Number(refunded).toLocaleString()} held budget refunded in full.`,
      campaignId: String(campaign._id),
      status: 'Ended',
    });
    void recordAudit({
      actorId: sessionId(req), action: 'campaign.decide',
      targetType: 'campaign', targetId: String(campaign._id),
      detail: { from: 'Pending', to: 'Cancelled', by: 'owner', refunded },
    });
    res.status(200).json({ message: `Campaign cancelled — ₦${Number(refunded).toLocaleString()} refunded`, data: campaign, success: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel campaign', error: error.message, success: false });
  }
};

// Duplicate a campaign as a fresh Pending record (owner or admin).
// Money moves again on purpose: a duplicate is a new campaign, so the full
// budget is held again — never a free copy of a paid run.
export const duplicateCampaign = async (req, res) => {
  try {
    const source = await CampaignModel.findById(req.params.id).lean();
    if (!source) {
      return res.status(404).json({ message: 'Campaign not found', success: false });
    }
    if (!(await guardCampaignAccess(req, res, source))) return;
    const admin = await isAdminSession(req);
    const owner = String(source.createdBy) === String(sessionId(req));
    if (!owner && !admin) {
      return res.status(403).json({ message: 'Only the owner or an admin can duplicate a campaign', success: false });
    }
    const channel = String(source.channel ?? '').toLowerCase();
    if (!CHANNEL_MINIMUM[channel]) {
      return res.status(400).json({ message: 'Original campaign channel is no longer supported', success: false });
    }
    const budgetAmount = Number(source.budget?.budgetAmount);
    if (!Number.isFinite(budgetAmount) || budgetAmount < CHANNEL_MINIMUM[channel]) {
      return res.status(402).json({ message: `Minimum budget for ${CHANNEL_LABEL[channel]} is ₦${CHANNEL_MINIMUM[channel].toLocaleString()}.`, success: false });
    }
    const { _id, createdAt, updatedAt, __v, ...rest } = source;
    const { campaign: copy } = await purchaseCampaign({
      body: { createdBy: source.createdBy },
      amount: budgetAmount,
      label: CHANNEL_LABEL[channel],
      campaign: {
        ...rest,
        campaignName: `${source.campaignName ?? 'Campaign'} (copy)`,
        deliveryStatus: 'Pending',
        visits: 0,
        closeout: {},
        allocation: {
          ...(source.allocation ?? {}),
          enabled: true,
          paused: false,
          delivered: 0,
          spent: 0,
          fundsSkips: 0,
          lastRunAt: null,
          lastFundsNoticeAt: null,
          lastDigestAt: null,
        },
      },
    });
    void recordAudit({
      actorId: sessionId(req), action: 'campaign.duplicate',
      targetType: 'campaign', targetId: String(copy._id),
      detail: { from: String(source._id), budget: budgetAmount },
    });
    res.status(200).json({ message: 'Campaign duplicated — review and publish from My campaigns', data: copy, success: true });
  } catch (error) {
    const status = error.statusCode ?? 500;
    res.status(status).json({
      message: status === 500 ? 'Failed to duplicate campaign' : error.message,
      success: false,
    });
  }
};

// Count-only matcher preview for the wizard ("N leads match your targets").
// Same hard filters as allocation (state tier, no duplicates) — no caps,
// no debits, nothing written.
export const estimateSupply = async (req, res) => {
  try {
    const scope = String(req.query.scope ?? 'States');
    const targets = String(req.query.targets ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const category = String(req.query.category ?? '').trim().slice(0, 80);
    const ageRange = String(req.query.ageRange ?? '').trim().slice(0, 20);
    const allowOutOfArea = req.query.allowOutOfArea === 'true';
    const pseudo = {
      targetAudience: { locationTarget: scope, locationTargets: targets, ageRangeTarget: ageRange || 'All' },
      category,
    };
    const rows = await ProspectSurveyModel.find({ username: 'business', prospectStatus: 'Not Moved' })
      .sort({ createdAt: -1 }).limit(500).lean().catch(() => []);
    const partnerId = sessionId(req);
    const contacts = partnerId
      ? await ProspectModel.find({ partnerId }).select('prospectEmail prospectPhone').lean().catch(() => [])
      : [];
    const seen = new Set(
      (contacts ?? []).flatMap((c) => [c.prospectEmail, c.prospectPhone]).map((v) => String(v ?? '').trim()).filter(Boolean),
    );
    let matched = 0;
    const byTier = { 1: 0, 2: 0, 3: 0 };
    for (const row of rows ?? []) {
      const keys = [row.email, row.phoneNumber].map((v) => String(v ?? '').trim()).filter(Boolean);
      if (keys.some((k) => seen.has(k))) continue;
      const tier = allocationTier(row, { scope, targets });
      if (tier === 0 || (tier === 3 && !allowOutOfArea)) continue;
      matched += 1;
      byTier[tier] += 1;
    }
    res.status(200).json({
      message: 'Supply estimate retrieved successfully',
      data: { matched, byTier, scanned: (rows ?? []).length },
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to estimate supply', error: error.message, success: false });
  }
};

// Report by pool-survey id (personal-list rows carry the survey, not the ledger id).
export const reportAllocationBySurvey = async (req, res) => {
  try {
    const entry = await CampaignAllocationModel.findOne({
      poolSurveyId: req.params.surveyId,
      partnerId: sessionId(req),
    }).lean().catch(() => null);
    if (!entry) {
      return res.status(404).json({ message: 'No allocation found for this lead', success: false });
    }
    const data = await new ReportAllocationUseCase({}).execute({
      allocationId: String(entry._id),
      partnerId: sessionId(req),
      reason: req.body?.reason ?? '',
    });
    res.status(200).json({ message: 'Lead reported — an admin will review it', data, success: true });
  } catch (error) {
    const msg = error?.message ?? 'Failed to report lead';
    const code = /not found/i.test(msg) ? 404 : /not your allocation|no longer/i.test(msg) ? 403 : 500;
    res.status(code).json({ message: msg, success: false });
  }
};
