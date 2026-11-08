import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { normalizeLevel } from '../../progression/domain/Progression.levels.js';
import {
  RANK_GROUP_CONFIG,
  RANK_GROUP_RANKS,
  rankForLevel,
} from '../domain/RankGroups.js';

const ADMIN_ROLES = ['admin', 'Admin', 'ADMIN'];
const ENSURE_TTL_MS = 5 * 60 * 1000;

/**
 * Owns the official journey-level groups.
 *
 * The persisted progression level is the source of truth. Promotion events
 * trigger an immediate move; opening Messages and the daily reconciliation
 * job repair drift, including demotions. Group admins are system admins and
 * stay in every rank group as moderators.
 */
export class RankGroupService {
  constructor({
    groups,
    progress,
    partners = PartnersModel,
    listAdminIds = null,
    onChanged = null,
    logger = console,
  } = {}) {
    Object.assign(this, { groups, progress, partners, logger, onChanged });
    this.listAdminIds = listAdminIds ?? (() => this.defaultAdminIds());
    this.ensuredAt = 0;
    this.ensuring = null;
  }

  async ensureGroups() {
    if (Date.now() - this.ensuredAt < ENSURE_TTL_MS) return { ready: true, cached: true };
    if (this.ensuring) return this.ensuring;
    this.ensuring = this.seedGroups().finally(() => { this.ensuring = null; });
    return this.ensuring;
  }

  async seedGroups() {
    const adminIds = [...new Set((await this.listAdminIds().catch(() => [])).map(String).filter(Boolean))];
    if (adminIds.length === 0) {
      this.logger?.warn?.('rank_groups_no_admin', { reason: 'No system admin account found' });
      return { ready: false, reason: 'no-admin', created: 0 };
    }

    const owner = adminIds[0];
    let created = 0;

    for (const rank of RANK_GROUP_RANKS) {
      const config = RANK_GROUP_CONFIG[rank];
      let group = await this.groups.findByRankGroup(rank);
      if (!group) {
        try {
          group = await this.groups.createGroup({
            name: config.name,
            description: config.description,
            joinPolicy: 'approval',
            createdBy: owner,
            rankGroup: rank,
          });
          created += 1;
        } catch (error) {
          // A unique-rank race is expected; anything else is surfaced so the
          // admin desk can show the group as not ready instead of hiding it.
          this.logger?.warn?.('rank_group_seed_failed', {
            rank,
            error: error?.message ?? String(error),
          });
          group = await this.groups.findByRankGroup(rank);
        }
      }
      if (!group) continue;
      if (
        group.name !== config.name
        || group.description !== config.description
        || group.joinPolicy !== 'approval'
      ) {
        const updated = await this.groups.updateGroup(group.id, {
          name: config.name,
          description: config.description,
          joinPolicy: 'approval',
        });
        if (updated) group = updated;
      }

      for (const adminId of adminIds) {
        const isMember = await this.groups.isMember(group.id, adminId).catch(() => false);
        if (!isMember) {
          await this.groups.addMember(group.id, adminId, 'admin').catch(() => null);
        } else {
          const role = await this.groups.memberRole(group.id, adminId).catch(() => null);
          if (role !== 'admin') await this.groups.setAdmin(group.id, adminId, true).catch(() => null);
        }
      }

      if (!group.pinnedMessageId) {
        const message = await this.groups.createGroupMessage({
          groupId: group.id,
          senderId: owner,
          body: config.welcome,
        }).catch(() => null);
        const messageId = message?.id ?? (message?._id ? String(message._id) : null);
        if (messageId) {
          await this.groups.updateGroup(group.id, { pinnedMessageId: messageId }).catch(() => null);
        }
      }
    }

    this.ensuredAt = Date.now();
    return { ready: true, created, total: RANK_GROUP_RANKS.length };
  }

  /** Add the partner to their current level group and remove older rank groups. */
  async syncPartner(partnerId) {
    const ready = await this.ensureGroups().catch(() => null);
    if (!ready?.ready) return { synced: false, reason: ready?.reason ?? 'not-ready' };

    const progress = await this.progress.findByPartner(partnerId).catch(() => null);
    const level = normalizeLevel(progress?.level ?? 'partner');
    const rank = rankForLevel(level);
    const rankGroups = await this.groups.listRankGroups();
    let groupId = null;
    let groupName = null;
    let fromGroupId = null;
    let fromRank = null;
    let joined = false;
    let removed = false;

    for (const group of rankGroups) {
      const isTarget = group.rankGroup === rank;
      if (isTarget) {
        groupId = group.id;
        groupName = group.name;
      }
      const isMember = await this.groups.isMember(group.id, partnerId).catch(() => false);

      if (isTarget) {
        const banned = await this.groups.isBanned(group.id, partnerId).catch(() => false);
        if (banned) {
          if (isMember) {
            await this.groups.removeMember(group.id, partnerId).catch(() => null);
            removed = true;
          }
        } else if (!isMember) {
          const added = await this.groups.addMember(group.id, partnerId).catch(() => false);
          if (added) joined = true;
        }
        continue;
      }

      if (!isMember) continue;
      const role = await this.groups.memberRole(group.id, partnerId).catch(() => null);
      // System admins moderate every rank group; never evict them.
      if (role !== 'admin') {
        fromGroupId = fromGroupId ?? group.id;
        fromRank = fromRank ?? group.rankGroup;
        await this.groups.removeMember(group.id, partnerId).catch(() => null);
        removed = true;
      }
    }

    if (joined && this.onChanged) {
      try {
        await this.onChanged({
          partnerId: String(partnerId),
          level,
          rank,
          groupId,
          groupName,
          fromGroupId,
          fromRank,
          at: new Date().toISOString(),
        });
      } catch { /* best-effort — membership already moved */ }
    }

    return { synced: true, level, rank, groupId, fromGroupId, joined, removed };
  }

  /** Daily repair sweep — catches demotions and any missed events. */
  async syncAll() {
    const ready = await this.ensureGroups().catch(() => null);
    if (!ready?.ready) return { synced: 0, skipped: 0, reason: ready?.reason ?? 'not-ready' };
    let synced = 0;
    let skipped = 0;
    const cursor = this.partners.find({}).select('_id').cursor();
    for await (const row of cursor) {
      const result = await this.syncPartner(row._id).catch(() => null);
      if (result?.synced) synced += 1;
      else skipped += 1;
    }
    return { synced, skipped };
  }

  async defaultAdminIds() {
    const rows = await this.partners.find({
      role: { $in: ADMIN_ROLES },
      $or: [{ suspendedAt: null }, { suspendedAt: { $exists: false } }],
    }).select('_id').limit(50).lean();
    return (rows ?? []).map((row) => String(row._id));
  }
}
