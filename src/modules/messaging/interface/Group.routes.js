import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { validate } from '../../../shared/http/validate.js';
import { MongoGroupStore } from '../infrastructure/Group.mongo.repository.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { recordAudit } from '../../audit/index.js';
import { env } from '../../../shared/config/env.js';
import { TeamModel } from '../../../apps/teams/models/teams.model.js';
import { ATTACHMENT_MIMES, MAX_ATTACHMENT_BYTES } from '../../community/domain/Post.entity.js';
import { buildImageStore } from '../../settings/infrastructure/CloudinaryClient.js';
import { groupPhotoUpload } from './Group.upload.js';
import {
  AddGroupMemberUseCase,
  BanGroupMemberUseCase,
  CreateGroupUseCase,
  DecideGroupReportUseCase,
  DecideJoinRequestUseCase,
  DeleteGroupMessageUseCase,
  DeleteGroupUseCase,
  EditGroupMessageUseCase,
  FindOrCreateTeamGroupUseCase,
  GetGroupInviteUseCase,
  GetGroupUseCase,
  GroupThreadUseCase,
  JoinGroupUseCase,
  LeaveGroupUseCase,
  ListGroupBansUseCase,
  ListGroupReportsUseCase,
  ListGroupRequestsUseCase,
  ListMyGroupsUseCase,
  MarkGroupReadUseCase,
  MuteGroupUseCase,
  PinGroupMessageUseCase,
  RemoveGroupMemberUseCase,
  ReportGroupMessageUseCase,
  SearchGroupsUseCase,
  SendGroupMessageUseCase,
  SetGroupAdminUseCase,
  SetGroupPhotoUseCase,
  UnbanGroupMemberUseCase,
  UpdateGroupUseCase,
} from '../application/Group.usecases.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const GroupPayload = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().default(''),
  photo: z.string().trim().max(500).optional().default(''),
  joinPolicy: z.enum(['open', 'approval']).optional().default('approval'),
  initialMemberIds: z.array(objectId).max(20).optional().default([]),
});

const GroupPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  photo: z.string().trim().max(500).nullable().optional(),
  joinPolicy: z.enum(['open', 'approval']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const MessagePayload = z.object({
  body: z.string().trim().max(2000).optional().default(''),
  attachments: z.array(z.object({
    url: z.string().trim().regex(/^https:\/\/[^\s]+$/, 'Invalid attachment url'),
    mime: z.enum(ATTACHMENT_MIMES),
    size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  })).max(4).optional().default([]),
});

const ThreadQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  before: z.coerce.date().optional(),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildGroupRouter = (deps = {}) => {
  const groups = deps.groups ?? new MongoGroupStore();
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  const notify = deps.notify ?? new NotifyUseCase({ stored });
  /** Partner directory (injected in tests so HTTP tests never touch Mongoose). */
  const partners = deps.partners ?? null;
  /** Purpose teams (injected in tests; the bridge reads the roster to seed chats). */
  const teams = deps.teams ?? TeamModel;
  /** Audit recorder (injected in tests to avoid the 10s buffered-insert wait). */
  const audit = deps.audit ?? { record: (input) => recordAudit(input) };
  /** Group avatars live on Cloudinary (profile-photo pattern) under their own folder. */
  const groupImages = deps.images ?? buildImageStore({ ...(env.cloudinary ?? {}), folder: 'diamond-projects/groups', label: 'Group photo' });

  /** Best-effort in-app notice (never fails the request). */
  const tell = (input) => notify.execute(input).catch(() => null);

  /** Fan a notice out to every group admin (skips the actor). */
  const tellAdmins = async (groupId, actorId, notice) => {
    // Optional-call: an injected store without listAdminIds degrades to
    // "no fan-out" instead of 500ing the admin's own request.
    let adminIds = [];
    try {
      adminIds = await groups.listAdminIds?.(String(groupId)) ?? [];
    } catch { adminIds = []; }
    await Promise.allSettled(adminIds
      .map(String)
      .filter((id) => id && id !== String(actorId))
      .map((recipientId) => tell({ ...notice, recipientId })));
  };

  const router = express.Router();
  router.use(requireAuth);

  /** All group endpoints live under /groups so they never collide with DM routes. */
  const g = express.Router();
  router.use('/groups', g);

  g.post('/', validate({ body: GroupPayload }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await new CreateGroupUseCase({ groups, partners }).execute({ partnerId: req.auth?.partnerId, ...body });
    void audit.record({
      actorId: req.auth?.partnerId, action: 'chat.group.create',
      targetType: 'group', targetId: String(data?.id ?? ''),
    });
    res.status(201).json({ message: 'Group created', data, success: true });
  }));

  g.get('/mine', asyncHandler(async (req, res) => {
    const data = await new ListMyGroupsUseCase({ groups }).execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Groups retrieved', data, success: true });
  }));

  g.get('/search', validate({ query: z.object({ q: z.string().trim().max(60).optional().default(''), limit: z.coerce.number().int().min(1).max(25).optional().default(10) }) }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await new SearchGroupsUseCase({ groups }).execute({ q: q.q ?? '', limit: q.limit });
    res.status(200).json({ message: 'Groups found', data, success: true });
  }));

  // Invite preview — directory-safe fields for anyone signed in, so a shared
  // link can render a join card. No membership required, roster never leaks.
  g.get('/invite/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new GetGroupInviteUseCase({ groups }).execute({ groupId: params.id });
    res.status(200).json({ message: 'Group invite retrieved', data, success: true });
  }));

  // Team chat bridge — resolves (or creates on first visit) the group chat
  // for a purpose team so teammates always land in a conversation.
  g.get('/by-team/:teamId', validate({ params: z.object({ teamId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new FindOrCreateTeamGroupUseCase({ groups, teams }).execute({ partnerId: req.auth?.partnerId, teamId: params.teamId });
    if (data.created) {
      void audit.record({
        actorId: req.auth?.partnerId, action: 'chat.group.create',
        targetType: 'group', targetId: data.groupId, detail: { via: 'team', teamId: params.teamId },
      });
    }
    res.status(200).json({
      message: data.teamGone
        ? 'Team no longer exists — opening its group chat'
        : data.created
          ? 'Team group chat created'
          : data.joined
            ? 'Team group chat opened'
            : data.pending
              ? 'Request pending — an admin will review it'
              : 'Join the group to chat',
      data, success: true,
    });
  }));

  g.get('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new GetGroupUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({ message: 'Group retrieved', data, success: true });
  }));

  g.patch('/:id', validate({ params: z.object({ id: objectId }), body: GroupPatch }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new UpdateGroupUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, patch: body });
    res.status(200).json({ message: 'Group updated', data, success: true });
  }));

  // Group avatar (multipart `photo` field, admins) — streams to Cloudinary
  // and swaps the group's photo. Multer size/filter errors map to 400 in
  // errorMiddleware, same as community media.
  g.post('/:id/photo', groupPhotoUpload.single('photo'), validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'No photo uploaded', success: false, code: 'VALIDATION_ERROR' });
    }
    const data = await new SetGroupPhotoUseCase({ groups, images: groupImages }).execute({
      partnerId: req.auth?.partnerId, groupId: params.id,
      buffer: req.file.buffer, originalName: req.file.originalname,
    });
    void audit.record({
      actorId: req.auth?.partnerId, action: 'chat.group.photo',
      targetType: 'group', targetId: params.id,
    });
    res.status(200).json({ message: 'Group photo updated', data, success: true });
  }));

  g.delete('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new DeleteGroupUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    void audit.record({
      actorId: req.auth?.partnerId, action: 'chat.group.delete',
      targetType: 'group', targetId: params.id,
    });
    res.status(200).json({ message: 'Group deleted', data, success: true });
  }));

  g.post('/:id/join', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new JoinGroupUseCase({ groups, partners }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({
      message: data.joined ? 'Joined group' : data.pending ? 'Request sent — an admin will review it' : 'Already a member',
      data, success: true,
    });
  }));

  g.post('/:id/leave', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new LeaveGroupUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({
      message: data.dissolved ? 'Left — the group dissolved with no members left' : 'Left group',
      data, success: true,
    });
  }));

  g.post('/:id/mute', validate({ params: z.object({ id: objectId }), body: z.object({ muted: z.boolean() }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new MuteGroupUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, muted: body.muted });
    res.status(200).json({ message: body.muted ? 'Group muted' : 'Group unmuted', data, success: true });
  }));

  g.get('/:id/members', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new GetGroupUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({ message: 'Members retrieved', data: data.members, success: true });
  }));

  g.post('/:id/members', validate({ params: z.object({ id: objectId }), body: z.object({ userId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new AddGroupMemberUseCase({ groups, partners }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, userId: body.userId });
    if (data.added) {
      await tell({
        recipientId: String(body.userId), category: 'social', priority: 'medium',
        title: 'Added to a group', body: 'You were added to a group chat — open Messages to say hello.',
        icon: 'group_add', link: '/dashboard/messages', key: `group-added:${params.id}:${body.userId}`,
      });
    }
    res.status(200).json({ message: data.added ? 'Member added' : 'Already a member', data, success: true });
  }));

  g.delete('/:id/members/:userId', validate({ params: z.object({ id: objectId, userId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new RemoveGroupMemberUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, userId: params.userId });
    res.status(200).json({ message: 'Member removed', data, success: true });
  }));

  g.post('/:id/admins', validate({ params: z.object({ id: objectId }), body: z.object({ userId: objectId, isAdmin: z.boolean() }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new SetGroupAdminUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, userId: body.userId, isAdmin: body.isAdmin });
    res.status(200).json({ message: body.isAdmin ? 'Admin granted' : 'Admin revoked', data, success: true });
  }));

  g.post('/:id/ban', validate({ params: z.object({ id: objectId }), body: z.object({ userId: objectId, reason: z.string().trim().max(300).optional().default('') }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new BanGroupMemberUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, userId: body.userId, reason: body.reason });
    void audit.record({
      actorId: req.auth?.partnerId, action: 'chat.group.ban',
      targetType: 'group', targetId: params.id, detail: { user: body.userId },
    });
    res.status(200).json({ message: 'Member banned', data, success: true });
  }));

  g.post('/:id/unban', validate({ params: z.object({ id: objectId }), body: z.object({ userId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new UnbanGroupMemberUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, userId: body.userId });
    res.status(200).json({ message: 'Member unbanned', data, success: true });
  }));

  g.get('/:id/bans', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new ListGroupBansUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({ message: 'Bans retrieved', data, success: true });
  }));

  g.get('/:id/requests', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new ListGroupRequestsUseCase({ groups, partners }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({ message: 'Join requests retrieved', data, success: true });
  }));

  g.post('/:id/requests/:requestId/decision', validate({ params: z.object({ id: objectId, requestId: objectId }), body: z.object({ decision: z.enum(['approve', 'reject']) }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new DecideJoinRequestUseCase({ groups, partners }).execute({ partnerId: req.auth?.partnerId, requestId: params.requestId, decision: body.decision });
    if (data.decision === 'approved') {
      await tellAdmins(params.id, req.auth?.partnerId, {
        category: 'social', priority: 'medium',
        title: 'New group member',
        body: 'A join request was approved — say hello to the new member.',
        icon: 'group_add', link: '/dashboard/messages', key: `group-joined:${params.id}:${Date.now()}`,
      });
    }
    res.status(200).json({ message: data.decision === 'approved' ? 'Request approved' : 'Request declined', data, success: true });
  }));

  g.get('/:id/messages', validate({ params: z.object({ id: objectId }), query: ThreadQuery }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const q = req.validated?.query ?? req.query;
    const data = await new GroupThreadUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, limit: q.limit, before: q.before });
    res.status(200).json({ message: 'Group messages retrieved', data, success: true });
  }));

  g.post('/:id/messages', validate({ params: z.object({ id: objectId }), body: MessagePayload }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new SendGroupMessageUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, body: body.body, attachments: body.attachments ?? [] });
    res.status(201).json({ message: 'Message sent', data, success: true });
  }));

  g.patch('/:id/messages/:messageId', validate({ params: z.object({ id: objectId, messageId: objectId }), body: z.object({ body: z.string().trim().min(1).max(2000) }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new EditGroupMessageUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, messageId: params.messageId, body: body.body });
    res.status(200).json({ message: 'Message updated', data, success: true });
  }));

  g.delete('/:id/messages/:messageId', validate({ params: z.object({ id: objectId, messageId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new DeleteGroupMessageUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, messageId: params.messageId });
    res.status(200).json({ message: 'Message deleted', data, success: true });
  }));

  g.post('/:id/read', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new MarkGroupReadUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({ message: 'Marked as read', data, success: true });
  }));

  g.post('/:id/pin', validate({ params: z.object({ id: objectId }), body: z.object({ messageId: objectId.nullable().optional() }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new PinGroupMessageUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, messageId: body.messageId ?? null });
    res.status(200).json({ message: body.messageId ? 'Message pinned' : 'Pin removed', data, success: true });
  }));

  g.post('/:id/report', validate({ params: z.object({ id: objectId }), body: z.object({ messageId: objectId, reason: z.string().trim().max(300).optional().default('') }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new ReportGroupMessageUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, messageId: body.messageId, reason: body.reason });
    await tellAdmins(params.id, req.auth?.partnerId, {
      category: 'system', priority: 'high', title: 'Message reported in a group',
      body: 'A group message was reported — review it in the group panel.',
      icon: 'flag', link: '/dashboard/messages', key: `group-report:${params.id}:${body.messageId}:${Date.now()}`,
    });
    res.status(200).json({ message: 'Reported — group admins were notified', data, success: true });
  }));

  g.get('/:id/reports', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await new ListGroupReportsUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id });
    res.status(200).json({ message: 'Reports retrieved', data, success: true });
  }));

  g.post('/:id/reports/:reportId/decision', validate({ params: z.object({ id: objectId, reportId: objectId }), body: z.object({ decision: z.enum(['dismiss', 'remove']), banMember: z.boolean().optional().default(false) }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await new DecideGroupReportUseCase({ groups }).execute({ partnerId: req.auth?.partnerId, groupId: params.id, reportId: params.reportId, decision: body.decision, banMember: body.banMember });
    res.status(200).json({ message: body.decision === 'remove' ? 'Message removed' : 'Report dismissed', data, success: true });
  }));

  return router;
};

export default buildGroupRouter;
