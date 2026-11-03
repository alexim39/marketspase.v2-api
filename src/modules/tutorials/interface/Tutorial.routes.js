import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { TUTORIAL_AREAS } from '../domain/Tutorial.youtube.js';
import {
  CreateTutorialUseCase, DeleteTutorialUseCase, ListAdminTutorialsUseCase,
  ListTutorialsUseCase, UpdateTutorialUseCase,
} from '../application/Tutorial.usecases.js';
import { recordAudit } from '../../audit/index.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const CreateSchema = z.object({
  url: z.string().trim().min(5).max(300),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional().default(''),
  area: z.enum(TUTORIAL_AREAS).optional().default('Start'),
  order: z.coerce.number().int().min(0).max(10000).optional().default(0),
  active: z.boolean().optional().default(true),
});
const UpdateSchema = z.object({
  url: z.string().trim().min(5).max(300).optional(),
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  area: z.enum(TUTORIAL_AREAS).optional(),
  order: z.coerce.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

/** Member routes — active tutorials grouped by area. */
export const buildTutorialRouter = (deps = {}) => {
  const list = deps.list ?? new ListTutorialsUseCase({});

  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const data = await list.execute();
    res.status(200).json({ message: 'Tutorials retrieved successfully', data, success: true });
  }));

  return router;
};

/** Admin routes — paste-a-link desk (create/list/update/delete). */
export const buildAdminTutorialRouter = (deps = {}) => {
  const list = deps.list ?? new ListAdminTutorialsUseCase({});
  const create = deps.create ?? new CreateTutorialUseCase({});
  const update = deps.update ?? new UpdateTutorialUseCase({});
  const remove = deps.remove ?? new DeleteTutorialUseCase({});

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', asyncHandler(async (req, res) => {
    const data = await list.execute({});
    res.status(200).json({ message: 'Tutorials retrieved successfully', data, success: true });
  }));

  router.post('/', validate({ body: CreateSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ adminId: req.auth?.partnerId, ...body });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'tutorial.create',
      targetType: 'tutorial', targetId: String(data.tutorial?.id ?? ''),
      detail: { title: data.tutorial?.title, area: data.tutorial?.area },
    });
    res.status(200).json({ message: 'Tutorial added successfully', data, success: true });
  }));

  router.patch('/:id', validate({ params: z.object({ id: objectId }), body: UpdateSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ tutorialId: params.id, patch: body });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'tutorial.update',
      targetType: 'tutorial', targetId: String(params.id),
      detail: body,
    });
    res.status(200).json({ message: 'Tutorial updated successfully', data, success: true });
  }));

  router.delete('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await remove.execute({ tutorialId: params.id });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'tutorial.delete',
      targetType: 'tutorial', targetId: String(params.id),
    });
    res.status(200).json({ message: 'Tutorial deleted successfully', data, success: true });
  }));

  return router;
};

export default buildTutorialRouter();
