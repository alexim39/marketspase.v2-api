import mongoose from 'mongoose';

/**
 * Append-only admin action log. No updates, no deletes through the app —
 * disputes resolve by reading history. Detail is a small capped snapshot
 * (from/to, amounts, statuses), never full documents.
 */
const auditSchema = new mongoose.Schema(
  {
    actorId: { type: String, required: true, index: true },
    actorLabel: { type: String, default: null },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null, index: true },
    detail: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });
auditSchema.index({ actorId: 1, createdAt: -1 });

export const AuditLogModel = mongoose.models.AdminAudit
  ?? mongoose.model('AdminAudit', auditSchema);
