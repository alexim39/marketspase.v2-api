import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { KIT_AREAS } from '../domain/Kit.js';
import {
  CreateKitUseCase, DeleteKitUseCase, ListAdminKitsUseCase,
  ListKitsUseCase, UpdateKitUseCase, KitStatsUseCase, KitAdminStatsUseCase,
} from '../application/Kit.usecases.js';
import { recordAudit } from '../../audit/index.js';
import { env } from '../../../shared/config/env.js';
import { buildImageStore, publicIdFromUrl } from '../../settings/infrastructure/CloudinaryClient.js';
import { kitUpload, assertPdfBuffer } from './Kit.upload.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const slideSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  imageUrl: z.string().trim().max(500).optional().default(''),
  note: z.string().trim().max(1000).optional().default(''),
});
const CreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional().default(''),
  area: z.enum(KIT_AREAS).optional().default('Opportunity'),
  source: z.enum(['manual', 'file']).optional().default('manual'),
  slides: z.array(slideSchema).min(1).max(30).optional(),
  fileUrl: z.string().trim().max(1000).optional().default(''),
  durationMin: z.coerce.number().int().min(1).max(120).optional().default(10),
  order: z.coerce.number().int().min(0).max(10000).optional().default(0),
  active: z.boolean().optional().default(true),
}).refine(
  (b) => (b.source === 'file' ? !!b.fileUrl : (b.slides?.length ?? 0) > 0),
  { message: 'File decks need fileUrl, manual decks need slides' },
);
const UpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  area: z.enum(KIT_AREAS).optional(),
  source: z.enum(['manual', 'file']).optional(),
  slides: z.array(slideSchema).min(1).max(30).optional(),
  fileUrl: z.string().trim().max(1000).optional(),
  durationMin: z.coerce.number().int().min(1).max(120).optional(),
  order: z.coerce.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

/** Member routes — active kits grouped by area. */
export const buildKitRouter = (deps = {}) => {
  const list = deps.list ?? new ListKitsUseCase({});
  const stats = deps.stats ?? new KitStatsUseCase({});

  const router = express.Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (req, res) => {
    const data = await list.execute();
    res.status(200).json({ message: 'Kits retrieved successfully', data, success: true });
  }));

  // Static segment first — otherwise 'stats' matches `/:id`.
  router.get('/stats/mine', asyncHandler(async (req, res) => {
    const data = await stats.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Kit stats retrieved successfully', data, success: true });
  }));

  router.get('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await list.execute();
    const kit = (data.groups ?? []).flatMap((g) => g.items).find((k) => k.id === params.id) ?? null;
    if (!kit) return res.status(404).json({ message: 'Kit not found', success: false });
    res.status(200).json({ message: 'Kit retrieved successfully', data: kit, success: true });
  }));

  return router;
};

/** Admin routes — kit desk (create/list/update/delete + PDF upload). */
export const buildAdminKitRouter = (deps = {}) => {
  const list = deps.list ?? new ListAdminKitsUseCase({});
  const create = deps.create ?? new CreateKitUseCase({});
  const update = deps.update ?? new UpdateKitUseCase({});
  const remove = deps.remove ?? new DeleteKitUseCase({});
  const statsAll = deps.statsAll ?? new KitAdminStatsUseCase({});
  // Deck PDFs ride the shared Cloudinary store (deploy-proof like profile/
  // community images) with PDF delivery — local disk is never a target.
  const decks = deps.decks ?? buildImageStore({
    ...(env.cloudinary ?? {}),
    folder: 'diamond-projects/decks',
    resourceType: 'auto',
    label: 'Deck',
  });

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/stats', asyncHandler(async (req, res) => {
    const data = await statsAll.execute();
    res.status(200).json({ message: 'Kit stats retrieved successfully', data, success: true });
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const data = await list.execute({});
    res.status(200).json({ message: 'Kits retrieved successfully', data, success: true });
  }));

  router.post('/', validate({ body: CreateSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ adminId: req.auth?.partnerId, ...body });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'kit.create',
      targetType: 'kit', targetId: String(data.kit?.id ?? ''),
      detail: { title: data.kit?.title, area: data.kit?.area },
    });
    res.status(200).json({ message: 'Kit added successfully', data, success: true });
  }));

  router.patch('/:id', validate({ params: z.object({ id: objectId }), body: UpdateSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ kitId: params.id, patch: body });
    const replaced = publicIdFromUrl(data.replacedFileUrl ?? null);
    if (replaced) {
      await decks.destroy(replaced, { resourceType: 'auto' }).catch(() => null);
    }
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'kit.update',
      targetType: 'kit', targetId: String(params.id),
      detail: body,
    });
    res.status(200).json({ message: 'Kit updated successfully', data, success: true });
  }));

  router.delete('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await remove.execute({ kitId: params.id });
    // Deck asset cleanup is best-effort — the row is already gone.
    const publicId = publicIdFromUrl(data.fileUrl ?? null);
    if (publicId) {
      await decks.destroy(publicId, { resourceType: 'auto' }).catch(() => null);
    }
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'kit.delete',
      targetType: 'kit', targetId: String(params.id),
    });
    res.status(200).json({ message: 'Kit deleted successfully', data, success: true });
  }));

  // Deck PDF upload — memory straight to Cloudinary; returns the fileUrl
  // the create/update calls then attach. Multer size errors map to 400.
  router.post('/upload', kitUpload.single('deck'), asyncHandler(async (req, res) => {
    assertPdfBuffer(req.file?.buffer);
    const data = await decks.upload(req.file.buffer, {
      publicId: `deck-${Date.now().toString(36)}`,
    });
    res.status(200).json({ message: 'Deck uploaded — attach its URL to a file deck.', data: { fileUrl: data.url }, success: true });
  }));

  return router;
};

export default buildKitRouter();
