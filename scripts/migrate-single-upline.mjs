import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Single-upline migration.
 *
 * `partnerOf` is the canonical upline. Legacy `placementParentId` was a second
 * campaign-parent relationship; this script makes the data match the new rule:
 *   1. partners with only placementParentId get that value copied to partnerOf,
 *   2. conflicting rows keep partnerOf (canonical) and are reported,
 *   3. placementParentId is removed from partners, commission sales and queue rows.
 *
 * Dry-run by default. Apply with APPLY=1.
 */
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1, autoIndex: false });
const db = mongoose.connection.db;
const partners = db.collection('partners');
const sales = db.collection('commission_sales');
const queue = db.collection('activation_queue');

const [total, both, mismatch, referralOnly, placementOnly, neither] = await Promise.all([
  partners.countDocuments({}),
  partners.countDocuments({ partnerOf: { $ne: null }, placementParentId: { $ne: null } }),
  partners.countDocuments({
    partnerOf: { $ne: null },
    placementParentId: { $ne: null },
    $expr: { $ne: ['$partnerOf', '$placementParentId'] },
  }),
  partners.countDocuments({ partnerOf: { $ne: null }, placementParentId: null }),
  partners.countDocuments({ partnerOf: null, placementParentId: { $ne: null } }),
  partners.countDocuments({ partnerOf: null, placementParentId: null }),
]);
const [saleLegacy, queueLegacy] = await Promise.all([
  sales.countDocuments({ placementParentId: { $ne: null } }),
  queue.countDocuments({ placementParentId: { $ne: null } }),
]);

console.log(JSON.stringify({
  partners: { total, both, mismatch, referralOnly, placementOnly, neither },
  legacyRows: { commissionSales: saleLegacy, activationQueue: queueLegacy },
}, null, 1));

if (mismatch > 0) {
  const examples = await partners.find(
    {
      partnerOf: { $ne: null },
      placementParentId: { $ne: null },
      $expr: { $ne: ['$partnerOf', '$placementParentId'] },
    },
    { projection: { username: 1, partnerOf: 1, placementParentId: 1 } },
  ).limit(10).toArray();
  console.log('conflicting rows (partnerOf wins):', JSON.stringify(examples, null, 1));
}

const apply = String(process.env.APPLY ?? '') === '1';
if (!apply) {
  console.log('Dry run only. Re-run with APPLY=1 to backfill and remove placementParentId.');
  await mongoose.disconnect();
  process.exit(0);
}

const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // Backfill the canonical upline before removing the legacy field.
    await partners.updateMany(
      { partnerOf: null, placementParentId: { $ne: null } },
      [{ $set: { partnerOf: '$placementParentId', systemOwned: false } }],
      { session },
    );
    // Keep partnerOf on conflicts; only remove the legacy field.
    await partners.updateMany(
      { placementParentId: { $exists: true } },
      { $unset: { placementParentId: '' } },
      { session },
    );
    await sales.updateMany(
      { placementParentId: { $exists: true } },
      { $unset: { placementParentId: '' } },
      { session },
    );
    await queue.updateMany(
      { placementParentId: { $exists: true } },
      { $unset: { placementParentId: '' } },
      { session },
    );
  });
  await partners.dropIndex('placementParentId_1').catch(() => null);
  console.log('Applied: partnerOf backfilled; placementParentId removed from partners, commission_sales and activation_queue.');
} finally {
  await session.endSession();
  await mongoose.disconnect();
}
