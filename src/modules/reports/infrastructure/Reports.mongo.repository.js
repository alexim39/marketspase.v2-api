import mongoose from 'mongoose';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const reportSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    uplineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    highlights: { type: String, required: true, maxlength: 5000 },
    blockers: { type: String, default: '', maxlength: 2000 },
    plans: { type: String, default: '', maxlength: 2000 },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportRequest', default: null },
  },
  { timestamps: true },
);
reportSchema.index({ uplineId: 1, createdAt: -1 });

const requestSchema = new mongoose.Schema(
  {
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    downlineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    note: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'fulfilled'], default: 'open', index: true },
    fulfilledReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
  },
  { timestamps: true },
);
requestSchema.index({ downlineId: 1, status: 1, createdAt: -1 });

export const ReportModel = mongoose.models.Report ?? mongoose.model('Report', reportSchema);
export const ReportRequestModel = mongoose.models.ReportRequest ?? mongoose.model('ReportRequest', requestSchema);

const oid = (v) => String(v);
const shaped = (o) => ({ ...o, id: oid(o._id) });

/** Directory-safe author label (no email/phone — same rule as network nodes). */
async function authorLabels(ids) {
  if (ids.length === 0) return {};
  const docs = await PartnersModel.find({ _id: { $in: ids } })
    .select('username name surname profileImage')
    .lean();
  return Object.fromEntries(docs.map((d) => [oid(d._id), {
    username: d.username,
    name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
    profileImage: d.profileImage ?? null,
  }]));
}

/** Mongo implementation of the report store. Reads use `.lean()`. */
export class MongoReportStore {
  async createReport(data) {
    return shaped((await ReportModel.create(data)).toObject());
  }

  async listByAuthor(partnerId, limit = 20) {
    const docs = await ReportModel.find({ partnerId }).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map(shaped);
  }

  async listByAuthors(partnerIds, limit = 50) {
    if (partnerIds.length === 0) return [];
    const docs = await ReportModel.find({ partnerId: { $in: partnerIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const labels = await authorLabels([...new Set(docs.map((d) => oid(d.partnerId)))]);
    return docs.map((d) => ({ ...shaped(d), author: labels[oid(d.partnerId)] ?? null }));
  }

  async createRequest(data) {
    return shaped((await ReportRequestModel.create(data)).toObject());
  }

  async findRequestById(id) {
    const doc = await ReportRequestModel.findById(id).lean();
    return doc ? shaped(doc) : null;
  }

  async findOpenRequest(requesterId, downlineId, periodStart, periodEnd) {
    const doc = await ReportRequestModel.findOne({
      requesterId, downlineId, periodStart, periodEnd, status: 'open',
    }).lean();
    return doc ? shaped(doc) : null;
  }

  async listIncomingRequests(downlineId) {
    const docs = await ReportRequestModel.find({ downlineId, status: 'open' }).sort({ createdAt: -1 }).lean();
    const labels = await authorLabels([...new Set(docs.map((d) => oid(d.requesterId)))]);
    return docs.map((d) => ({ ...shaped(d), requester: labels[oid(d.requesterId)] ?? null }));
  }

  async listOutgoingRequests(requesterId) {
    const docs = await ReportRequestModel.find({ requesterId }).sort({ createdAt: -1 }).limit(50).lean();
    const labels = await authorLabels([...new Set(docs.map((d) => oid(d.downlineId)))]);
    return docs.map((d) => ({ ...shaped(d), downline: labels[oid(d.downlineId)] ?? null }));
  }

  async fulfillRequest(id, reportId) {
    const doc = await ReportRequestModel.findByIdAndUpdate(
      id,
      { $set: { status: 'fulfilled', fulfilledReportId: reportId } },
      { new: true },
    ).lean();
    return doc ? shaped(doc) : null;
  }
}
