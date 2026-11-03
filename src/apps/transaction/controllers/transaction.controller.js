import { TransactionModel } from "../models/transaction.model.js";
import axios from "axios";
import { PartnersModel } from '../../partner/models/partner.model.js';
import { sendEmail } from "../../../services/emailService.js";
import { ownerEmailTemplate } from '../services/email/withdrawal/ownerTemplate.js';
import { userWithdrawalEmailTemplate } from '../services/email/withdrawal/userTemplate.js';
import { NotifyUseCase } from '../../../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { recordAudit } from '../../../modules/audit/index.js';
import { SMS_CHARGE_PER_PAGE as SMS_CHARGE } from '../../../modules/outreach/domain/Outreach.entity.js';

const WITHDRAWAL_STATUSES = ['Pending', 'Paid', 'Rejected'];

/** Best-effort partner notice — never fails the decision. */
const notifyPartner = async (ownerId, { title, body, key }) => {
  try {
    const stored = new MongoStoredNotificationStore();
    await new NotifyUseCase({ stored }).execute({
      recipientId: String(ownerId),
      category: 'commission',
      priority: 'high',
      title,
      body,
      icon: 'payments',
      link: '/dashboard/earnings',
      key,
    }).catch(() => null);
    const { PartnersModel } = await import('../../partner/models/partner.model.js');
    const owner = await PartnersModel.findById(ownerId).select('email').lean().catch(() => null);
    if (owner?.email) await sendEmail(owner.email, title, `<p>${body}</p>`).catch(() => null);
  } catch { /* notifications never fail admin actions */ }
};

// confirm payment
export const confirmPayment = async (req, res) => {
  const { reference, partnerId } = req.body;
  const paymentMethod = "Paystack";

  // Step 1: Verify the transaction with Paystack
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACKTOKEN}`, // Replace with your Paystack secret key
        },
      }
    );

    const transactionData = response.data.data;
    if (transactionData.status !== "success") {
      return res.status(400).json({ 
        message: "Transaction not successful",
        success: false,
    });
    }

    // Step 2: Find the user and update their balance
    // Session-owned: a verified payment credits the payer's own wallet —
    // a body partnerId pointing elsewhere is rejected (no credit gifting).
    const sessionId = req.auth?.partnerId;
    if (!sessionId || String(partnerId) !== String(sessionId)) {
      return res.status(403).json({
        message: 'Payment can only credit your own wallet',
        success: false,
      });
    }
    const partner = await PartnersModel.findById(sessionId);
    if (!partner) {
      return res.status(404).json({ 
            message: "Partner not found",
            success: false,
        });
    }

    const amountInNaira = transactionData.amount / 100; // Convert kobo to Naira
    partner.balance += amountInNaira;
    await partner.save();

    // Step 3: Save the transaction record
    const transaction = new TransactionModel({
      partnerId: partner._id,
      amount: amountInNaira,
      reference,
      paymentMethod,
      transactionType: "Credit",
      status: transactionData.status,
    });
    await transaction.save();

    return res.status(200).json({ 
        message: "Payment verified and balance updated", 
        partner,
        success: true,
    });
  } catch (error) {
    return res.status(500).json({ 
        message: "Payment verification failed",
        success: false,
        error: error.message,
     });
  }
};

export const getTransactions = async (req, res) => {
  try {
    // Session-owned: partners read their own history only.
    const partnerId = req.auth?.partnerId;

    // Find transactions where partnerId matches the provided ID
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

// Function to charge the partner for bulk sms
export const bulkSMSCharge = async (req, res) => {
  // Canonical outreach rate (see Outreach.entity) — never a local literal.

  //console.log('body== ',req.body)
  const { numberOfContacts, pages } = req.body;
    // Session-owned charge (see singleSMSCharge) — body partnerId ignored.
    const partnerId = req.auth?.partnerId;

  try {
    // Find the partner by ID
    const partner = await PartnersModel.findById(partnerId);
    if (!partner) {
      return res.status(400).json({
        message: "Partner not found",
        success: false,
      });
    }

    // get cost
    const smsCostPerPage = pages * SMS_CHARGE;
    const totalCost = smsCostPerPage * numberOfContacts;

    // Check if the partner has sufficient balance
    if (partner.balance >= totalCost) {
      // Deduct the SMS charge
      partner.balance -= totalCost;

      // Save the updated partner balance
      await partner.save();

      // Record the transaction
      const transaction = new TransactionModel({
        partnerId: partner._id,
        amount: totalCost,
        status: "Completed",
        paymentMethod: "SMS Charge",
        transactionType: "Debit",
        //reference: `Charge for SMS on ${new Date().toISOString()}`,
        reference: Math.floor(100000000 + Math.random() * 900000000).toString(), // Generate a random 9-digit number as string, ensuring it's always 9 digits
      });

      await transaction.save();

      res.status(200).json({
        message: "Charge successful. Transaction recorded.",
        data: transaction,
        success: true,
      });
    } else {
      return res.status(401).json({
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

// Admin queue: pending withdrawals, oldest first (money already debited).
export const listWithdrawals = async (req, res) => {
  try {
    const status = req.query.status ?? 'Pending';
    if (!WITHDRAWAL_STATUSES.includes(status) && status !== 'All') {
      return res.status(400).json({ message: 'Invalid status filter', success: false });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const filter = { paymentMethod: 'Withdrawal', ...(status === 'All' ? {} : { status }) };
    const [rows, total] = await Promise.all([
      TransactionModel.find(filter).sort({ date: 1 }).skip(skip).limit(limit).lean(),
      TransactionModel.countDocuments(filter),
    ]);
    const ownerIds = [...new Set(rows.map((r) => String(r.partnerId)).filter(Boolean))];
    const { PartnersModel } = await import('../../partner/models/partner.model.js');
    const owners = ownerIds.length > 0
      ? await PartnersModel.find({ _id: { $in: ownerIds } }).select('username name surname email phone').lean().catch(() => [])
      : [];
    const labels = Object.fromEntries((owners ?? []).map((o) => [String(o._id), {
      username: o.username,
      name: [o.name, o.surname].filter(Boolean).join(' ') || o.username,
    }]));
    res.status(200).json({
      message: 'Withdrawals retrieved successfully!',
      data: rows.map((r) => ({ ...r, owner: labels[String(r.partnerId)] ?? null })),
      meta: { total, limit, skip },
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving withdrawals', error: error.message, success: false });
  }
};

// Admin decision: Pending→Paid (with receipt reference) or →Rejected
// (full refund — money never strands on a rejected request).
export const decideWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reference, reason } = req.body ?? {};
    if (!['Paid', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status', success: false });
    }
    const tx = await TransactionModel.findById(id);
    if (!tx) {
      return res.status(404).json({ message: 'Withdrawal not found', success: false });
    }
    if (tx.paymentMethod !== 'Withdrawal' || tx.status !== 'Pending') {
      return res.status(409).json({ message: `Cannot decide a ${tx.status} withdrawal`, success: false });
    }
    tx.status = status;
    tx.decidedBy = req.auth?.partnerId ?? null;
    tx.decidedAt = new Date();
    tx.decisionNote = String(reason ?? '').slice(0, 500) || null;
    if (reference) tx.reference = String(reference).slice(0, 64);
    await tx.save();

    if (status === 'Rejected') {
      const { PartnersModel } = await import('../../partner/models/partner.model.js');
      const owner = await PartnersModel.findById(tx.partnerId);
      if (owner && Number(tx.amount) > 0) {
        owner.balance = Number(owner.balance ?? 0) + Number(tx.amount);
        await owner.save();
        await TransactionModel.create({
          partnerId: owner._id,
          amount: Number(tx.amount),
          status: 'Completed',
          paymentMethod: 'Withdrawal Refund',
          transactionType: 'Credit',
          reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
        });
      }
    }

    const title = status === 'Paid' ? 'Your withdrawal has been paid' : 'Your withdrawal was declined';
    await notifyPartner(tx.partnerId, {
      title,
      body: status === 'Paid'
        ? `₦${Number(tx.amount).toLocaleString()}${tx.reference ? ` (ref ${tx.reference})` : ''} is on its way to your account.`
        : `${reason ? `"${String(reason).slice(0, 500)}" ` : ''}The held ₦${Number(tx.amount).toLocaleString()} was refunded in full.`,
      key: `withdrawal:${tx._id}:${status}`,
    });

    res.status(200).json({ message: `Withdrawal marked as ${status.toLowerCase()}!`, data: tx, success: true });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'withdrawal.decide',
      targetType: 'withdrawal', targetId: String(tx._id),
      detail: { status, amount: Number(tx.amount) ?? null, owner: String(tx.partnerId) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deciding withdrawal', error: error.message, success: false });
  }
};
// Partner withdrawal request
export const withdrawRequest = async (req, res) => {
  const { bank, accountNumber, accountName, amount } = req.body;
  // Session-owned: withdrawals debit the caller's own wallet only.
  const partnerId = req.auth?.partnerId;

  try {
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
    if (partner.balance >= amount) {
      // Deduct the SMS charge
      partner.balance -= amount;

      // Save the updated partner balance
      await partner.save();

      // Record the transaction
      const transaction = new TransactionModel({
        partnerId: partner._id,
        amount: amount,
        status: "Pending",
        paymentMethod: "Withdrawal",
        transactionType: "Debit",
        bank: bank ?? null,
        accountNumber: accountNumber ?? null,
        accountName: accountName ?? null,
        //reference: `Charge for SMS on ${new Date().toISOString()}`,
        reference: Math.floor(100000000 + Math.random() * 900000000).toString(), // Generate a random 9-digit number as string, ensuring it's always 9 digits
      });


      // Send email to owner
      const ownerSubject = 'New Withdrawal Request';
      const ownerMessage = ownerEmailTemplate(req.body);
      const ownerEmails = [ 'ago.fnc@gmail.com'];
      for (const email of ownerEmails) {
        await sendEmail(email, ownerSubject, ownerMessage);
      }

      // Send email to the user
      const userSubject = 'Withdrawal Request Notification';
      const userMessage = userWithdrawalEmailTemplate(partner, req.body);
      await sendEmail(partner.email, userSubject, userMessage);


      await transaction.save();

      //return { success: true, message: 'Charge successful. Transaction recorded.' };
      res.status(200).json({
        message: "Charge successful. Transaction recorded.",
        data: transaction,
        success: true,
      });
    } else {
      return res.status(401).json({
        code: 401,
        message: "Insufficient balance for transaction",
        success: false,
      });
    }
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      message: "An error occurred while processing the charge.",
      error: error.message,
      success: false,
    });
  }
};
