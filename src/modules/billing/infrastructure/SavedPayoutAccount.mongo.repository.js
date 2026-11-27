import mongoose from 'mongoose';
import { open, seal } from '../../../shared/security/fieldCrypto.js';
import {
  MAX_SAVED_PAYOUT_ACCOUNTS,
  hashPayoutAccount,
} from '../domain/SavedPayoutAccount.js';
import { SavedPayoutAccountModel } from './SavedPayoutAccount.mongo.model.js';

const objectId = (value) => (mongoose.isValidObjectId(value) ? value : null);

export const shapeSavedPayoutAccount = (doc) => {
  if (!doc) return null;
  const accountNumber = open(doc.accountNumberSealed);
  if (!accountNumber) return null;
  return {
    id: String(doc._id),
    bankCode: doc.bankCode,
    bankName: doc.bankName,
    accountName: doc.accountName,
    accountNumber,
    accountLast4: doc.accountLast4,
    savedAt: doc.updatedAt ?? doc.createdAt ?? null,
  };
};

/** Owner-scoped saved payout destinations (max five per partner). */
export class MongoSavedPayoutAccountRepository {
  /** Most recently saved account, kept for the legacy single-account route. */
  async findByPartner(partnerId) {
    if (!objectId(partnerId)) return null;
    return shapeSavedPayoutAccount(
      await SavedPayoutAccountModel.findOne({ partnerId })
        .sort({ updatedAt: -1 })
        .lean(),
    );
  }

  async listByPartner(partnerId) {
    if (!objectId(partnerId)) return [];
    const docs = await SavedPayoutAccountModel.find({ partnerId })
      .sort({ updatedAt: -1 })
      .limit(MAX_SAVED_PAYOUT_ACCOUNTS)
      .lean();
    return docs.map(shapeSavedPayoutAccount).filter(Boolean);
  }

  /**
   * Save or refresh one account. Returns
   * `{ account, created, limitReached }` so the caller can warn the user
   * without failing a successful withdrawal.
   */
  async save(partnerId, account) {
    if (!objectId(partnerId)) throw new Error('Invalid partner id');
    const accountNumber = String(account?.accountNumber ?? '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(accountNumber)) throw new Error('Invalid account number');

    const bankCode = String(account?.bankCode ?? '').trim();
    const bankName = String(account?.bankName ?? '').trim();
    const accountName = String(account?.accountName ?? '').trim();
    const hash = hashPayoutAccount(accountNumber);
    const last4 = accountNumber.slice(-4);

    let existing = await SavedPayoutAccountModel.findOne({
      partnerId,
      bankCode,
      accountNumberHash: hash,
    }).lean();

    // Legacy rows created before the hash existed: claim them by bank + last4
    // and backfill the hash instead of creating a duplicate.
    if (!existing) {
      existing = await SavedPayoutAccountModel.findOne({
        partnerId,
        bankCode,
        accountLast4: last4,
        $or: [
          { accountNumberHash: null },
          { accountNumberHash: { $exists: false } },
        ],
      }).lean();
    }

    if (existing) {
      const doc = await SavedPayoutAccountModel.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            bankCode,
            bankName,
            accountName,
            accountNumberSealed: seal(accountNumber),
            accountLast4: last4,
            accountNumberHash: hash,
          },
        },
        { new: true },
      ).lean();
      return { account: shapeSavedPayoutAccount(doc), created: false, limitReached: false };
    }

    const count = await SavedPayoutAccountModel.countDocuments({ partnerId });
    if (count >= MAX_SAVED_PAYOUT_ACCOUNTS) {
      return { account: null, created: false, limitReached: true };
    }

    const doc = await SavedPayoutAccountModel.create({
      partnerId,
      bankCode,
      bankName,
      accountName,
      accountNumberSealed: seal(accountNumber),
      accountLast4: last4,
      accountNumberHash: hash,
    });
    return {
      account: shapeSavedPayoutAccount(doc.toObject()),
      created: true,
      limitReached: false,
    };
  }

  async remove(partnerId, accountId) {
    if (!objectId(partnerId) || !objectId(accountId)) {
      return { removed: false, account: null };
    }
    const doc = await SavedPayoutAccountModel.findOneAndDelete({
      _id: accountId,
      partnerId,
    }).lean();
    return { removed: Boolean(doc), account: shapeSavedPayoutAccount(doc) };
  }
}
