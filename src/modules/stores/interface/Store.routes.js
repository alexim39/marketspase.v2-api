import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit, userKey } from '../../../shared/http/rateLimit.js';
import { mongoRateLimit } from '../../../shared/http/mongoRateLimit.js';
import { idempotency } from '../../../shared/http/idempotency.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { ValidationException } from '../../../shared/domain/AppError.js';
import { env } from '../../../shared/config/env.js';
import { recordAudit } from '../../audit/index.js';
import { buildImageStore } from '../../settings/infrastructure/CloudinaryClient.js';
import { StoreRepository } from '../infrastructure/Store.mongo.repository.js';
import { StoreOrderRepository } from '../infrastructure/StoreOrder.mongo.repository.js';
import { storeImageUpload } from './StoreImage.upload.js';
import {
  StoreListQuerySchema,
  StoreOrderCreateSchema,
  StoreOrderListQuerySchema,
  StoreOrderParamsSchema,
  StoreOrderReferenceSchema,
  StoreOrderUpdateSchema,
  StoreProductParamsSchema,
  StoreProductUpdateSchema,
  StorePublicProductParamsSchema,
  StoreSlugParamsSchema,
  StoreUpdateSchema,
} from './Store.validator.js';

export const buildStoreRouter = (deps = {}) => {
  const repo = deps.repo ?? new StoreRepository();
  const orderRepo = deps.orderRepo ?? new StoreOrderRepository();
  const images = deps.images ?? buildImageStore({
    ...(env.cloudinary ?? {}),
    folder: 'marketspase-stores',
    label: 'Store image',
  });
  const auth = deps.auth ?? requireAuth;
  const audit = deps.audit ?? recordAudit;
  const router = express.Router();
  const listingLimit = rateLimit({
    name: 'store-listing',
    windowMs: 3600000,
    max: 10,
    key: userKey,
  });
  const listingHourLimit = mongoRateLimit({
    name: 'store-listing',
    windowMs: 3600000,
    max: 10,
    key: userKey,
  });

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

  router.post(
    '/me/images',
    auth,
    storeImageUpload.single('image'),
    asyncHandler(async (req, res) => {
      const kind = String(req.body?.kind ?? '').trim().toLowerCase();
      if (!['logo', 'banner'].includes(kind)) {
        throw new ValidationException('Choose logo or banner for this image');
      }
      if (!req.file?.buffer) throw new ValidationException('Choose an image to upload');
      const stored = await images.upload(req.file.buffer, {
        publicId: `store-${req.auth.partnerId}-${kind}-${Date.now()}`,
      });
      return sendSuccess(res, {
        message: `${kind === 'logo' ? 'Logo' : 'Banner'} uploaded`,
        data: { url: stored.url, kind },
      });
    }),
  );

  router.get(
    '/me/orders',
    auth,
    validate({ query: StoreOrderListQuerySchema }),
    asyncHandler(async (req, res) => {
      const data = await orderRepo.listPartnerOrders(req.auth.partnerId, req.validated.query);
      return sendSuccess(res, { data });
    }),
  );

  router.get('/me/earnings', auth, asyncHandler(async (req, res) => {
    const data = await orderRepo.getPartnerEarnings(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.patch(
    '/me/orders/:orderId',
    auth,
    validate({ params: StoreOrderParamsSchema, body: StoreOrderUpdateSchema }),
    asyncHandler(async (req, res) => {
      const data = await orderRepo.updatePartnerOrder(
        req.auth.partnerId,
        req.validated.params.orderId,
        req.validated.body,
      );
      void audit({
        actorId: req.auth.partnerId,
        action: 'store.order.update',
        targetType: 'store-order',
        targetId: req.validated.params.orderId,
        detail: { status: data.status },
      });
      return sendSuccess(res, { message: `Order marked ${data.status}`, data });
    }),
  );

  router.get('/me/products', auth, asyncHandler(async (req, res) => {
    const data = await repo.listMyProducts(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.patch(
    '/me/products/:id',
    auth,
    listingLimit,
    listingHourLimit,
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
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return sendSuccess(res, { data: data.data, meta: data.meta });
    }),
  );

  router.post(
    '/payments/webhook',
    asyncHandler(async (req, res) => {
      try {
        const data = await orderRepo.handleWebhook({
          payload: req.body ?? {},
          rawBody: req.rawBody,
          signature: req.get('x-paystack-signature'),
        });
        return sendSuccess(res, { message: 'Webhook handled', data });
      } catch (error) {
        if (error?.code === 'BAD_SIGNATURE' || error?.code === 'AMOUNT_MISMATCH') {
          return res.status(400).json({ message: error.message, success: false, code: error.code });
        }
        throw error;
      }
    }),
  );

  router.post(
    '/:slug/orders',
    validate({ params: StoreSlugParamsSchema, body: StoreOrderCreateSchema }),
    idempotency(),
    asyncHandler(async (req, res) => {
      const data = await orderRepo.createOrder(req.validated.params.slug, req.validated.body);
      return sendSuccess(res, {
        message: 'Checkout opened — complete payment with Paystack',
        data,
        meta: {
          next_steps: {
            order_id: data.order?.id ?? null,
            order_number: data.order?.orderNumber ?? null,
            reference: data.order?.reference ?? null,
            action: 'complete_payment',
            checkout_url: data.checkoutUrl,
            escrow_status: 'not_funded',
          },
        },
      });
    }),
  );

  router.get(
    '/orders/:reference',
    validate({ params: StoreOrderReferenceSchema }),
    asyncHandler(async (req, res) => {
      const data = await orderRepo.getOrder(req.validated.params.reference);
      return sendSuccess(res, { data });
    }),
  );

  router.post(
    '/orders/:reference/verify',
    validate({ params: StoreOrderReferenceSchema }),
    asyncHandler(async (req, res) => {
      const data = await orderRepo.verifyOrder(req.validated.params.reference);
      return sendSuccess(res, { message: 'Payment status checked', data });
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
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return sendSuccess(res, { data });
    }),
  );

  router.get(
    '/:slug',
    validate({ params: StoreSlugParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await repo.getPublicStore(req.validated.params.slug);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return sendSuccess(res, { data });
    }),
  );

  return router;
};

export default buildStoreRouter();
