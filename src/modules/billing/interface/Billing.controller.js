import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';

const param = (req, key) => req.validated?.params?.[key] ?? req.params[key];

/** Interface: HTTP adapters for billing. Envelopes match house style. */
export const makeBillingController = (uc) => ({
  mine: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.mine.execute({
      partnerId: req.auth?.partnerId,
      limit: q?.limit,
      skip: q?.skip,
      status: q?.status,
    });
    res.status(200).json({ message: 'Commissions retrieved successfully', data, success: true });
  }),

  summary: asyncHandler(async (req, res) => {
    const data = await uc.performance.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Performance retrieved successfully', data, success: true });
  }),

  trends: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.trends.execute({ partnerId: req.auth?.partnerId, months: q?.months });
    res.status(200).json({ message: 'Earnings trend retrieved successfully', data, success: true });
  }),

  resolveAccount: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.resolveAccount.execute({ accountNumber: q?.accountNumber, bankCode: q?.bankCode });
    res.status(200).json({ message: 'Account resolved successfully', data, success: true });
  }),

  accrue: asyncHandler(async (req, res) => {
    const data = await uc.accrue.execute({ cartId: param(req, 'cartId') });
    res.status(200).json({ message: 'Commissions accrued successfully', data, success: true });
  }),

  pendingCarts: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.pendingCarts.execute({ limit: q?.limit, skip: q?.skip });
    res.status(200).json({ message: 'Pending release queue retrieved successfully', data, success: true });
  }),

  release: asyncHandler(async (req, res) => {
    const data = await uc.release.execute({ cartId: param(req, 'cartId'), releasedBy: req.auth?.partnerId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'payout.release',
      targetType: 'cart', targetId: param(req, 'cartId'),
    });
    res.status(200).json({ message: 'Commissions released successfully', data, success: true });
  }),

  void: asyncHandler(async (req, res) => {
    const data = await uc.void.execute({ cartId: param(req, 'cartId'), releasedBy: req.auth?.partnerId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'payout.void',
      targetType: 'cart', targetId: param(req, 'cartId'),
    });
    res.status(200).json({ message: 'Order commissions voided successfully', data, success: true });
  }),

  plan: asyncHandler(async (req, res) => {
    const data = await uc.plan.execute();
    res.status(200).json({ message: 'Commission plan retrieved successfully', data, success: true });
  }),

  updatePlan: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.updatePlan.execute({
      rates: body.rates,
      name: body.name ?? null,
      updatedBy: req.auth?.partnerId,
    });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'billing.plan.update',
      targetType: 'commission-plan', targetId: data.id,
      detail: { rates: data.rates },
    });
    res.status(200).json({ message: 'Commission plan updated — applies to future accrues only', data, success: true });
  }),
});
