import { TransactionModel } from "../models/transaction.model.js";
import { PartnersModel } from '../../partner/models/partner.model.js';
import { SMS_CHARGE_PER_PAGE as SMS_CHARGE } from '../../../modules/outreach/domain/Outreach.entity.js';

export const getTransactions = async (req, res) => {
  try {
    // Session-owned: partners read their own history only.
    const partnerId = req.auth?.partnerId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const filter = { partnerId };
    const [transaction, total] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      TransactionModel.countDocuments(filter),
    ]);

    res.status(200).json({
      message: "Transaction retrieved successfully!",
      data: transaction,
      meta: {
        count: transaction.length,
        total,
        limit,
        skip,
        hasMore: skip + transaction.length < total,
        next_action: skip + transaction.length < total ? 'load_more' : null,
      },
      success: true,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      message: "Error retrieving transactions",
      error: error.message,
      success: false,
    });
  }
};

// Function to charge the partner for single sms
export const singleSMSCharge = async (req, res) => {
  // Single send = 1 page at the canonical outreach rate (see Outreach.entity).

  try {
    // Session-owned: the charge always lands on the caller's own wallet —
    // a path/body partnerId pointing elsewhere is ignored, never honored.
    const partnerId = req.auth?.partnerId;

    // Atomic conditional debit — never load-modify-save the partner doc.
    const partner = await PartnersModel.findOneAndUpdate(
      { _id: partnerId, balance: { $gte: SMS_CHARGE } },
      { $inc: { balance: -SMS_CHARGE } },
      { new: true },
    ).lean();
    if (!partner) {
      return res.status(400).json({
        message: "Insufficient balance for transaction",
        success: false,
      });
    }

    // Record the transaction with the immutable balance snapshot.
    const transaction = new TransactionModel({
      partnerId: partner._id,
      amount: SMS_CHARGE,
      balanceBefore: Number(partner.balance ?? 0) + Number(SMS_CHARGE),
      balanceAfter: partner.balance ?? null,
      status: "Completed",
      paymentMethod: "SMS Charge",
      transactionType: "Debit",
      reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
    });

    await transaction.save();

    res.status(200).json({
      message: "Charge successful. Transaction recorded.",
      data: transaction,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: "An error occurred while processing the charge.",
      error: error.message,
      success: false,
    });
  }
};

// Partner withdrawal request — DEPRECATED.
// This legacy endpoint trusted a client-typed account name, had no bank code
// and could not re-resolve the account. Withdrawals now go through
// POST /v1/billing/withdrawals, which verifies the account with Paystack,
// debits atomically and stores bankCode/accountName. Fail closed for any old
// client instead of creating an unverified payout.
export const withdrawRequest = async (_req, res) => {
  res.status(410).json({
    message: 'Withdrawals have moved — refresh the app and use Settings → Billing → Withdraw.',
    code: 'WITHDRAWAL_FLOW_UPDATED',
    success: false,
  });
};
