import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { validate } from '../../../shared/http/validate.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { NotFoundException } from '../../../shared/domain/AppError.js';
import { recordAudit } from '../../audit/index.js';
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';
import { TeamModel } from '../../../apps/teams/models/teams.model.js';
import { EmailSubscriptionModel } from '../../../apps/email-subscription/models/email-subscription.model.js';
import { GoalModel } from '../../goals/infrastructure/Goals.mongo.repository.js';
import { TutorialModel } from '../../tutorials/infrastructure/Tutorial.mongo.js';
import { EventModel } from '../../events/infrastructure/Events.mongo.repository.js';
import { PostModel } from '../../community/infrastructure/Community.mongo.repository.js';

const ENTITIES = Object.freeze({
  prospects: {
    model: ProspectModel,
    fields: ['prospectName', 'prospectSurname', 'prospectPhone'],
    label: 'prospect',
  },
  goals: {
    model: GoalModel,
    fields: ['title', 'kind'],
    label: 'goal',
  },
  tutorials: {
    model: TutorialModel,
    fields: ['title', 'area'],
    label: 'tutorial',
  },
  events: {
    model: EventModel,
    fields: ['title', 'location'],
    label: 'event',
  },
  'community-posts': {
    model: PostModel,
    fields: ['title', 'kind', 'body'],
    label: 'community post',
  },
  teams: {
    model: TeamModel,
    fields: ['teamName', 'teamPurpose'],
    label: 'team',
  },
  subscriptions: {
    model: EmailSubscriptionModel,
    fields: ['email', 'status'],
    label: 'subscription',
  },
});

const ENTITY_KEYS = Object.keys(ENTITIES);
const EntityParam = z.object({ entity: z.enum(ENTITY_KEYS) });
const RestoreParam = z.object({
  entity: z.enum(ENTITY_KEYS),
  id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
});
const ListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

const summaryOf = (row, fields) => fields
  .map((field) => String(row?.[field] ?? '').trim())
  .filter(Boolean)
  .join(' · ')
  .slice(0, 220) || 'Untitled record';

const shape = (row, entity) => ({
  id: String(row._id),
  entity,
  label: ENTITIES[entity].label,
  summary: summaryOf(row, ENTITIES[entity].fields),
  deletedAt: row.deletedAt ?? null,
  deletedBy: row.deletedBy ?? null,
  createdAt: row.createdAt ?? null,
});

export const buildRecycleBinRouter = (deps = {}) => {
  const audit = deps.audit ?? recordAudit;
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get(
    '/:entity',
    validate({ params: EntityParam, query: ListQuery }),
    asyncHandler(async (req, res) => {
      const { entity } = req.validated.params;
      const { q, limit, skip } = req.validated.query;
      const { model, fields } = ENTITIES[entity];
      const filter = { deletedAt: { $ne: null } };
      if (q) {
        const escaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        filter.$or = fields.map((field) => ({ [field]: rx }));
      }
      const [rows, total] = await Promise.all([
        model.find(filter, null, { withDeleted: true })
          .sort({ deletedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        model.countDocuments(filter, { withDeleted: true }),
      ]);
      return sendSuccess(res, {
        data: rows.map((row) => shape(row, entity)),
        meta: {
          entity,
          total,
          limit,
          skip,
          hasMore: skip + rows.length < total,
          next_action: skip + rows.length < total ? 'load_more' : null,
        },
      });
    }),
  );

  router.post(
    '/:entity/:id/restore',
    validate({ params: RestoreParam }),
    asyncHandler(async (req, res) => {
      const { entity, id } = req.validated.params;
      const { model, label } = ENTITIES[entity];
      const result = await model.updateOne(
        { _id: id, deletedAt: { $ne: null } },
        { $set: { deletedAt: null, deletedBy: null } },
      );
      if (!result.modifiedCount) throw new NotFoundException(`Deleted ${label} not found`);
      void audit({
        actorId: req.auth?.partnerId,
        action: 'content.restore',
        targetType: entity,
        targetId: id,
        detail: { restored: true, requestId: req.id },
      });
      return sendSuccess(res, {
        message: `${label[0].toUpperCase()}${label.slice(1)} restored`,
        data: { id, entity, restored: true },
      });
    }),
  );

  return router;
};

export default buildRecycleBinRouter();
