import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    location: { type: String, required: true, trim: true, maxlength: 120 },
    readyToBeMentored: {
      type: String,
      required: true,
      enum: ['yes', 'not-yet'],
    },
    headOfficeInvite: {
      type: String,
      required: true,
      enum: ['yes', 'no'],
    },
    availability: {
      type: String,
      required: true,
      enum: ['weekdays', 'weekends'],
    },
    submittedAt: { type: Date, required: true },
    source: { type: String, default: 'prolificwoman-web', trim: true, maxlength: 80 },
    status: { type: String, enum: ['new', 'accepted'], default: 'new' },
    acceptedAt: { type: Date, default: null },
    acceptedByPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },
    prospectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prospect',
      default: null,
    },
  },
  { timestamps: true, collection: 'prolificwoman-leads' },
);

leadSchema.index({ createdAt: -1 });
leadSchema.index({ phone: 1, createdAt: -1 });
leadSchema.index({ acceptedAt: 1, createdAt: -1 });

export const ProlificWomanLeadMongooseModel =
  mongoose.models.ProlificWomanLead ??
  mongoose.model('ProlificWomanLead', leadSchema, 'prolificwoman-leads');
