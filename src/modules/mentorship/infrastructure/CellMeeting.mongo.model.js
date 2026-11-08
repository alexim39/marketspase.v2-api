import mongoose from 'mongoose';

/**
 * Cell-meeting attendance (one row per member per meeting day).
 * The meeting room is external; this records the time the member actually
 * spent in the room so coaches can see participation without a manual log.
 */
const cellMeetingSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    /** Africa/Lagos calendar day (YYYY-MM-DD). */
    meetingDate: { type: String, required: true, index: true },
    durationSeconds: { type: Number, default: 0, min: 0 },
    sessions: { type: Number, default: 0, min: 0 },
    firstJoinedAt: { type: Date, default: null },
    lastJoinedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'cell_meeting_attendance' },
);

cellMeetingSchema.index({ partnerId: 1, meetingDate: 1 }, { unique: true });
cellMeetingSchema.index({ meetingDate: -1, durationSeconds: -1 });

export const CellMeetingAttendanceModel = mongoose.models.CellMeetingAttendance
  ?? mongoose.model('CellMeetingAttendance', cellMeetingSchema);
