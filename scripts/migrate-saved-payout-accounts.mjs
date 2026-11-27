import 'dotenv/config';
import mongoose from 'mongoose';
import { open } from '../src/shared/security/fieldCrypto.js';
import { hashPayoutAccount } from '../src/modules/billing/domain/SavedPayoutAccount.js';
import { SavedPayoutAccountModel } from '../src/modules/billing/infrastructure/SavedPayoutAccount.mongo.model.js';

/**
 * One-off migration: single saved payout account -> up to five.
 *
 *   - Backfills `accountNumberHash` from the sealed account number.
 *   - Drops the old unique `partnerId_1` index.
 *   - Creates the partial unique `(partnerId, bankCode, accountNumberHash)`
 *     and `(partnerId, updatedAt)` indexes. Idempotent: existing indexes with
 *     the same keys are left alone even if MongoDB auto-named them.
 *
 * Usage from api/:
 *   node scripts/migrate-saved-payout-accounts.mjs          # dry run
 *   APPLY=1 node scripts/migrate-saved-payout-accounts.mjs  # write
 */

const APPLY = process.env.APPLY === '1';
const COLLECTION = 'saved_payout_accounts';
const database = String(process.env.MONGODB_DATABASE ?? '').trim();
const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${username}:${password}@${host}/${database}?retryWrites=true&w=majority`;

const keyId = (key) => JSON.stringify(key);
const WANTED = [
  {
    keys: { partnerId: 1, bankCode: 1, accountNumberHash: 1 },
    options: {
      unique: true,
      partialFilterExpression: { accountNumberHash: { $type: 'string' } },
      name: 'partner_bank_account_unique',
    },
  },
  {
    keys: { partnerId: 1, updatedAt: -1 },
    options: {},
  },
];

await mongoose.connect(uri);
const db = mongoose.connection.db;
const collection = db.collection(COLLECTION);
const rows = await SavedPayoutAccountModel.find({}).lean();
const indexes = await collection.indexes();

const updates = [];
const skipped = [];
for (const row of rows) {
  const accountNumber = open(row.accountNumberSealed);
  if (!accountNumber) {
    skipped.push(String(row._id));
    continue;
  }
  const hash = hashPayoutAccount(accountNumber);
  if (row.accountNumberHash !== hash) {
    updates.push({ id: row._id, hash });
  }
}

const oldUnique = indexes.filter((index) => (
  index.unique === true
  && index.key
  && Object.keys(index.key).length === 1
  && index.key.partnerId === 1
));

const existingKeys = new Set(indexes.map((index) => keyId(index.key)));
const missingIndexes = WANTED.filter((wanted) => !existingKeys.has(keyId(wanted.keys)));

const plan = {
  mode: APPLY ? 'apply' : 'dry-run (set APPLY=1 to write)',
  database,
  rows: rows.length,
  hashesToBackfill: updates.length,
  unreadableRows: skipped,
  indexesToDrop: oldUnique.map((index) => index.name),
  indexesToCreate: missingIndexes.map((wanted) => wanted.options.name ?? keyId(wanted.keys)),
  indexesAlreadyPresent: WANTED
    .filter((wanted) => existingKeys.has(keyId(wanted.keys)))
    .map((wanted) => wanted.indexes ?? keyId(wanted.keys)),
};

if (!APPLY) {
  console.log(JSON.stringify(plan, null, 2));
  await mongoose.connection.close(false);
  process.exit(0);
}

for (const update of updates) {
  await collection.updateOne(
    { _id: update.id },
    { $set: { accountNumberHash: update.hash } },
  );
}

for (const index of oldUnique) {
  await collection.dropIndex(index.name);
}

for (const wanted of missingIndexes) {
  await collection.createIndex(wanted.keys, wanted.options);
}

console.log(JSON.stringify({
  ...plan,
  mode: 'applied',
  backfilled: updates.length,
  dropped: oldUnique.map((index) => index.name),
  created: missingIndexes.length,
}, null, 2));

await mongoose.connection.close(false);
