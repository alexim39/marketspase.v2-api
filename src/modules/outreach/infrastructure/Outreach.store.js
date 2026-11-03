import mongoose from 'mongoose';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { ParterSMSModel } from '../../../apps/sms/models/sms.model.js';
import { ParterEmailsModel } from '../../../apps/email/models/email.model.js';
import { ScheduledSmsModel } from './ScheduledSms.model.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
import { MongoCampaignLookup } from '../../marketing/infrastructure/Marketing.mongo.repository.js';

/**
 * Outreach read/write ports with production defaults — one place so the
 * routes file and the minute worker share the exact same stores.
 */
export const outreachDeps = (overrides = {}) => ({
  partners: PartnersModel,
  transactions: TransactionModel,
  records: ParterSMSModel,
  emailRecords: ParterEmailsModel,
  schedules: ScheduledSmsModel,
  campaigns: new MongoCampaignLookup(),
  ...overrides,
});
export const outreachSms = (overrides = {}) => {
  const smsEnv = overrides.smsEnv ?? {};
  return {
    sms: buildSmsSender(smsEnv),
    smsEnabled: Boolean(smsEnv.enabled),
  };
};

/**
 * Outreach spend reader for campaign ROI — sums sms-record costs stamped
 * with a campaign id inside a window. Zero when unattributed (legacy rows
 * and non-campaign sends simply don't match).
 */
export class MongoOutreachSpend {
  async spendByCampaign(partnerId, campaignId, start, end) {
    let partnerOid;
    try {
      partnerOid = new mongoose.Types.ObjectId(String(partnerId));
    } catch {
      return 0;
    }
    const rows = await ParterSMSModel.aggregate([
      {
        $match: {
          partnerId: partnerOid,
          campaignId: new mongoose.Types.ObjectId(String(campaignId)),
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, spend: { $sum: '$cost' } } },
    ]).catch(() => []);
    return rows.length > 0 ? Math.round(Number(rows[0].spend ?? 0) * 100) / 100 : 0;
  }
}
