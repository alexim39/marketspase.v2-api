import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { recordAudit } from '../../audit/index.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { StoreAdminRepository } from '../infrastructure/StoreAdmin.mongo.repository.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const StoreListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['draft', 'published', 'suspended']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

const StoreParams = z.object({ storeId: objectId });

const StoreStatusBody = z.object({
  status: z.enum(['draft', 'published', 'suspended']),
  reason: z.string().trim().max(500).optional().default(''),
});

const OrderListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum([
    'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
  ]).optional(),
  storeId: objectId.optional(),
  partnerId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

const OrderParams = z.object({ orderId: objectId });

const RefundBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

const ReturnListQuery = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

const ReturnParams = z.object({ returnId: objectId });

const ReturnRefundBody = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
  adminNote: z.string().trim().max(1000).optional().default(''),
});

const StoreSettingsBody = z.object({
  serviceFeePercent: z.coerce.number().min(0).max(20),
  escrowHoldDays: z.coerce.number().int().min(0).max(60),
  autoDeliverDays: z.coerce.number().int().min(0).max(60).optional(),
  returnWindowDays: z.coerce.number().int().min(0).max(60).optional(),
});

export const buildAdminStoreRouter = (deps = {}) => {
  const repo = deps.repo ?? new StoreAdminRepository();
  const auth = deps.auth ?? requireAuth;
  const role = deps.role ?? requireRole;
  const audit = deps.audit ?? recordAudit;
  const router = express.Router();

  router.use(auth, role('admin'));

  router.get(
    '/stores',
    validate({ query: StoreListQuery }),
    asyncHandler(async (req, res) => {
      const data = await repo.listStores(req.validated.query);
      return sendSuccess(res, { data });
    }),
  );

  router.get(
    '/stores/:storeId',
    validate({ params: StoreParams }),
    asyncHandler(async (req, res) => {
      const data = await repo.getStore(req.validated.params.storeId);
      return sendSuccess(res, { data });
    }),
  );

  router.patch(
    '/stores/:storeId/status',
    validate({ params: StoreParams, body: StoreStatusBody }),
    asyncHandler(async (req, res) => {
      const data = await repo.setStoreStatus(
        req.validated.params.storeId,
        req.validated.body,
      );
      void audit({
        actorId: req.auth.partnerId,
        action: 'admin.store.status',
        targetType: 'store',
        targetId: req.validated.params.storeId,
        detail: { status: req.validated.body.status, reason: req.validated.body.reason },
      });
      return sendSuccess(res, { message: 'Store status updated', data });
    }),
  );

  router.get(
    '/store-orders',
    validate({ query: OrderListQuery }),
    asyncHandler(async (req, res) => {
      const data = await repo.listOrders(req.validated.query);
      return sendSuccess(res, { data });
    }),
  );

  router.get(
    '/store-orders/:orderId',
    validate({ params: OrderParams }),
    asyncHandler(async (req, res) => {
      const data = await repo.getOrder(req.validated.params.orderId);
      return sendSuccess(res, { data });
    }),
  );

  router.post(
    '/store-orders/:orderId/release-escrow',
    validate({ params: OrderParams }),
    asyncHandler(async (req, res) => {
      const data = await repo.releaseEscrow(req.validated.params.orderId);
      void audit({
        actorId: req.auth.partnerId,
        action: 'admin.store-order.escrow.release',
        targetType: 'store-order',
        targetId: req.validated.params.orderId,
        detail: { orderNumber: data.orderNumber, total: data.amounts?.total },
      });
      return sendSuccess(res, { message: 'Escrow released to partner wallet', data });
    }),
  );

  router.post(
    '/store-orders/:orderId/refund',
    validate({ params: OrderParams, body: RefundBody }),
    asyncHandler(async (req, res) => {
      const data = await repo.refundOrder(req.validated.params.orderId, req.validated.body);
      void audit({
        actorId: req.auth.partnerId,
        action: 'admin.store-order.refund',
        targetType: 'store-order',
        targetId: req.validated.params.orderId,
        detail: {
          orderNumber: data.orderNumber,
          total: data.amounts?.total,
          reason: req.validated.body.reason,
        },
      });
      return sendSuccess(res, { message: 'Order refunded to the customer', data });
    }),
  );

  router.get(
    '/store-settlements',
    asyncHandler(async (_req, res) => {      const data = await repo.settlements();
      return sendSuccess(res, { data });
    }),
  );

  router.get(
    '/store-returns',
    validate({ query: ReturnListQuery }),
    asyncHandler(async (req, res) => {
      const data = await repo.listReturns(req.validated.query);
      return sendSuccess(res, { data });
    }),
  );

  router.post(
    '/store-returns/:returnId/refund',
    validate({ params: ReturnParams, body: ReturnRefundBody }),
    asyncHandler(async (req, res) => {
      const data = await repo.refundReturn(req.validated.params.returnId, req.validated.body);
      void audit({
        actorId: req.auth.partnerId,
        action: 'admin.store-return.refund',
        targetType: 'store-return',
        targetId: req.validated.params.returnId,
        detail: { status: data.status, refundReference: data.refundReference ?? null },
      });
      return sendSuccess(res, { message: 'Return refunded', data });
    }),
  );

  router.get(
    '/settings/store',
    asyncHandler(async (_req, res) => {
      const data = await repo.settings();
      return sendSuccess(res, { data });
    }),
  );

  router.put(
    '/settings/store',
    validate({ body: StoreSettingsBody }),
    asyncHandler(async (req, res) => {
      const data = await repo.updateSettings(req.validated.body);
      void audit({
        actorId: req.auth.partnerId,
        action: 'admin.store.settings.update',
        targetType: 'platform-setting',
        targetId: 'store',
        detail: data,
      });
      return sendSuccess(res, { message: 'Store settings updated', data });
    }),
  );

  return router;
};

export default buildAdminStoreRouter();
