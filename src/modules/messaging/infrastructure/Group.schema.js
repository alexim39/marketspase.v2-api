import mongoose from 'mongoose';

/**
 * Group chat models. Groups are member-scoped (invite/request to join);
 * nothing here is visible to non-members except directory-safe basics
 * (name, description, photo, member count) on the search endpoint.
 */

const groupSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    photo: { type: String, default: null },
    joinPolicy: { type: String, enum: ['open', 'approval'], default: 'approval' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    pinnedMessageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /** Purpose-team bridge — one group chat per mentorship team (sparse: plain groups carry no team). */
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);
groupSchema.index({ name: 'text', description: 'text' });
groupSchema.index({ teamId: 1 }, { unique: true, sparse: true });

const groupMemberSchema = mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    muted: { type: Boolean, default: false },
    lastReadAt: { type: Date, default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
groupMemberSchema.index({ groupId: 1, partnerId: 1 }, { unique: true });

const groupBanSchema = mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    reason: { type: String, default: '', maxlength: 300 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
groupBanSchema.index({ groupId: 1, partnerId: 1 }, { unique: true });

const groupMessageSchema = mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    attachments: {
      type: [{
        url: { type: String, required: true },
        mime: { type: String, required: true },
        size: { type: Number, required: true },
        _id: false,
      }],
      default: [],
    },
    editedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
groupMessageSchema.index({ groupId: 1, createdAt: -1 });

const groupJoinRequestSchema = mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    decidedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
groupJoinRequestSchema.index({ groupId: 1, partnerId: 1 }, { unique: true });

const groupReportSchema = mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    reason: { type: String, default: '', trim: true, maxlength: 300 },
    status: { type: String, enum: ['pending', 'dismissed', 'removed'], default: 'pending', index: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    decidedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export const ChatGroupModel =
  mongoose.models.ChatGroup ?? mongoose.model('ChatGroup', groupSchema);
export const GroupMemberModel =
  mongoose.models.GroupMember ?? mongoose.model('GroupMember', groupMemberSchema);
export const GroupBanModel =
  mongoose.models.GroupBan ?? mongoose.model('GroupBan', groupBanSchema);
export const GroupMessageModel =
  mongoose.models.GroupMessage ?? mongoose.model('GroupMessage', groupMessageSchema);
export const GroupJoinRequestModel =
  mongoose.models.GroupJoinRequest ?? mongoose.model('GroupJoinRequest', groupJoinRequestSchema);
export const GroupReportModel =
  mongoose.models.GroupReport ?? mongoose.model('GroupReport', groupReportSchema);
