import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Legacy KYC review helper.
 *
 * Activation now requires kycStatus=verified. Current KYC is document-free
 * and self-verifies, so the only blocked rows are legacy `pending` records.
 * Review the list, then rerun with APPLY=1 to mark them verified.
 *
 * Dry-run: node scripts/verify-legacy-pending-kyc.mjs
 * Apply:   APPLY=1 node scripts/verify-legacy-pending-kyc.mjs
 */
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1, autoIndex: false });
const partners = mongoose.connection.db.collection('partners');

const pending = await partners.find({ kycStatus: 'pending' })
  .project({ username: 1, email: 1, accountState: 1, kycSubmittedAt: 1, createdAt: 1 })
  .limit(500)
  .toArray();

console.log(JSON.stringify({
  mode: process.env.APPLY === '1' ? 'apply' : 'dry-run',
  pending: pending.length,
  rows: pending.map((row) => ({
    id: String(row._id),
    username: row.username,
    accountState: row.accountState,
    submittedAt: row.kycSubmittedAt ?? null,
    createdAt: row.createdAt ?? null,
  })),
}, null, 2));

if (process.env.APPLY === '1' && pending.length > 0) {
  const ids = pending.map((row) => row._id);
  const result = await partners.updateMany(
    { _id: { $in: ids }, kycStatus: 'pending' },
    { $set: { kycStatus: 'verified', kycVerifiedAt: new Date() } },
  );
  console.log(`[kyc] marked ${result.modifiedCount} legacy pending records verified`);
}

await mongoose.disconnect();
