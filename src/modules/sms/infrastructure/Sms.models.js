import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
  idempotencyKey: { type: String, required: true },
  body: { type: String, required: true, maxlength: 459 },
  pages: { type: Number, required: true, min: 1, max: 3 },
  pricePerPage: { type: Number, required: true, default: 10 },
  totalCost: { type: Number, required: true, min: 0 },
  recipientCount: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  refundedAmount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled'],
    default: 'sending',
    index: true,
  },
  scheduledAt: { type: Date, default: null, index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  error: { type: String, default: null, maxlength: 500 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
}, { timestamps: true });

campaignSchema.index({ partnerId: 1, idempotencyKey: 1 }, { unique: true });
campaignSchema.index({ partnerId: 1, createdAt: -1 });
campaignSchema.index({ status: 1, scheduledAt: 1 });

const recipientSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmsCampaign', required: true, index: true },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
  recipientType: { type: String, enum: ['prospect', 'partner', 'customer_lead'], required: true },
  recipientId: { type: String, required: true },
  name: { type: String, default: '' },
  phone: { type: String, required: true },
  renderedBody: { type: String, required: true, maxlength: 459 },
  pages: { type: Number, required: true, min: 1, max: 3 },
  cost: { type: Number, required: true, min: 0 },
  bonusCost: { type: Number, required: true, min: 0, default: 0 },
  status: {
    type: String,
    enum: ['queued', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'queued',
    index: true,
  },
  providerId: { type: String, default: null },
  error: { type: String, default: null, maxlength: 500 },
  sentAt: { type: Date, default: null },
  refundedAt: { type: Date, default: null },
  refundAmount: { type: Number, default: 0 },
}, { timestamps: true });

recipientSchema.index({ campaignId: 1, status: 1 });

const templateSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
  name: { type: String, required: true, maxlength: 80 },
  body: { type: String, required: true, maxlength: 459 },
}, { timestamps: true });

templateSchema.index({ partnerId: 1, name: 1 }, { unique: true });

const suppressionSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
  phone: { type: String, required: true },
  reason: { type: String, default: 'Manual opt-out', maxlength: 200 },
}, { timestamps: true });

suppressionSchema.index({ partnerId: 1, phone: 1 }, { unique: true });

export const SmsCampaignModel = mongoose.models.SmsCampaign
  ?? mongoose.model('SmsCampaign', campaignSchema, 'sms_campaigns');
export const SmsRecipientModel = mongoose.models.SmsRecipient
  ?? mongoose.model('SmsRecipient', recipientSchema, 'sms_recipients');
export const SmsTemplateModel = mongoose.models.SmsTemplate
  ?? mongoose.model('SmsTemplate', templateSchema, 'sms_templates');
export const SmsSuppressionModel = mongoose.models.SmsSuppression
  ?? mongoose.model('SmsSuppression', suppressionSchema, 'sms_suppressions');
