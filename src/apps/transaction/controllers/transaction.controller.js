import { TransactionModel } from "../models/transaction.model.js";
import { mask, last4 } from '../../../shared/security/fieldCrypto.js';

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
      data: transaction.map((row) => ({
        ...row,
        accountNumber: row.accountLast4
          ? `••••${row.accountLast4}`
          : mask(row.accountNumber),
        accountLast4: row.accountLast4 ?? last4(row.accountNumber),
      })),
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

