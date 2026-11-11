import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { validate } from '../../../shared/http/validate.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';
import { MongoGroupStore } from '../infrastructure/Group.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { RankGroupService } from '../application/RankGroups.service.js';
import { RANK_GROUP_CONFIG, RANK_GROUP_RANKS } from '../domain/RankGroups.js';
import {
  BanGroupMemberUseCase,
  DecideGroupReportUseCase,
  DeleteGroupMessageUseCase,
  SendGroupMessageUseCase,
  UnbanGroupMemberUseCase,
} from '../application/Group.usecases.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const RankParam = z.object({ rank: z.enum(RANK_GROUP_RANKS) });
const MessageParam = RankParam.extend({ messageId: objectId });
const MemberParam = RankParam.extend({ memberId: objectId });
const ReportParam = RankParam.extend({ reportId: objectId });
const MessageBody = z.object({ body: z.string().trim().min(1).max(2000) });
const BanBody = z.object({ reason: z.string().trim().max(300).optional().default('') });
const ReportDecision = z.object({
  decision: z.enum(['dismiss', 'remove']),
  banMember: z.boolean().optional().default(false),
});

/**
 * Admin desk for the four official journey-level groups.
 * The groups are system-managed; this surface reports their state, repairs
 * membership and provides an in-admin chat/moderation surface.
 */
export const buildAdminRankGroupsRouter = (deps = {}) => {
  const groups = deps.groups ?? new MongoGroupStore();
  const progress = deps.progress ?? new MongoProgressionStore();
  const rankGroups = deps.rankGroups ?? new RankGroupService({ groups, progress });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');

  const router = express.Router();
  router.use(auth, admin);

  const rankGroupOr404 = async (rank) => {
    await rankGroups.ensureGroups().catch(() => null);
    const group = await groups.findByRankGroup(rank);
    if (!group) throw new NotFoundException(`${rank} group is not created yet — run Sync all members.`);
    return group;
  };

  /** System admins always get moderator access, even if a cache missed a new admin. */
  const ensureAdminMember = async (group, partnerId) => {
    if (!partnerId) throw new ForbiddenException('Admin sign-in required');
    if (await groups.isMember(group.id, partnerId).catch(() => false)) return;
    if (await groups.isBanned(group.id, partnerId).catch(() => false)) {
      throw new ForbiddenException('This admin account is banned from the group');
    }
    await groups.addMember(group.id, partnerId, 'admin').catch(() => null);
  };

  const messageView = (message, memberById) => {
    if (!message) return null;
    const sender = memberById.get(String(message.senderId)) ?? null;
    return {
      ...message,
      senderName: message.senderLabel ?? sender?.name ?? 'Former member',
      senderPhoto: sender?.photo ?? null,
      senderRole: sender?.role ?? null,
    };
  };

  router.get('/', asyncHandler(async (_req, res) => {
    const seed = await rankGroups.ensureGroups();
    const existing = await groups.listRankGroups();
    const byRank = new Map((existing ?? []).map((g) => [g.rankGroup, g]));
    const data = [];
    for (const rank of RANK_GROUP_RANKS) {
      const config = RANK_GROUP_CONFIG[rank];
      const group = byRank.get(rank) ?? null;
      if (!group) {
        data.push({
          rank,
          groupId: null,
          name: config.name,
          description: config.description,
          joinPolicy: 'approval',
          pinned: false,
          memberCount: 0,
          adminCount: 0,
          ready: false,
        });
        continue;
      }
      const [memberCount, adminIds] = await Promise.all([
        groups.memberCount(group.id).catch(() => 0),
        groups.listAdminIds(group.id).catch(() => []),
      ]);
      data.push({
        rank,
        groupId: group.id,
        name: group.name,
        description: group.description ?? config.description,
        joinPolicy: group.joinPolicy ?? 'approval',
        pinned: !!group.pinnedMessageId,
        memberCount,
        adminCount: (adminIds ?? []).length,
        ready: true,
      });
    }
    res.status(200).json({
      message: 'Official rank groups retrieved',
      data,
      meta: { seed },
      success: true,
    });
  }));

  router.post('/sync', asyncHandler(async (_req, res) => {
    const seed = await rankGroups.ensureGroups();
    const sync = await rankGroups.syncAll();
    res.status(200).json({
      message: 'Official rank groups repaired',
      data: { seed, sync },
      success: true,
    });
  }));

  router.get('/:rank', validate({ params: RankParam }), asyncHandler(async (req, res) => {
    const { rank } = req.validated?.params ?? req.params;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    const [members, messages, bans, reports] = await Promise.all([
      groups.membersWithProfiles(group.id).catch(() => []),
      groups.thread(group.id, { limit: 80 }).catch(() => []),
      groups.listBans(group.id).catch(() => []),
      groups.listReports(group.id).catch(() => []),
    ]);
    const memberById = new Map((members ?? []).map((m) => [String(m.id), m]));
    const pinnedRaw = group.pinnedMessageId
      ? await groups.findGroupMessage(String(group.pinnedMessageId)).catch(() => null)
      : null;
    const reportRows = [];
    for (const report of (reports ?? []).slice(0, 25)) {
      const message = await groups.findGroupMessage(String(report.messageId)).catch(() => null);
      reportRows.push({
        id: String(report._id ?? report.id),
        reason: report.reason ?? '',
        status: report.status ?? 'pending',
        createdAt: report.createdAt ?? null,
        message: messageView(message, memberById),
      });
    }
    res.status(200).json({
      message: 'Rank group retrieved',
      data: {
        rank,
        groupId: group.id,
        name: group.name,
        description: group.description ?? '',
        joinPolicy: group.joinPolicy ?? 'approval',
        memberCount: (members ?? []).length,
        adminCount: (members ?? []).filter((m) => m.role === 'admin').length,
        pinnedMessage: messageView(pinnedRaw, memberById),
        messages: (messages ?? []).map((m) => messageView(m, memberById)),
        members: members ?? [],
        bans: bans ?? [],
        reports: reportRows,
      },
      success: true,
    });
  }));

  router.post('/:rank/messages', validate({ params: RankParam, body: MessageBody }), asyncHandler(async (req, res) => {
    const { rank } = req.validated?.params ?? req.params;
    const { body } = req.validated?.body ?? req.body;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    const data = await new SendGroupMessageUseCase({ groups }).execute({
      partnerId: req.auth?.partnerId,
      groupId: group.id,
      body,
      attachments: [],
    });
    res.status(201).json({ message: 'Message sent', data, success: true });
  }));

  router.delete('/:rank/messages/:messageId', validate({ params: MessageParam }), asyncHandler(async (req, res) => {
    const { rank, messageId } = req.validated?.params ?? req.params;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    await new DeleteGroupMessageUseCase({ groups }).execute({
      partnerId: req.auth?.partnerId,
      groupId: group.id,
      messageId,
    });
    if (String(group.pinnedMessageId ?? '') === String(messageId)) {
      await groups.updateGroup(group.id, { pinnedMessageId: null }).catch(() => null);
    }
    res.status(200).json({ message: 'Message removed', data: { deleted: true }, success: true });
  }));

  router.patch('/:rank/pinned', validate({ params: RankParam, body: MessageBody }), asyncHandler(async (req, res) => {
    const { rank } = req.validated?.params ?? req.params;
    const { body } = req.validated?.body ?? req.body;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    const message = await groups.createGroupMessage({
      groupId: group.id,
      senderId: req.auth?.partnerId,
      body,
      attachments: [],
      senderLabel: 'MarketSpase',
    });
    const messageId = message?.id ?? (message?._id ? String(message._id) : null);
    await groups.updateGroup(group.id, { pinnedMessageId: messageId });
    res.status(200).json({
      message: 'Pinned welcome updated',
      data: { messageId },
      success: true,
    });
  }));

  router.post('/:rank/members/:memberId/ban', validate({ params: MemberParam, body: BanBody }), asyncHandler(async (req, res) => {
    const { rank, memberId } = req.validated?.params ?? req.params;
    const { reason } = req.validated?.body ?? req.body;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    const data = await new BanGroupMemberUseCase({ groups }).execute({
      partnerId: req.auth?.partnerId,
      groupId: group.id,
      userId: memberId,
      reason,
    });
    res.status(200).json({ message: 'Member banned', data, success: true });
  }));

  router.post('/:rank/members/:memberId/unban', validate({ params: MemberParam }), asyncHandler(async (req, res) => {
    const { rank, memberId } = req.validated?.params ?? req.params;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    const data = await new UnbanGroupMemberUseCase({ groups }).execute({
      partnerId: req.auth?.partnerId,
      groupId: group.id,
      userId: memberId,
    });
    res.status(200).json({ message: 'Member unbanned', data, success: true });
  }));

  router.post('/:rank/reports/:reportId/decision', validate({ params: ReportParam, body: ReportDecision }), asyncHandler(async (req, res) => {
    const { rank, reportId } = req.validated?.params ?? req.params;
    const { decision, banMember } = req.validated?.body ?? req.body;
    const group = await rankGroupOr404(rank);
    await ensureAdminMember(group, req.auth?.partnerId);
    const data = await new DecideGroupReportUseCase({ groups }).execute({
      partnerId: req.auth?.partnerId,
      groupId: group.id,
      reportId,
      decision,
      banMember,
    });
    res.status(200).json({ message: 'Report decided', data, success: true });
  }));

  return router;
};
