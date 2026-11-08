import express from 'express';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { MongoGroupStore } from '../infrastructure/Group.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { RankGroupService } from '../application/RankGroups.service.js';
import { RANK_GROUP_CONFIG, RANK_GROUP_RANKS } from '../domain/RankGroups.js';

/**
 * Admin desk for the four official journey-level groups.
 * The groups are system-managed; this surface reports their state, can
 * repair/seed them and exposes the partner Messages entry point for chat
 * moderation.
 */
export const buildAdminRankGroupsRouter = (deps = {}) => {
  const groups = deps.groups ?? new MongoGroupStore();
  const progress = deps.progress ?? new MongoProgressionStore();
  const rankGroups = deps.rankGroups ?? new RankGroupService({ groups, progress });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');

  const router = express.Router();
  router.use(auth, admin);

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

  return router;
};
