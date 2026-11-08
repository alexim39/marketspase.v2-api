import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { CellMeetingAttendanceModel } from '../infrastructure/CellMeeting.mongo.model.js';
import { collectDownlineIds, MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const network = new MongoNetworkRepository();

const router = express.Router();
router.use(requireAuth);

const MAX_MEETING_SECONDS = 12 * 60 * 60;

const lagosDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const AttendanceSchema = z.object({
  durationSeconds: z.number().int().min(1).max(MAX_MEETING_SECONDS),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const toPublic = (row) => ({
  id: String(row._id),
  meetingDate: row.meetingDate,
  durationSeconds: row.durationSeconds,
  minutes: Math.round((row.durationSeconds / 60) * 10) / 10,
  sessions: row.sessions,
  firstJoinedAt: row.firstJoinedAt,
  lastJoinedAt: row.lastJoinedAt,
});

/** Record time spent in the cell meeting for the signed-in member. */
router.post(
  '/cell-meeting',
  validate({ body: AttendanceSchema }),
  asyncHandler(async (req, res) => {
    const partnerId = req.auth?.partnerId;
    const body = req.validated?.body ?? req.body;
    const now = new Date();
    const meetingDate = body.meetingDate ?? lagosDay(now);

    const row = await CellMeetingAttendanceModel.findOneAndUpdate(
      { partnerId, meetingDate },
      {
        $inc: { durationSeconds: body.durationSeconds, sessions: 1 },
        $set: { lastJoinedAt: now },
        $setOnInsert: { firstJoinedAt: now },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    res.status(201).json({
      message: 'Cell meeting attendance recorded',
      data: toPublic(row),
      success: true,
    });
  }),
);

/** The member's own attendance history. */
router.get(
  '/cell-meeting/mine',
  asyncHandler(async (req, res) => {
    const rows = await CellMeetingAttendanceModel.find({ partnerId: req.auth?.partnerId })
      .sort({ meetingDate: -1 })
      .limit(30)
      .lean();
    const totalSeconds = rows.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0);
    res.status(200).json({
      message: 'Cell meeting attendance retrieved',
      data: {
        totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
        sessions: rows.reduce((sum, row) => sum + (row.sessions ?? 0), 0),
        rows: rows.map(toPublic),
      },
      success: true,
    });
  }),
);

/** Upline view: recent attendance across the bounded downline. */
router.get(
  '/cell-meeting/team',
  asyncHandler(async (req, res) => {
    const { ids } = await collectDownlineIds(network, req.auth?.partnerId);
    if (ids.length === 0) {
      return res.status(200).json({ message: 'No team attendance yet', data: [], success: true });
    }
    const rows = await CellMeetingAttendanceModel.find({ partnerId: { $in: ids } })
      .sort({ meetingDate: -1, durationSeconds: -1 })
      .limit(100)
      .lean();
    const partnerIds = [...new Set(rows.map((row) => String(row.partnerId)))];
    const partners = await PartnersModel.find({ _id: { $in: partnerIds } })
      .select('name surname username')
      .lean();
    const byId = new Map(partners.map((p) => [String(p._id), p]));
    res.status(200).json({
      message: 'Team cell meeting attendance retrieved',
      data: rows.map((row) => {
        const partner = byId.get(String(row.partnerId));
        return {
          ...toPublic(row),
          partnerId: String(row.partnerId),
          name: [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || 'Member',
          username: partner?.username ?? '',
        };
      }),
      success: true,
    });
  }),
);

export default router;
