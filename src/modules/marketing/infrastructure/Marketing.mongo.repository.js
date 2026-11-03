import mongoose from 'mongoose';
import { CampaignModel } from '../../../apps/campaign/models/campaign.model.js';
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';
import { CampaignAllocationModel } from '../../../apps/campaign/models/allocation.model.js';

const objectId = (v) => new mongoose.Types.ObjectId(String(v));
const oid = (v) => String(v);

/** Mongo implementation of the campaign-stats contract. Reads use `.lean()`. */
export class MongoMarketingRepository {
  async listCampaigns(partnerId) {
    return CampaignModel.find({ createdBy: partnerId }).sort({ createdAt: -1 }).limit(200).lean();
  }

  /** 'Unique Link' prospects (and their conversions) created in-window. */
  async countLinkWindow(partnerId, start, end) {
    const [prospects, conversions, worked] = await Promise.all([
      ProspectModel.countDocuments({
        partnerId, prospectSource: 'Unique Link', createdAt: { $gte: start, $lte: end },
      }),
      ProspectModel.countDocuments({
        partnerId,
        prospectSource: 'Unique Link',
        'status.stage': 'Converted',
        createdAt: { $gte: start, $lte: end },
      }),
      ProspectModel.countDocuments({
        partnerId,
        prospectSource: 'Unique Link',
        createdAt: { $gte: start, $lte: end },
        $or: [{ 'communications.0': { $exists: true } }, { 'stageHistory.0': { $exists: true } }],
      }),
    ]);
    return { prospects, conversions, worked };
  }

  /** Prospects stamped with this campaign id, created in-window. */
  async countExactWindow(partnerId, campaignId, start, end) {
    const [prospects, conversions, worked] = await Promise.all([
      ProspectModel.countDocuments({
        partnerId, campaignId: objectId(campaignId), createdAt: { $gte: start, $lte: end },
      }),
      ProspectModel.countDocuments({
        partnerId,
        campaignId: objectId(campaignId),
        'status.stage': 'Converted',
        createdAt: { $gte: start, $lte: end },
      }),
      ProspectModel.countDocuments({
        partnerId,
        campaignId: objectId(campaignId),
        createdAt: { $gte: start, $lte: end },
        $or: [{ 'communications.0': { $exists: true } }, { 'stageHistory.0': { $exists: true } }],
      }),
    ]);
    return { prospects, conversions, worked };
  }

  /** Internal lead spend in-window (replaced rows credited back — excluded). */
  async allocationSpendWindow(partnerId, campaignId, start, end) {
    const rows = await CampaignAllocationModel.aggregate([
      {
        $match: {
          partnerId: objectId(partnerId),
          campaignId: objectId(campaignId),
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'replaced' },
        },
      },
      { $group: { _id: null, spent: { $sum: '$costDebited' }, leads: { $sum: 1 } } },
    ]).catch(() => []);
    return { spent: Number(rows?.[0]?.spent ?? 0), leads: Number(rows?.[0]?.leads ?? 0) };
  }

  async findOwned(campaignId, partnerId) {
    return CampaignModel.findOne({ _id: campaignId, createdBy: partnerId }).select('_id').lean();
  }
}

/** Minimal ownership lookup shared with the crm create path. */
export class MongoCampaignLookup {
  async findOwned(campaignId, partnerId) {
    return CampaignModel.findOne({ _id: campaignId, createdBy: partnerId }).select('_id').lean();
  }
}
