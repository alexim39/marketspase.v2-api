import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { ValidationException } from '../../../shared/domain/AppError.js';
import { MongoOnboardingRepository } from '../infrastructure/Onboarding.mongo.repository.js';
import {
  CreateActivationOrderUseCase,
  FulfillActivationOrderUseCase,
  GetOnboardingStatusUseCase,
  ListAdminActivationOrdersUseCase,
  ListKycSubmissionsUseCase,
  ListMyActivationOrdersUseCase,
  ListStarterProductsUseCase,
  RefundActivationOrderUseCase,
  RejectKycUseCase,
  SubmitKycUseCase,
  VerifyKycUseCase,
} from '../application/Onboarding.usecases.js';
import {
  CreateActivationOrderSchema,
  KycQuerySchema,
  OrderIdParamsSchema,
  OrderQuerySchema,
  PartnerIdParamsSchema,
  RefundOrderSchema,
  RejectKycSchema,
  SubmitKycSchema,
} from './Onboarding.validator.js';

const headerIdempotencyKey = (req) => {
  const raw = req.get('Idempotency-Key');
  if (!raw) return undefined;
  const key = String(raw).trim();
  if (key.length < 8 || key.length > 100) {
    throw new ValidationException('Idempotency-Key must be 8-100 characters');
  }
  return key;
};

export const buildOnboardingRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoOnboardingRepository();
  const getStatus = deps.getStatus ?? new GetOnboardingStatusUseCase({ repo });
  const listProducts = deps.listProducts ?? new ListStarterProductsUseCase({ repo });
  const submitKyc = deps.submitKyc ?? new SubmitKycUseCase({ repo });
  const createOrder = deps.createOrder ?? new CreateActivationOrderUseCase({
    repo,
    events: deps.events,
  });
  const listOrders = deps.listOrders ?? new ListMyActivationOrdersUseCase({ repo });
  const auth = deps.auth ?? requireAuth;

  const router = express.Router();
  router.use(auth);

  router.get('/status', asyncHandler(async (req, res) => {
    const data = await getStatus.execute(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.get('/products', asyncHandler(async (_req, res) => {
    const data = await listProducts.execute();
    return sendSuccess(res, { data });
  }));

  router.post('/kyc', validate({ body: SubmitKycSchema }), asyncHandler(async (req, res) => {
    const data = await submitKyc.execute(req.auth.partnerId, req.validated.body);
    return sendSuccess(res, { message: 'Identity verification submitted', data });
  }));

  router.post('/orders', validate({ body: CreateActivationOrderSchema }), asyncHandler(async (req, res) => {
    const body = req.validated.body;
    const data = await createOrder.execute({
      partnerId: req.auth.partnerId,
      productId: body.productId,
      shipping: body.shipping,
      idempotencyKey: body.idempotencyKey ?? headerIdempotencyKey(req),
    });
    return sendSuccess(res, {
      message: data.repeated ? 'Activation order already exists' : 'Partner account activated',
      data,
      statusCode: data.repeated ? 200 : 201,
    });
  }));

  router.get('/orders', asyncHandler(async (req, res) => {
    const data = await listOrders.execute(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  return router;
};

export const buildAdminOnboardingRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoOnboardingRepository();
  const listOrders = deps.listAdminOrders ?? new ListAdminActivationOrdersUseCase({ repo });
  const fulfilOrder = deps.fulfilOrder ?? new FulfillActivationOrderUseCase({ repo });
  const refundOrder = deps.refundOrder ?? new RefundActivationOrderUseCase({
    repo,
    events: deps.events,
  });
  const listKyc = deps.listKyc ?? new ListKycSubmissionsUseCase({ repo });
  const verifyKyc = deps.verifyKyc ?? new VerifyKycUseCase({ repo });
  const rejectKyc = deps.rejectKyc ?? new RejectKycUseCase({ repo });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');

  const router = express.Router();
  router.use(auth, admin);

  router.get('/orders', validate({ query: OrderQuerySchema }), asyncHandler(async (req, res) => {
    const result = await listOrders.execute(req.validated.query);
    return sendSuccess(res, { data: result.data, meta: result.meta });
  }));

  router.post(
    '/orders/:id/fulfill',
    validate({ params: OrderIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await fulfilOrder.execute(req.validated.params.id, req.auth.partnerId);
      return sendSuccess(res, { message: 'Activation order fulfilled', data });
    }),
  );

  router.post(
    '/orders/:id/refund',
    validate({ params: OrderIdParamsSchema, body: RefundOrderSchema }),
    asyncHandler(async (req, res) => {
      const data = await refundOrder.execute(
        req.validated.params.id,
        req.auth.partnerId,
        req.validated.body.reason,
      );
      return sendSuccess(res, { message: 'Activation order refunded', data });
    }),
  );

  router.get('/kyc', validate({ query: KycQuerySchema }), asyncHandler(async (req, res) => {
    const result = await listKyc.execute(req.validated.query);
    return sendSuccess(res, { data: result.data, meta: result.meta });
  }));

  router.post(
    '/kyc/:partnerId/verify',
    validate({ params: PartnerIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await verifyKyc.execute(req.validated.params.partnerId, req.auth.partnerId);
      return sendSuccess(res, { message: 'KYC verified', data });
    }),
  );

  router.post(
    '/kyc/:partnerId/reject',
    validate({ params: PartnerIdParamsSchema, body: RejectKycSchema }),
    asyncHandler(async (req, res) => {
      const data = await rejectKyc.execute(
        req.validated.params.partnerId,
        req.auth.partnerId,
        req.validated.body.note,
      );
      return sendSuccess(res, { message: 'KYC rejected', data });
    }),
  );

  return router;
};

export default buildOnboardingRouter();
