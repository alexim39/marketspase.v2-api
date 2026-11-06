import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { recordAudit } from '../../audit/index.js';
import { StoreRepository } from '../infrastructure/Store.mongo.repository.js';
import {
  StoreListQuerySchema,
  StoreOrderParamsSchema,
  StoreProductParamsSchema,
  StoreProductUpdateSchema,
  StorePublicProductParamsSchema,
  StoreSlugParamsSchema,
  StoreUpdateSchema,
} from './Store.validator.js';

export const buildStoreRouter = (deps = {}) => {
  const repo = deps.repo ?? new StoreRepository();
  const auth = deps.auth ?? requireAuth;
  const audit = deps.audit ?? recordAudit;
  const router = express.Router();

  // ── Partner-owned store management (must precede /:slug) ──────────────
  router.get('/me', auth, asyncHandler(async (req, res) => {
    const data = await repo.getMyStore(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.patch(
    '/me',
    auth,
    validate({ body: StoreUpdateSchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.updateMyStore(req.auth.partnerId, req.validated.body);
      void audit({
        actorId: req.auth.partnerId,
        action: 'store.update',
        targetType: 'store',
        targetId: data.id,
        detail: { status: data.status, autoPublish: data.autoPublish },
      });
      return sendSuccess(res, { message: 'Store updated', data });
    }),
  );

  router.get('/me/products', auth, asyncHandler(async (req, res) => {
    const data = await repo.listMyProducts(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.patch(
    '/me/products/:id',
    auth,
    validate({ params: StoreProductParamsSchema, body: StoreProductUpdateSchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.updateProduct(
        req.auth.partnerId,
        req.validated.params.id,
        req.validated.body,
      );
      void audit({
        actorId: req.auth.partnerId,
        action: 'store.product.update',
        targetType: 'store-product',
        targetId: data.id,
        detail: { status: data.status, retailPrice: data.retailPrice },
      });
      return sendSuccess(res, { message: 'Listing updated', data });
    }),
  );

  router.get('/me/receipts', auth, asyncHandler(async (req, res) => {
    const data = await repo.listReceipts(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.post(
    '/me/receipts/:orderId/confirm',
    auth,
    validate({ params: StoreOrderParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.confirmReceipt(req.auth.partnerId, req.validated.params.orderId);
      void audit({
        actorId: req.auth.partnerId,
        action: 'store.receipt.confirm',
        targetType: 'order',
        targetId: req.validated.params.orderId,
        detail: { credited: data.credited, listings: data.listings.length },
      });
      return sendSuccess(res, {
        message: `${data.credited} unit${data.credited === 1 ? '' : 's'} added to your store`,
        data,
      });
    }),
  );

  // ── Public storefront ─────────────────────────────────────────────────
  router.get(
    '/',
    validate({ query: StoreListQuerySchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.listPublicStores(req.validated.query);
      return sendSuccess(res, { data });
    }),
  );

  router.get(
    '/:slug/products/:productId',
    validate({ params: StorePublicProductParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.getPublicProduct(
        req.validated.params.slug,
        req.validated.params.productId,
      );
      return sendSuccess(res, { data });
    }),
  );

  router.get(
    '/:slug',
    validate({ params: StoreSlugParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.getPublicStore(req.validated.params.slug);
      return sendSuccess(res, { data });
    }),
  );

  return router;
};

export default buildStoreRouter();
