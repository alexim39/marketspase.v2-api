import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';
import { logger } from '../../../shared/observability/logger.js';

/** Interface: HTTP adapters for billing. Envelopes match house style. */
export const makeBillingController = (uc) => ({
  resolveAccount: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.resolveAccount.execute({ accountNumber: q?.accountNumber, bankCode: q?.bankCode });
    res.status(200).json({ message: 'Account resolved successfully', data, success: true });
  }),

  listBanks: asyncHandler(async (req, res) => {
    const data = await uc.listBanks.execute();
    res.status(200).json({ message: 'Banks retrieved successfully', data, success: true });
  }),

  getSavedPayoutAccount: asyncHandler(async (req, res) => {
    const data = await uc.getSavedPayoutAccount.execute({ partnerId: req.auth?.partnerId });
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      message: data.saved ? 'Saved payout account retrieved' : 'No saved payout account',
      data,
      success: true,
    });
  }),

  /** Step-up password check for the money-moving withdrawal route. */
  confirmWithdrawalPassword: asyncHandler(async (req, _res, next) => {
    const body = req.validated?.body ?? req.body;
    try {
      await uc.confirmPassword.execute({
        partnerId: req.auth?.partnerId,
        password: body?.password,
      });
    } catch (error) {
      if (error?.code === 'INVALID_PASSWORD') {
        logger.warn('withdrawal_password_rejected', {
          partnerId: req.auth?.partnerId ?? null,
          requestId: req.id,
        });
      }
      throw error;
    }
    next();
  }),

  createWithdrawal: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.createWithdrawal.execute({
      partnerId: req.auth?.partnerId,
      bankCode: body?.bankCode,
      bankName: body?.bankName,
      accountNumber: body?.accountNumber,
      amountNgn: body?.amountNgn,
      saveAccount: body?.saveAccount,
    });
    const balanceBefore = data.balance === null || data.balance === undefined
      ? null
      : Number(data.balance) + Number(data.amountNgn);
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: 'wallet.withdraw.request',
      targetType: 'withdrawal',
      targetId: data.reference,
      detail: {
        amountNgn: data.amountNgn,
        balanceBefore,
        balanceAfter: data.balance ?? null,
        status: data.status,
        payoutMode: data.payoutMode,
        bank: data.bank,
        accountLast4: String(data.accountNumber ?? '').slice(-4),
        saveAccount: body?.saveAccount ?? null,
        requestId: req.id,
      },
    });
    logger.info('money_action', {
      action: 'wallet.withdraw.request',
      partnerId: req.auth?.partnerId,
      amountNgn: data.amountNgn,
      reference: data.reference,
      balanceBefore,
      balanceAfter: data.balance ?? null,
      requestId: req.id,
    });
    res.status(201).json({
      message: 'Withdrawal request created',
      data,
      meta: {
        next_steps: {
          reference: data.reference,
          status: data.status,
          payout_mode: data.payoutMode,
          next_action: data.status === 'Paid' ? 'none' : 'wait_for_payout',
        },
      },
      success: true,
    });
  }),
});
