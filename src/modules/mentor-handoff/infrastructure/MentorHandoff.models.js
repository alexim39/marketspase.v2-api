import mongoose from 'mongoose';

const mentorHandoffSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      unique: true,
      index: true,
    },
    mentorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['referral', 'allocation', 'override'],
      default: 'referral',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'contacted', 'closed'],
      default: 'pending',
      index: true,
    },
    preference: {
      type: String,
      enum: ['in_app', 'email', 'whatsapp', 'phone', 'prefer_not_now'],
      default: 'in_app',
    },
    consentAt: { type: Date, default: null },
    joinedAt: { type: Date, required: true, default: Date.now },
    memberActivatedAt: { type: Date, default: null },
    templateKey: { type: String, default: null, trim: true, maxlength: 80 },
    sentAt: { type: Date, default: null },
    channels: {
      chat: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
    },
    firstContactAt: { type: Date, default: null },
    lastContactAt: { type: Date, default: null },
    reminder24At: { type: Date, default: null },
    reminder48At: { type: Date, default: null },
    day7At: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
    note: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'mentor_handoffs' },
);

mentorHandoffSchema.index({ mentorId: 1, status: 1, joinedAt: -1 });
mentorHandoffSchema.index({ status: 1, joinedAt: 1 });

export const MentorHandoffModel =
  mongoose.models.MentorHandoff
  ?? mongoose.model('MentorHandoff', mentorHandoffSchema);
