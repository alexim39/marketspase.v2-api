import {
  ConflictException, ForbiddenException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { createAttachmentEntities, MAX_ATTACHMENTS } from '../../community/domain/Post.entity.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TeamModel } from '../../../apps/teams/models/teams.model.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const MAX_MEMBERS = 300;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

const cleanId = (v, field = 'id') => {
  const s = String(v ?? '').trim();
  if (!OBJECT_ID_RE.test(s)) throw new ValidationException(`Invalid ${field}`);
  return s;
};

const cleanName = (v) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > MAX_NAME) throw new ValidationException('Group name must be 2–80 characters');
  return s;
};

const cleanDescription = (v) => String(v ?? '').trim().slice(0, MAX_DESCRIPTION);

const cleanPhoto = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > 500 || (!/^https?:\/\//i.test(s) && !s.startsWith('/'))) {
    throw new ValidationException('Group photo must be an https:// or /uploads URL');
  }
  return s;
};

const cleanJoinPolicy = (v) => {
  const s = String(v ?? 'approval').trim().toLowerCase();
  if (!['open', 'approval'].includes(s)) throw new ValidationException('Invalid join policy');
  return s;
};

/** Member-or-nothing gate shared by every group read/write (bans included). */
async function requireMember(groups, groupId, partnerId) {
  const membership = await groups.memberRole(groupId, partnerId).catch(() => null);
  if (!membership) throw new ForbiddenException('Only group members can do that');
  return membership; // 'admin' | 'member'
}

async function requireAdmin(groups, groupId, partnerId) {
  const role = await groups.memberRole(groupId, partnerId).catch(() => null);
  if (role !== 'admin') throw new ForbiddenException('Only group admins can do that');
  return role;
}

async function groupOr404(groups, groupId) {
  const group = await groups.getGroup(groupId);
  if (!group) throw new NotFoundException('Group not found');
  return group;
}

/** Partner lookups that tolerate both Mongoose queries and plain fakes. */
async function partnerById(partners, id) {
  try {
    const q = partners.findById(id);
    if (q && typeof q.select === 'function') return await q.select('_id').lean();
    return await q;
  } catch { return null; }
}

async function partnersByIds(partners, ids) {
  try {
    const q = partners.find({ _id: { $in: ids } });
    if (q && typeof q.select === 'function') {
      return await q.select('name surname username profileImage').lean();
    }
    const rows = await q;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/** Team lookup tolerant of both Mongoose queries and plain fakes. */
async function teamById(teams, id) {
  try {
    const q = teams.findById(id);
    if (q && typeof q.lean === 'function') return await q.lean();
    return await q;
  } catch { return null; }
}

/** Store-shape normalizer — real store returns shaped { id }, fakes may use _id. */
const withId = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  if (doc.id) return doc;
  return { ...doc, id: String(doc._id) };
};

/** Create a group — the creator becomes its first admin. */
export class CreateGroupUseCase {
  constructor({ groups, partners = null } = {}) {
    Object.assign(this, {
      groups,
      partners: partners ?? PartnersModel,
    });
  }

  async execute({ partnerId, name, description = '', photo = null, joinPolicy = 'approval', initialMemberIds = [] }) {
    if (!partnerId) throw new ValidationException('Sign in to create a group');
    const created = await this.groups.createGroup({
      name: cleanName(name),
      description: cleanDescription(description),
      photo: cleanPhoto(photo),
      joinPolicy: cleanJoinPolicy(joinPolicy),
      createdBy: partnerId,
    });
    const group = withId(created);
    const gid = String(group.id);
    const added = [String(partnerId)];
    for (const raw of [...new Set((initialMemberIds ?? []).map(String))].slice(0, 20)) {
      if (!OBJECT_ID_RE.test(raw) || raw === String(partnerId)) continue;
      if (!(await partnerById(this.partners, raw))) continue;
      if (await this.groups.isBanned(gid, raw).catch(() => false)) continue;
      await this.groups.addMember(gid, raw).catch(() => null);
      added.push(raw);
    }
    return { ...group, id: gid, added };
  }
}

/** Team chat bridge — one group per purpose team, resolved or created on
 * demand so teammates always have a group conversation to land in.
 * Only team members (roster or creator) may resolve or create it. */
export class FindOrCreateTeamGroupUseCase {
  constructor({ groups, teams = null }) {
    Object.assign(this, { groups, teams: teams ?? TeamModel });
  }

  async execute({ partnerId, teamId }) {
    const tid = cleanId(teamId, 'team');
    if (!partnerId) throw new ValidationException('Sign in to open the team chat');
    const [team, group] = await Promise.all([
      teamById(this.teams, tid),
      this.groups.findByTeamId(tid).catch(() => null),
    ]);
    if (!team) {
      // The team is gone but its chat may live on — open the orphan instead
      // of 404ing, clearly flagged so the UI can say so.
      if (!group) throw new NotFoundException('Team not found');
      return this.openExisting(group, partnerId, { teamGone: true });
    }
    const roster = [...new Set([team.partnerId, ...(team.members ?? [])].map(String))]
      .filter((id) => OBJECT_ID_RE.test(id));
    if (!roster.includes(String(partnerId))) {
      throw new ForbiddenException('Only team members can open the team chat');
    }
    if (!group) {
      const created = await this.createTeamGroup(tid, team, partnerId, roster).catch(() => null);
      const row = created ?? await this.groups.findByTeamId(tid).catch(() => null);
      if (!row) throw new ConflictException('Team chat is being created — try again');
      return { groupId: String(row.id ?? row._id), joined: true, pending: false, created: !!created, teamGone: false };
    }
    return this.openExisting(group, partnerId, { teamGone: false });
  }

  /** Shared membership gate for a resolved group row. */
  async openExisting(group, partnerId, { teamGone }) {
    const gid = String(group.id ?? group._id);
    if (await this.groups.isMember(gid, partnerId).catch(() => false)) {
      return { groupId: gid, joined: true, pending: false, created: false, teamGone };
    }
    if (await this.groups.isBanned(gid, partnerId).catch(() => false)) {
      throw new ForbiddenException('You were removed from this group');
    }
    if ((group.joinPolicy ?? 'approval') === 'open') {
      await this.groups.addMember(gid, partnerId).catch(() => null);
      return { groupId: gid, joined: true, pending: false, created: false, teamGone };
    }
    const existing = await this.groups.findAnyRequest(gid, partnerId).catch(() => null);
    return { groupId: gid, joined: false, pending: !!existing && existing.status === 'pending', created: false, teamGone };
  }

  async createTeamGroup(tid, team, partnerId, roster) {
    let name = 'Team chat';
    try {
      name = cleanName(String(team.teamName ?? ''));
    } catch { /* fallback above */ }
    try {
      const group = await this.groups.createGroup({
        name,
        description: cleanDescription(team.description ?? ''),
        photo: null,
        joinPolicy: 'approval',
        createdBy: partnerId,
        teamId: tid,
      });
      const gid = String(group.id ?? group._id);
      const seeds = roster.filter((id) => id !== String(partnerId)).slice(0, 300);
      await Promise.allSettled(seeds.map((id) => this.groups.addMember(gid, id)));
      return group;
    } catch (error) {
      // Lost a creation race (unique teamId) — the winner's row is the answer.
      if (error?.code !== 11000) throw error;
      return null;
    }
  }
}

/** My groups: enriched rows for the sidebar (member count, unread, last message). */
export class ListMyGroupsUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId }) {
    if (!partnerId) throw new ValidationException('Sign in to view groups');
    return this.groups.listMine(partnerId);
  }
}

/** Invite preview — directory-safe fields for anyone signed in, so a shared
 * link can render a join card without leaking the roster. */
export class GetGroupInviteUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ groupId }) {
    const id = cleanId(groupId, 'group');
    const group = await groupOr404(this.groups, id);
    const memberCount = await this.groups.memberCount(id).catch(() => 0);
    return {
      id: String(group.id ?? group._id),
      name: group.name,
      description: group.description ?? '',
      photo: group.photo ?? null,
      joinPolicy: group.joinPolicy ?? 'approval',
      memberCount,
      createdAt: group.createdAt ?? null,
    };
  }
}

/** Public directory search — safe fields only, never the roster (anti-harvest). */
export class SearchGroupsUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ q, limit = 20 }) {
    return this.groups.searchGroups(q, { limit });
  }
}

/** Full group record + member roster for the info panel (members only). */
export class GetGroupUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    await requireMember(this.groups, id, partnerId).catch(() => {
      throw new NotFoundException('Group not found');
    });
    const [group, members, pendingRequests, role] = await Promise.all([
      this.groups.getGroup(id),
      this.groups.membersWithProfiles(id),
      this.groups.listRequests(id),
      this.groups.memberRole(id, partnerId).catch(() => null),
    ]);
    if (!group) throw new NotFoundException('Group not found');
    const me = (members ?? []).find((m) => String(m.id) === String(partnerId));
    let pinnedMessage = null;
    if (group.pinnedMessageId) {
      pinnedMessage = await this.groups.findGroupMessage(String(group.pinnedMessageId)).catch(() => null);
    }
    return {
      ...group,
      members: members ?? [],
      myRole: role ?? 'member',
      muted: !!me?.muted,
      // Pending requests go straight to the info panel — they need the same
      // string `id` shape as the dedicated list endpoint (raw rows only
      // carry `_id`, which the panel would otherwise send back as garbage).
      pendingRequests: role === 'admin' ? (pendingRequests ?? []).map(withId) : undefined,
      pinnedMessage,
    };
  }
}

/** Edit name/description/photo/policy (admins). */
export class UpdateGroupUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, patch = {} }) {
    const id = cleanId(groupId, 'group');
    await requireAdmin(this.groups, id, partnerId);
    const next = {};
    if (patch.name !== undefined) next.name = cleanName(patch.name);
    if (patch.description !== undefined) next.description = cleanDescription(patch.description);
    if (patch.photo !== undefined) next.photo = cleanPhoto(patch.photo);
    if (patch.joinPolicy !== undefined) next.joinPolicy = cleanJoinPolicy(patch.joinPolicy);
    if (Object.keys(next).length === 0) throw new ValidationException('Nothing to update');
    return this.groups.updateGroup(id, next);
  }
}

/** Group avatar upload (admins). Streams the buffer to the image store,
 * swaps the photo, and best-effort destroys the previous Cloudinary asset
 * so storage doesn't leak one avatar per change. */
export class SetGroupPhotoUseCase {
  constructor({ groups, images }) {
    Object.assign(this, { groups, images });
  }

  async execute({ partnerId, groupId, buffer, originalName = 'group-photo' }) {
    const id = cleanId(groupId, 'group');
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ValidationException('No photo uploaded');
    }
    const group = await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId);
    if (!this.images?.upload) throw new ValidationException('Photo uploads are not configured yet');
    const stored = await this.images.upload(buffer, { publicId: `group-${id}-${Date.now()}` });
    const url = String(stored?.url ?? '').trim();
    if (!url) throw new ValidationException('Photo upload returned no URL');
    const updated = await this.groups.updateGroup(id, { photo: url });
    // Best-effort: retire the previous avatar (never fail the request).
    const previous = String(group.photo ?? '').trim();
    if (previous && previous !== url && typeof this.images?.destroy === 'function') {
      const { publicIdFromUrl } = await import('../../settings/infrastructure/CloudinaryClient.js');
      const publicId = publicIdFromUrl(previous);
      if (publicId) await this.images.destroy(publicId).catch(() => null);
    }
    return withId(updated ?? { id, photo: url });
  }
}

/** Creator-only delete (cascades members, messages, requests, reports). */
export class DeleteGroupUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    const group = await groupOr404(this.groups, id);
    const role = await this.groups.memberRole(id, partnerId).catch(() => null);
    const isCreator = String(group.createdBy) === String(partnerId);
    const creatorLeft = !(await this.groups.isMember(id, String(group.createdBy)).catch(() => false));
    if (!isCreator && !(creatorLeft && role === 'admin')) {
      throw new ForbiddenException('Only the group creator (or a remaining admin) can delete it');
    }
    await this.groups.deleteGroupCascade(id);
    return { deleted: true, id };
  }
}

/** Join: instant for open groups, request for approval groups. Banned = 403. */
export class JoinGroupUseCase {
  constructor({ groups, partners = null }) {
    Object.assign(this, { groups, partners: partners ?? PartnersModel });
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    if (!partnerId) throw new ValidationException('Sign in to join a group');
    const group = await groupOr404(this.groups, id);
    if (await this.groups.isMember(id, partnerId).catch(() => false)) {
      return { joined: true, already: true };
    }
    if (await this.groups.isBanned(id, partnerId).catch(() => false)) {
      throw new ForbiddenException('You were removed from this group');
    }
    const me = await partnerById(this.partners, partnerId);
    if (!me) throw new NotFoundException('Partner not found');
    if (await this.groups.memberCount(id).catch(() => 0) >= MAX_MEMBERS) {
      throw new ConflictException('This group is full');
    }
    if (group.joinPolicy === 'open') {
      await this.groups.addMember(id, partnerId);
      return { joined: true, pending: false };
    }
    const existing = await this.groups.findAnyRequest(id, partnerId).catch(() => null);
    if (existing?.status === 'pending') return { joined: false, pending: true };
    if (existing) await this.groups.reopenRequest(existing._id ?? existing.id).catch(() => null);
    else await this.groups.requestJoin(id, partnerId).catch(() => null);
    return { joined: false, pending: true };
  }
}

/** Decide a join request (admins). Approvals respect the member cap. */
export class DecideJoinRequestUseCase {
  constructor({ groups, partners = null }) {
    Object.assign(this, { groups, partners: partners ?? PartnersModel });
  }

  async execute({ partnerId, requestId, decision }) {
    if (!['approve', 'reject'].includes(decision)) {
      throw new ValidationException("Unknown decision (expected 'approve' or 'reject')");
    }
    if (!OBJECT_ID_RE.test(String(requestId ?? ''))) throw new ValidationException('Invalid request');
    const request = await this.groups.findRequestById(requestId);
    if (!request || request.status !== 'pending') throw new NotFoundException('Join request not found');
    const gid = String(request.groupId);
    await requireAdmin(this.groups, gid, partnerId);
    if (decision === 'reject') {
      await this.groups.decideRequest(requestId, { decision, decidedBy: partnerId }).catch(() => null);
      return { requestId: String(requestId), decision: 'rejected' };
    }
    if (await this.groups.memberCount(gid).catch(() => MAX_MEMBERS) >= MAX_MEMBERS) {
      throw new ConflictException('This group is full');
    }
    if (await this.groups.isBanned(gid, request.partnerId).catch(() => false)) {
      throw new ConflictException('That partner is banned from this group');
    }
    await this.groups.addMember(gid, String(request.partnerId));
    await this.groups.decideRequest(requestId, { decision, decidedBy: partnerId }).catch(() => null);
    return { requestId: String(requestId), decision: 'approved' };
  }
}

/** Pending join requests (admins only). Enriched with the requester's name. */
export class ListGroupRequestsUseCase {
  constructor({ groups, partners = null }) {
    Object.assign(this, { groups, partners: partners ?? PartnersModel });
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId).catch(() => {
      throw new NotFoundException('Group not found');
    });
    const rows = await this.groups.listRequests(id);
    const ids = [...new Set((rows ?? []).map((r) => String(r.partnerId)))];
    let byId = {};
    if (ids.length > 0) {
      const docs = await partnersByIds(this.partners, ids);
      byId = Object.fromEntries((docs ?? []).map((d) => [String(d._id), {
        username: d.username,
        name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
        photo: d.profileImage ?? null,
      }]));
    }
    return (rows ?? []).map((r) => ({ ...r, id: String(r._id ?? r.id), requester: byId[String(r.partnerId)] ?? null }));
  }
}

/** Banned roster (admins) — so bans stay reversible from the UI. */
export class ListGroupBansUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId).catch(() => {
      throw new NotFoundException('Group not found');
    });
    return this.groups.listBans(id);
  }
}

/** Pending reported messages (admins only), with the message inline. */
export class ListGroupReportsUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId).catch(() => {
      throw new NotFoundException('Group not found');
    });
    const rows = await this.groups.listReports(id);
    return Promise.all((rows ?? []).map(async (r) => ({
      ...r,
      id: String(r._id ?? r.id),
      message: await this.groups.findGroupMessage(String(r.messageId)).catch(() => null),
    })));
  }
}

/** Admin direct-add (no request needed). Banned partners stay out. */
export class AddGroupMemberUseCase {
  constructor({ groups, partners = null }) {
    Object.assign(this, { groups, partners: partners ?? PartnersModel });
  }

  async execute({ partnerId, groupId, userId }) {
    const id = cleanId(groupId, 'group');
    const uid = cleanId(userId, 'user');
    await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId);
    if (await this.groups.isBanned(id, uid).catch(() => false)) {
      throw new ForbiddenException('That partner is banned from this group');
    }
    if (await this.groups.isMember(id, uid).catch(() => false)) {
      return { already: true };
    }
    if (await this.groups.memberCount(id).catch(() => 0) >= MAX_MEMBERS) {
      throw new ConflictException('This group is full');
    }
    const exists = await partnerById(this.partners, uid);
    if (!exists) throw new NotFoundException('Partner not found');
    await this.groups.addMember(id, uid);
    return { added: true };
  }
}

/** Admin remove (never the creator; use unban-free leave flow for self). */
export class RemoveGroupMemberUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, userId }) {
    const id = cleanId(groupId, 'group');
    const uid = cleanId(userId, 'user');
    const group = await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId);
    if (String(group.createdBy) === uid) {
      throw new ForbiddenException('The group creator cannot be removed — delete the group instead');
    }
    if (uid === String(partnerId)) {
      throw new ValidationException('Use leave to exit a group yourself');
    }
    await this.groups.removeMember(id, uid);
    return { removed: true };
  }
}

/** Leave anytime. Last admin standing promotes the oldest member;
 * an empty group dissolves itself. */
export class LeaveGroupUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    await groupOr404(this.groups, id);
    const role = await this.groups.memberRole(id, partnerId).catch(() => null);
    if (!role) throw new NotFoundException('You are not in this group');
    await this.groups.removeMember(id, partnerId);
    const remaining = await this.groups.membersWithProfiles(id).catch(() => []);
    if ((remaining ?? []).length === 0) {
      await this.groups.deleteGroupCascade(id);
      return { left: true, dissolved: true };
    }
    if (role === 'admin') {
      const adminsLeft = (remaining ?? []).filter((m) => m.role === 'admin');
      if (adminsLeft.length === 0 && remaining.length > 0) {
        await this.groups.setAdmin(id, remaining[0].id, true).catch(() => null);
      }
    }
    return { left: true, dissolved: false };
  }
}

/** Creator-only role management (keeps succession unambiguous). */
export class SetGroupAdminUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, userId, isAdmin }) {
    const id = cleanId(groupId, 'group');
    const uid = cleanId(userId, 'user');
    const group = await groupOr404(this.groups, id);
    if (String(group.createdBy) !== String(partnerId)) {
      throw new ForbiddenException('Only the group creator can change roles');
    }
    if (!(await this.groups.isMember(id, uid).catch(() => false))) {
      throw new NotFoundException('That partner is not in this group');
    }
    await this.groups.setAdmin(id, uid, !!isAdmin);
    return { updated: true, admin: !!isAdmin };
  }
}

/** Ban: removed + blocked from rejoining. Admins ban members; only the
 * creator can ban an admin; the creator can never be banned. */
export class BanGroupMemberUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, userId, reason = '' }) {
    const id = cleanId(groupId, 'group');
    const uid = cleanId(userId, 'user');
    const group = await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId);
    if (String(group.createdBy) === uid) {
      throw new ForbiddenException('The group creator cannot be banned');
    }
    const targetRole = await this.groups.memberRole(id, uid).catch(() => null);
    if (targetRole === 'admin' && String(group.createdBy) !== String(partnerId)) {
      throw new ForbiddenException('Only the creator can ban an admin — demote them first');
    }
    await this.groups.banMember(id, uid, partnerId, reason);
    return { banned: true };
  }
}

/** Unban (admins) — the partner may then request or be re-added. */
export class UnbanGroupMemberUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, userId }) {
    const id = cleanId(groupId, 'group');
    const uid = cleanId(userId, 'user');
    await groupOr404(this.groups, id);
    await requireAdmin(this.groups, id, partnerId);
    await this.groups.unbanMember(id, uid);
    return { unbanned: true };
  }
}

/** Per-member mute (self) — push + badge noise off, messages still flow. */
export class MuteGroupUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, muted }) {
    const id = cleanId(groupId, 'group');
    await requireMember(this.groups, id, partnerId);
    await this.groups.setMuted(id, partnerId, !!muted);
    return { muted: !!muted };
  }
}

/** Pin / unpin a message (admins). */
export class PinGroupMessageUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, messageId = null }) {
    const id = cleanId(groupId, 'group');
    await requireAdmin(this.groups, id, partnerId);
    if (messageId !== null && messageId !== undefined) {
      const mid = cleanId(messageId, 'message');
      const msg = await this.groups.findGroupMessage(mid);
      if (!msg || String(msg.groupId) !== String(id)) throw new NotFoundException('Message not found in this group');
      await this.groups.updateGroup(id, { pinnedMessageId: mid });
      return { pinned: mid };
    }
    await this.groups.updateGroup(id, { pinnedMessageId: null });
    return { pinned: null };
  }
}

/** Report a message to the group admins (best-effort visibility, no snooping). */
export class ReportGroupMessageUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, messageId, reason = '' }) {
    const id = cleanId(groupId, 'group');
    const mid = cleanId(messageId, 'message');
    await groupOr404(this.groups, id);
    await requireMember(this.groups, id, partnerId);
    const msg = await this.groups.findGroupMessage(mid);
    if (!msg || String(msg.groupId) !== String(id)) throw new NotFoundException('Message not found in this group');
    await this.groups.reportMessage({ groupId: id, messageId: mid, reporterId: partnerId, reason });
    return { reported: true };
  }
}

/** Admin verdict on a reported message (dismiss, or remove + optional ban). */
export class DecideGroupReportUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, reportId, decision, banMember = false }) {
    const id = cleanId(groupId, 'group');
    if (!['dismiss', 'remove'].includes(decision)) {
      throw new ValidationException("Unknown decision (expected 'dismiss' or 'remove')");
    }
    if (!OBJECT_ID_RE.test(String(reportId ?? ''))) throw new ValidationException('Invalid report');
    await requireAdmin(this.groups, id, partnerId);
    const existing = await this.groups.findReportById(reportId);
    if (!existing || existing.status !== 'pending' || String(existing.groupId) !== String(id)) {
      throw new NotFoundException('Report not found or already decided');
    }
    const decided = await this.groups.decideReport(reportId, { decision, decidedBy: partnerId });
    if (!decided) throw new NotFoundException('Report not found or already decided');
    if (decision === 'remove') {
      const msg = await this.groups.findGroupMessage(String(existing.messageId)).catch(() => null);
      await this.groups.deleteGroupMessage(String(existing.messageId)).catch(() => null);
      if (banMember && msg && String(msg.senderId) !== String(partnerId)) {
        const targetRole = await this.groups.memberRole(id, String(msg.senderId)).catch(() => null);
        const group = await this.groups.getGroup(id);
        const canBan = targetRole && targetRole !== 'admin' && String(group?.createdBy) !== String(msg.senderId);
        const creatorBansAdmin = targetRole === 'admin'
          && group && String(group.createdBy) === String(partnerId);
        if (canBan || creatorBansAdmin) {
          await this.groups.banMember(id, String(msg.senderId), partnerId, 'Removed by admin verdict').catch(() => null);
        }
      }
    }
    return { reportId: String(reportId), decision };
  }
}

/** Edit your own message (marks editedAt). */
export class EditGroupMessageUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, messageId, body }) {
    const id = cleanId(groupId, 'group');
    const mid = cleanId(messageId, 'message');
    await requireMember(this.groups, id, partnerId);
    const msg = await this.groups.findGroupMessage(mid);
    if (!msg || String(msg.groupId) !== String(id)) throw new NotFoundException('Message not found in this group');
    if (String(msg.senderId) !== String(partnerId)) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    const text = String(body ?? '').trim();
    if (!text || text.length > 2000) throw new ValidationException('Message must be 1–2000 characters');
    return withId(await this.groups.editGroupMessage(mid, text));
  }
}

/** Delete your own message; admins may delete any message in the group. */
export class DeleteGroupMessageUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, messageId }) {
    const id = cleanId(groupId, 'group');
    const mid = cleanId(messageId, 'message');
    await requireMember(this.groups, id, partnerId);
    const msg = await this.groups.findGroupMessage(mid);
    if (!msg || String(msg.groupId) !== String(id)) throw new NotFoundException('Message not found in this group');
    const role = await this.groups.memberRole(id, partnerId).catch(() => null);
    if (String(msg.senderId) !== String(partnerId) && role !== 'admin') {
      throw new ForbiddenException('Only the author or a group admin can delete this message');
    }
    await this.groups.deleteGroupMessage(mid);
    return { deleted: true };
  }
}

/** Send to a group (members only; banned/outside users never reach here). */
export class SendGroupMessageUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, body, attachments = [] }) {
    const id = cleanId(groupId, 'group');
    await requireMember(this.groups, id, partnerId);
    const text = String(body ?? '').trim();
    let files = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      if (attachments.length > MAX_ATTACHMENTS) {
        throw new ValidationException(`At most ${MAX_ATTACHMENTS} attachments per message`);
      }
      const { createAttachmentEntities } = await import('../../community/domain/Post.entity.js');
      files = createAttachmentEntities(attachments);
    }
    if (text.length > 2000) throw new ValidationException('Message must be 1–2000 characters');
    if (!text && files.length === 0) throw new ValidationException('Message must have text or an attachment');
    return withId(await this.groups.createGroupMessage({ groupId: id, senderId: partnerId, body: text, attachments: files }));
  }
}

/** Paged group thread (newest-first window, chronological return).
 * Each message carries `seenBy` — member ids (excluding the sender) whose
 * read watermark has passed it. */
export class GroupThreadUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId, limit = 50, before = null }) {
    const id = cleanId(groupId, 'group');
    await requireMember(this.groups, id, partnerId);
    const [rows, states] = await Promise.all([
      this.groups.thread(id, { limit, before }),
      this.groups.readStates(id).catch(() => []),
    ]);
    const seenBy = (m) => {
      const at = new Date(m.createdAt ?? 0).getTime();
      return (states ?? [])
        .filter((s) => String(s.partnerId) !== String(m.senderId)
          && s.lastReadAt && new Date(s.lastReadAt).getTime() >= at)
        .map((s) => String(s.partnerId));
    };
    return (rows ?? []).map((m) => ({ ...m, seenBy: seenBy(m) }));
  }
}

/** Mark a group read up to now (drives per-group unread counts). */
export class MarkGroupReadUseCase {
  constructor({ groups }) {
    this.groups = groups;
  }

  async execute({ partnerId, groupId }) {
    const id = cleanId(groupId, 'group');
    await requireMember(this.groups, id, partnerId);
    await this.groups.updateRead(id, partnerId, new Date());
    return { read: true };
  }
}
