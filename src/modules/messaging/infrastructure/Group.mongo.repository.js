import {
  ChatGroupModel, GroupBanModel, GroupJoinRequestModel, GroupMemberModel,
  GroupMessageModel, GroupReportModel,
} from './Group.schema.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const oid = (v) => String(v);
const shaped = (o) => {
  if (!o) return null;
  const out = { ...o, id: oid(o._id) };
  delete out._id;
  delete out.__v;
  return out;
};

const safeMember = (d) => ({
  id: oid(d._id),
  username: d.username,
  name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
  photo: d.profileImage ?? null,
  lastSeenAt: d.lastSeenAt ?? null,
});

/** Group chat persistence — lean reads, atomic membership writes. */
export class MongoGroupStore {
  /** Group ids the partner belongs to (socket rooms join these on connect). */
  async memberGroups(partnerId) {
    const rows = await GroupMemberModel.find({ partnerId }).select('groupId').lean().catch(() => []);
    return (rows ?? []).map((r) => String(r.groupId));
  }

  async isMember(groupId, partnerId) {
    return (await GroupMemberModel.findOne({ groupId, partnerId }).lean().catch(() => null)) !== null;
  }

  async memberRole(groupId, partnerId) {
    const m = await GroupMemberModel.findOne({ groupId, partnerId }).select('role').lean().catch(() => null);
    return m?.role ?? null;
  }

  async isBanned(groupId, partnerId) {
    return (await GroupBanModel.findOne({ groupId, partnerId }).lean().catch(() => null)) !== null;
  }

  async memberCount(groupId) {
    return GroupMemberModel.countDocuments({ groupId }).catch(() => 0);
  }

  async createGroup({ name, description = '', photo = null, joinPolicy = 'approval', createdBy, teamId = null }) {
    const group = await ChatGroupModel.create({
      name, description, photo, joinPolicy, createdBy,
      ...(teamId ? { teamId } : {}),
    });
    await GroupMemberModel.create({
      groupId: group._id, partnerId: createdBy, role: 'admin', lastReadAt: new Date(),
    }).catch(() => null);
    return shaped(group.toObject());
  }

  async getGroup(id) {
    const doc = await ChatGroupModel.findById(id).lean().catch(() => null);
    return doc ? shaped(doc) : null;
  }

  /** Purpose-team bridge lookup (one group per team). */
  async findByTeamId(teamId) {
    const doc = await ChatGroupModel.findOne({ teamId }).lean().catch(() => null);
    return doc ? shaped(doc) : null;
  }

  async updateGroup(id, patch) {
    const doc = await ChatGroupModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean().catch(() => null);
    return doc ? shaped(doc) : null;
  }

  async deleteGroupCascade(id) {
    await Promise.all([
      ChatGroupModel.deleteOne({ _id: id }).catch(() => null),
      GroupMemberModel.deleteMany({ groupId: id }).catch(() => null),
      GroupBanModel.deleteMany({ groupId: id }).catch(() => null),
      GroupMessageModel.deleteMany({ groupId: id }).catch(() => null),
      GroupJoinRequestModel.deleteMany({ groupId: id }).catch(() => null),
      GroupReportModel.deleteMany({ groupId: id }).catch(() => null),
    ]);
    return { deleted: true };
  }

  async addMember(groupId, partnerId, role = 'member') {
    try {
      await GroupMemberModel.create({ groupId, partnerId, role });
      return true;
    } catch {
      return false;
    }
  }

  async removeMember(groupId, partnerId) {
    await GroupMemberModel.deleteOne({ groupId, partnerId }).catch(() => null);
    return true;
  }

  async setAdmin(groupId, partnerId, isAdmin) {
    await GroupMemberModel.updateOne({ groupId, partnerId }, { $set: { role: isAdmin ? 'admin' : 'member' } }).catch(() => null);
    return true;
  }

  async setMuted(groupId, partnerId, muted) {
    await GroupMemberModel.updateOne({ groupId, partnerId }, { $set: { muted: !!muted } }).catch(() => null);
    return true;
  }

  async updateRead(groupId, partnerId, at = new Date()) {
    await GroupMemberModel.updateOne({ groupId, partnerId }, { $set: { lastReadAt: at } }).catch(() => null);
    return true;
  }

  async oldestMember(groupId, excludeIds = []) {
    return GroupMemberModel.findOne({ groupId, partnerId: { $nin: excludeIds.map(String) } })
      .sort({ joinedAt: 1 }).lean().catch(() => null);
  }

  async banMember(groupId, partnerId, by, reason = '') {
    await this.removeMember(groupId, partnerId);
    try {
      await GroupBanModel.create({ groupId, partnerId, by, reason: String(reason ?? '').slice(0, 300) });
    } catch { /* already banned */ }
    return true;
  }

  async unbanMember(groupId, partnerId) {
    await GroupBanModel.deleteOne({ groupId, partnerId }).catch(() => null);
    return true;
  }

  /** Banned roster for the admin panel (with names so unbans are deliberate). */
  async listBans(groupId) {
    const bans = await GroupBanModel.find({ groupId }).sort({ createdAt: -1 }).lean().catch(() => []);
    const ids = [...new Set((bans ?? []).map((b) => String(b.partnerId)))];
    let byId = {};
    if (ids.length > 0) {
      const docs = await PartnersModel.find({ _id: { $in: ids } })
        .select('username name surname profileImage').lean().catch(() => []);
      byId = Object.fromEntries((docs ?? []).map((d) => [String(d._id), {
        username: d.username,
        name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
        photo: d.profileImage ?? null,
      }]));
    }
    return (bans ?? []).map((b) => ({
      partnerId: String(b.partnerId),
      reason: b.reason ?? '',
      createdAt: b.createdAt ?? null,
      ...(byId[String(b.partnerId)] ?? { username: null, name: 'Former member', photo: null }),
    }));
  }

  async requestJoin(groupId, partnerId) {
    try {
      await GroupJoinRequestModel.create({ groupId, partnerId, status: 'pending' });
      return { created: true };
    } catch {
      return { created: false };
    }
  }

  async findRequest(groupId, partnerId) {
    return GroupJoinRequestModel.findOne({ groupId, partnerId, status: 'pending' }).lean().catch(() => null);
  }

  async findRequestById(id) {
    const doc = await GroupJoinRequestModel.findById(id).lean().catch(() => null);
    return doc ? { ...doc, id: String(doc._id) } : null;
  }

  /** Public directory search — safe fields only, never the roster. */
  async searchGroups(query, { limit = 20 } = {}) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const docs = await ChatGroupModel.find({ $or: [{ name: rx }, { description: rx }] })
      .sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 20, 1), 25)).lean().catch(() => []);
    const out = [];
    for (const d of docs ?? []) {
      const memberCount = await GroupMemberModel.countDocuments({ groupId: d._id }).catch(() => 0);
      out.push({
        id: String(d._id),
        name: d.name,
        description: d.description ?? '',
        photo: d.photo ?? null,
        joinPolicy: d.joinPolicy ?? 'approval',
        memberCount,
        createdAt: d.createdAt ?? null,
      });
    }
    return out;
  }

  async findAnyRequest(groupId, partnerId) {
    return GroupJoinRequestModel.findOne({ groupId, partnerId }).sort({ createdAt: -1 }).lean().catch(() => null);
  }

  async reopenRequest(id) {
    return GroupJoinRequestModel.findOneAndUpdate(
      { _id: id },
      { $set: { status: 'pending', decidedBy: null, decidedAt: null } },
      { new: true },
    ).lean().catch(() => null);
  }

  async listRequests(groupId) {
    return GroupJoinRequestModel.find({ groupId, status: 'pending' }).sort({ createdAt: 1 }).lean().catch(() => []);
  }

  async decideRequest(requestId, { decision, decidedBy }) {
    const next = decision === 'approve' ? 'approved' : 'rejected';
    const doc = await GroupJoinRequestModel.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      { $set: { status: next, decidedBy, decidedAt: new Date() } },
      { new: true },
    ).lean().catch(() => null);
    return doc;
  }

  async reportMessage({ groupId, messageId, reporterId, reason }) {
    try {
      await GroupReportModel.create({ groupId, messageId, reporterId, reason: String(reason ?? '').slice(0, 300) });
      return { created: true };
    } catch {
      return { created: false };
    }
  }

  async listReports(groupId) {
    return GroupReportModel.find({ groupId, status: 'pending' }).sort({ createdAt: -1 }).lean().catch(() => []);
  }

  async findReportById(id) {
    const doc = await GroupReportModel.findById(id).lean().catch(() => null);
    return doc ?? null;
  }

  async decideReport(reportId, { decision, decidedBy }) {
    const next = decision === 'remove' ? 'removed' : 'dismissed';
    const doc = await GroupReportModel.findOneAndUpdate(
      { _id: reportId, status: 'pending' },
      { $set: { status: next, decidedBy, decidedAt: new Date() } },
      { new: true },
    ).lean().catch(() => null);
    return doc;
  }

  async createGroupMessage({ groupId, senderId, body, attachments = [] }) {
    const doc = await GroupMessageModel.create({ groupId, senderId, body, attachments });
    return shaped(doc.toObject());
  }

  async findGroupMessage(id) {
    const doc = await GroupMessageModel.findById(id).lean().catch(() => null);
    return doc ? shaped(doc) : null;
  }

  async editGroupMessage(id, body) {
    const doc = await GroupMessageModel.findByIdAndUpdate(
      id, { $set: { body, editedAt: new Date() } }, { new: true },
    ).lean().catch(() => null);
    return doc ? shaped(doc) : null;
  }

  async deleteGroupMessage(id) {
    await GroupMessageModel.deleteOne({ _id: id }).catch(() => null);
    return true;
  }

  async thread(groupId, { limit = 50, before = null } = {}) {
    const filter = { groupId };
    if (before) {
      const at = new Date(before);
      if (!Number.isNaN(at.getTime())) filter.createdAt = { $lt: at };
    }
    const docs = await GroupMessageModel.find(filter)
      .sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 100)).lean().catch(() => []);
    return docs.map(shaped).reverse();
  }

  /** Partner's groups with member count, my role/mute/read, unread + last message. */
  async listMine(partnerId) {
    const memberships = await GroupMemberModel.find({ partnerId }).lean().catch(() => []);
    const ids = (memberships ?? []).map((m) => m.groupId);
    if (ids.length === 0) return [];
    const [groups, memberCounts, lasts, unreads] = await Promise.all([
      ChatGroupModel.find({ _id: { $in: ids } }).lean().catch(() => []),
      GroupMemberModel.aggregate([
        { $match: { groupId: { $in: ids } } },
        { $group: { _id: '$groupId', count: { $sum: 1 } } },
      ]).catch(() => []),
      GroupMessageModel.aggregate([
        { $match: { groupId: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$groupId', last: { $first: '$$ROOT' } } },
      ]).catch(() => []),
      (async () => {
        const out = {};
        await Promise.all((memberships ?? []).map(async (m) => {
          const q = { groupId: m.groupId, senderId: { $ne: partnerId } };
          if (m.lastReadAt) q.createdAt = { $gt: m.lastReadAt };
          out[String(m.groupId)] = await GroupMessageModel.countDocuments(q).catch(() => 0);
        }));
        return out;
      })(),
    ]);
    const byId = Object.fromEntries((groups ?? []).map((g) => [String(g._id), g]));
    const memberCountsById = Object.fromEntries((memberCounts ?? []).map((c) => [String(c._id), c.count]));
    const lastsById = Object.fromEntries((lasts ?? []).map((l) => [String(l._id), shaped(l.last)]));
    const memById = Object.fromEntries((memberships ?? []).map((m) => [String(m.groupId), m]));
    const senderIds = [...new Set(Object.values(lastsById).map((m) => String(m.senderId)).filter(Boolean))];
    let labels = {};
    if (senderIds.length > 0) {
      const docs = await PartnersModel.find({ _id: { $in: senderIds } }).select('name surname username').lean().catch(() => []);
      labels = Object.fromEntries((docs ?? []).map((d) => [String(d._id), [d.name, d.surname].filter(Boolean).join(' ') || d.username]));
    }
    return (groups ?? []).map((g) => {
      const gid = String(g._id);
      const mem = memById[gid] ?? {};
      const last = lastsById[gid] ?? null;
      return {
        ...shaped(g),
        memberCount: memberCountsById[gid] ?? 0,
        unread: unreads[gid] ?? 0,
        myRole: mem.role ?? 'member',
        muted: !!mem.muted,
        lastMessage: last ? { ...last, senderName: labels[String(last.senderId)] ?? null } : null,
      };
    });
  }

  /** Public directory search — safe fields only, no rosters (anti-harvest). */
  async search(q, { limit = 20 } = {}) {
    const query = String(q ?? '').trim();
    if (query.length < 2) return [];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const docs = await ChatGroupModel.find({ $or: [{ name: rx }, { description: rx }] })
      .sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 20, 1), 25)).lean().catch(() => []);
    const memberCounts = await Promise.all(
      (docs ?? []).map(async (d) => [String(d._id), await GroupMemberModel.countDocuments({ groupId: d._id }).catch(() => 0)]),
    );
    const byId = Object.fromEntries(memberCounts);
    return (docs ?? []).map((d) => ({
      id: String(d._id),
      name: d.name,
      description: d.description ?? '',
      photo: d.photo ?? null,
      joinPolicy: d.joinPolicy ?? 'approval',
      memberCount: byId[String(d._id)] ?? 0,
      createdAt: d.createdAt ?? null,
    }));
  }

  /** Members with safe profile fields for the info panel. */
  async membersWithProfiles(groupId) {
    const members = await GroupMemberModel.find({ groupId }).sort({ joinedAt: 1 }).lean().catch(() => []);
    const ids = [...new Set((members ?? []).map((m) => String(m.partnerId)))];
    let docs = [];
    if (ids.length > 0) {
      docs = await PartnersModel.find({ _id: { $in: ids } })
        .select('username name surname profileImage lastSeenAt').lean().catch(() => []);
    }
    const byId = Object.fromEntries((docs ?? []).map((d) => [String(d._id), d]));
    return (members ?? []).map((m) => {
      const p = byId[String(m.partnerId)] ?? null;
      return {
        id: String(m.partnerId),
        username: p?.username ?? null,
        name: p ? ([p.name, p.surname].filter(Boolean).join(' ') || p.username) : 'Member',
        photo: p?.profileImage ?? null,
        lastSeenAt: p?.lastSeenAt ?? null,
        role: m.role ?? 'member',
        muted: !!m.muted,
        joinedAt: m.joinedAt ?? m.createdAt ?? null,
      };
    });
  }

  /** Unmuted members for push fan-out (sender excluded by caller). */
  async notifyTargets(groupId, excludeId = null) {
    const rows = await GroupMemberModel.find({ groupId, muted: { $ne: true } }).select('partnerId').lean().catch(() => []);
    return (rows ?? []).map((r) => String(r.partnerId)).filter((id) => id && id !== String(excludeId ?? ''));
  }

  /** Per-member read watermarks for seen-by ticks. */
  async readStates(groupId) {
    const rows = await GroupMemberModel.find({ groupId }).select('partnerId lastReadAt').lean().catch(() => []);
    return (rows ?? []).map((r) => ({ partnerId: String(r.partnerId), lastReadAt: r.lastReadAt ?? null }));
  }

  /** Team rename propagation — specs come from the pure, unit-tested planner;
   * this just executes them, so deliberate group branding survives team edits. */
  async syncTeamProfile(teamId, { name, description }, { oldName, oldDescription }) {
    const { teamGroupSyncUpdates } = await import('../domain/GroupTeamSync.js');
    const ops = teamGroupSyncUpdates(
      { teamName: oldName, description: oldDescription },
      { teamName: name, description },
    );
    await Promise.all(ops.map((op) => ChatGroupModel.updateMany(
      { teamId, ...op.filter },
      { $set: op.update },
    ).catch(() => null)));
    return true;
  }

  /** Admin ids for admin-only notices (join approvals, reported messages). */
  async listAdminIds(groupId) {
    const rows = await GroupMemberModel.find({ groupId, role: 'admin' }).select('partnerId').lean().catch(() => []);
    return (rows ?? []).map((r) => String(r.partnerId)).filter(Boolean);
  }
}
