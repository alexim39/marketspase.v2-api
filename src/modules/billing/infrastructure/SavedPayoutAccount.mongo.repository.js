import mongoose from 'mongoose';
import { open, seal } from '../../../shared/security/fieldCrypto.js';
import { SavedPayoutAccountModel } from './SavedPayoutAccount.mongo.model.js';

const objectId = (value) => (mongoose.isValidObjectId(value) ? value : null);

export const shapeSavedPayoutAccount = (doc) => {
  if (!doc) return null;
  const accountNumber = open(doc.accountNumberSealed);
  if (!accountNumber) return null;
  return {
    bankCode: doc.bankCode,
    bankName: doc.bankName,
    accountName: doc.accountName,
    accountNumber,
    accountLast4: doc.accountLast4,
    savedAt: doc.updatedAt ?? doc.createdAt ?? null,
  };
};

/** Owner-scoped saved payout destination. */
export class MongoSavedPayoutAccountRepository {
  async findByPartner(partnerId) {
    if (!objectId(partnerId)) return null;
    return shapeSavedPayoutAccount(
      await SavedPayoutAccountModel.findOne({ partnerId }).lean(),
    );
  }

  async upsert(partnerId, account) {
    if (!objectId(partnerId)) throw new Error('Invalid partner id');
    const accountNumber = String(account?.accountNumber ?? '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(accountNumber)) throw new Error('Invalid account number');
    const doc = await SavedPayoutAccountModel.findOneAndUpdate(
      { partnerId },
      {
        $set: {
          bankCode: String(account?.bankCode ?? '').trim(),
          bankName: String(account?.bankName ?? '').trim(),
          accountName: String(account?.accountName ?? '').trim(),
          accountNumberSealed: seal(accountNumber),
          accountLast4: accountNumber.slice(-4),
        },
      },
      { new: true, upsert: true },
    ).lean();
    return shapeSavedPayoutAccount(doc);
  }

  async remove(partnerId) {
    if (!objectId(partnerId)) return { removed: false };
    const result = await SavedPayoutAccountModel.deleteOne({ partnerId });
    return { removed: (result.deletedCount ?? 0) > 0 };
  }
}
