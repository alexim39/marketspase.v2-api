import { TransactionModel } from "../models/transaction.model.js";
import { PartnersModel } from '../../partner/models/partner.model.js';
import { SMS_CHARGE_PER_PAGE as SMS_CHARGE } from '../../../modules/outreach/domain/Outreach.entity.js';

export const getTransactions = async (req, res) => {
  try {
    // Session-owned: partners read their own history only.
    const partnerId = req.auth?.partnerId;

    const transaction = await TransactionModel.find({ partnerId });

    res.status(200).json({
      message: "Transaction retrieved successfully!",
      data: transaction,
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

    // Find the partner by ID
    const partner = await PartnersModel.findById(partnerId);
    if (!partner) {
      //return { success: false, message: 'Partner not found.' };
      return res.status(400).json({
        message: "Partner not found",
        success: false,
      });
    }

    // Check if the partner has sufficient balance
    if (partner.balance >= SMS_CHARGE) {
      // Deduct the SMS charge
      partner.balance -= SMS_CHARGE;

      // Save the updated partner balance
      await partner.save();

      // Record the transaction
      const transaction = new TransactionModel({
        partnerId: partner._id,
        amount: SMS_CHARGE,
        status: "Completed",
        paymentMethod: "SMS Charge",
        transactionType: "Debit",
        //reference: `Charge for SMS on ${new Date().toISOString()}`,
        reference: Math.floor(100000000 + Math.random() * 900000000).toString(), // Generate a random 9-digit number as string, ensuring it's always 9 digits
      });

      await transaction.save();

      //return { success: true, message: 'Charge successful. Transaction recorded.' };
      res.status(200).json({
        message: "Charge successful. Transaction recorded.",
        data: transaction,
        success: true,
      });
    } else {
      return res.status(400).json({
        message: "Insufficient balance for transaction",
        success: false,
      });
    }
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
