import 'dotenv/config';
import mongoose from 'mongoose';
import { TransactionModel } from '../src/apps/transaction/models/transaction.model.js';
import { DepositIntentModel } from '../src/modules/billing/infrastructure/Deposit.mongo.model.js';
import { KycSubmissionModel } from '../src/modules/onboarding/infrastructure/Onboarding.models.js';
import { PartnersModel } from '../src/apps/partner/models/partner.model.js';
import { isSealed, seal } from '../src/shared/security/fieldCrypto.js';

const APPLY = process.env.APPLY === '1';
const DRY_RUN = !APPLY;

const mongoUri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

const chunks = (items, size = 200) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const run = async () => {
  await mongoose.connect(mongoUri);
  console.log(`[pii] connected (${DRY_RUN ? 'dry run' : 'APPLY'})`);

  let txSealed = 0;
  const transactions = await TransactionModel.find({
    accountNumber: { $nin: [null, ''] },
  }).select('accountNumber accountLast4').lean();
  const txOps = [];
  for (const row of transactions) {
    if (isSealed(row.accountNumber)) continue;
    txOps.push({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            accountNumber: seal(row.accountNumber),
            accountLast4: row.accountLast4 || String(row.accountNumber).slice(-4),
          },
        },
      },
    });
  }
  txSealed = txOps.length;
  if (!DRY_RUN) {
    for (const batch of chunks(txOps)) await TransactionModel.bulkWrite(batch, { ordered: false });
  }

  let kycSealed = 0;
  const kycRows = await KycSubmissionModel.find({
    $or: [
      { address: { $nin: [null, ''] } },
      { city: { $nin: [null, ''] } },
      { state: { $nin: [null, ''] } },
    ],
  }).select('address city state').lean();
  const kycOps = [];
  for (const row of kycRows) {
    const set = {};
    if (row.address && !isSealed(row.address)) set.address = seal(row.address);
    if (row.city && !isSealed(row.city)) set.city = seal(row.city);
    if (row.state && !isSealed(row.state)) set.state = seal(row.state);
    if (Object.keys(set).length > 0) {
      kycOps.push({ updateOne: { filter: { _id: row._id }, update: { $set: set } } });
    }
  }
  kycSealed = kycOps.length;
  if (!DRY_RUN) {
    for (const batch of chunks(kycOps)) await KycSubmissionModel.bulkWrite(batch, { ordered: false });
  }

  let claimsSealed = 0;
  const claims = await DepositIntentModel.find({
    method: 'manual',
    $or: [
      { 'claim.senderAccount': { $nin: [null, ''] } },
      { 'claim.destinationAccount': { $nin: [null, ''] } },
    ],
  }).select('claim.senderAccount claim.destinationAccount').lean();
  const claimOps = [];
  for (const row of claims) {
    const set = {};
    if (row.claim?.senderAccount && !isSealed(row.claim.senderAccount)) {
      set['claim.senderAccount'] = seal(row.claim.senderAccount);
    }
    if (row.claim?.destinationAccount && !isSealed(row.claim.destinationAccount)) {
      set['claim.destinationAccount'] = seal(row.claim.destinationAccount);
    }
    if (Object.keys(set).length > 0) {
      claimOps.push({ updateOne: { filter: { _id: row._id }, update: { $set: set } } });
    }
  }
  claimsSealed = claimOps.length;
  if (!DRY_RUN) {
    for (const batch of chunks(claimOps)) await DepositIntentModel.bulkWrite(batch, { ordered: false });
  }

  let partnersSealed = 0;
  const partnerRows = await PartnersModel.collection.find({
    $or: [
      { 'address.street': { $nin: [null, ''] } },
      { 'address.city': { $nin: [null, ''] } },
      { 'address.state': { $nin: [null, ''] } },
      { 'address.country': { $nin: [null, ''] } },
      { dobDatePicker: { $nin: [null, ''] } },
    ],
  }, { projection: { address: 1, dobDatePicker: 1 } }).toArray();
  const partnerOps = [];
  for (const row of partnerRows) {
    const set = {};
    for (const field of ['street', 'city', 'state', 'country']) {
      const value = row.address?.[field];
      if (value && !isSealed(value)) set[`address.${field}`] = seal(value);
    }
    if (row.dobDatePicker && !isSealed(row.dobDatePicker)) {
      const plain = row.dobDatePicker instanceof Date
        ? row.dobDatePicker.toISOString()
        : String(row.dobDatePicker);
      if (plain.trim()) set.dobDatePicker = seal(plain);
    }
    if (Object.keys(set).length > 0) {
      partnerOps.push({ updateOne: { filter: { _id: row._id }, update: { $set: set } } });
    }
  }
  partnersSealed = partnerOps.length;
  if (!DRY_RUN) {
    for (const batch of chunks(partnerOps)) await PartnersModel.bulkWrite(batch, { ordered: false });
  }

  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    transactionsToSeal: txSealed,
    kycToSeal: kycSealed,
    manualClaimsToSeal: claimsSealed,
    partnersToSeal: partnersSealed,
  }, null, 2));
  await mongoose.connection.close(false);
};

run().catch(async (error) => {
  console.error('[pii] migration failed:', error?.message ?? error);
  await mongoose.connection.close(false).catch(() => null);
  process.exitCode = 1;
});
