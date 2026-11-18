import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Backfill the non-withdrawable platform-bonus bucket for existing accounts.
 *
 * New bonus claims and admin credits now set `bonusBalance`. Accounts that
 * were credited before that change only have the credit in `balance`, so a
 * one-time reconstruction is needed.
 *
 * The reconstruction is deliberately conservative:
 *   - platform bonus = actual Welcome Bonus/Bonus credits (or tagged rows)
 *   - platform spend = debits except withdrawals, store recoveries and
 *     commission reversals
 *   - refunds/closeouts of platform spend reduce that spend
 *   - bonusBalance = min(current balance, unspent bonus)
 *
 * Historical Admin Credit rows are left alone because their intent is
 * ambiguous (top-up, correction or promotional). New admin credits are tagged
 * by the shared credit core.
 * It never increases a partner's existing bonusBalance and never changes the
 * total wallet balance. Dry-run by default; apply with APPLY=1.
 */
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

const APPLY = String(process.env.APPLY ?? '') === '1';
const EXCLUDED_SPEND = new Set(['Withdrawal', 'Store refund', 'Commission Reversal']);
const LEGACY_BONUS_METHODS = new Set(['Welcome Bonus', 'Bonus']);

await mongoose.connect(uri, {
  serverSelectionTimeoutMS: 15000,
  maxPoolSize: 1,
  autoIndex: false,
});
const db = mongoose.connection.db;
const partners = db.collection('partners');
const transactions = db.collection('transactions');

const isRefund = (row) => {
  const method = String(row.paymentMethod ?? '');
  const type = String(row.transactionType ?? '');
  if (method === 'Withdrawal Refund') return false;
  return Number(row.amount) > 0 && (/refund/i.test(method) || /refund/i.test(type) || method === 'Growth Campaign Closeout');
};

const candidateRows = await transactions.aggregate([
  {
    $match: {
      $or: [
        { paymentMethod: { $in: [...LEGACY_BONUS_METHODS] } },
        { bonusAmount: { $gt: 0 } },
      ],
    },
  },
  { $group: { _id: '$partnerId' } },
]).toArray();
const ids = [...new Set(candidateRows.map((row) => String(row._id)))];

const results = [];
for (const id of ids) {
  const partner = await partners.findOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { projection: { username: 1, balance: 1, bonusBalance: 1 } },
  );
  if (!partner) continue;
  const currentBonus = Math.max(0, Number(partner.bonusBalance ?? 0));
  if (currentBonus > 0) {
    results.push({ id, username: partner.username, skipped: 'already-tagged', bonusBalance: currentBonus });
    continue;
  }

  const rows = await transactions.find(
    { partnerId: new mongoose.Types.ObjectId(id) },
    { projection: { amount: 1, transactionType: 1, paymentMethod: 1, bonusAmount: 1 } },
  ).toArray();

  let bonusCredits = 0;
  let spend = 0;
  let refunds = 0;
  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    const taggedBonus = Math.max(0, Number(row.bonusAmount ?? 0));
    const legacyBonus = amount > 0 && LEGACY_BONUS_METHODS.has(String(row.paymentMethod ?? ''))
      ? amount
      : 0;
    bonusCredits += Math.max(taggedBonus, legacyBonus);

    const debit = row.transactionType === 'Debit' || amount < 0;
    if (debit && !EXCLUDED_SPEND.has(String(row.paymentMethod ?? ''))) {
      spend += Math.abs(amount);
    } else if (isRefund(row)) {
      refunds += amount;
    }
  }

  const netSpend = Math.max(0, spend - refunds);
  const unspentBonus = Math.max(0, bonusCredits - netSpend);
  const balance = Math.max(0, Number(partner.balance ?? 0));
  const target = Math.min(balance, unspentBonus);
  results.push({
    id,
    username: partner.username,
    balance,
    bonusCredits,
    netSpend,
    target,
    skipped: null,
  });

  if (APPLY && target > 0) {
    await partners.updateOne(
      { _id: partner._id, $or: [{ bonusBalance: { $exists: false } }, { bonusBalance: 0 }] },
      { $set: { bonusBalance: target } },
    );
  }
}

const changed = results.filter((row) => !row.skipped && row.target > 0);
const skipped = results.filter((row) => row.skipped);
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  candidates: results.length,
  wouldLock: changed.length,
  alreadyTagged: skipped.length,
  lockedTotal: changed.reduce((sum, row) => sum + row.target, 0),
  examples: results.slice(0, 15),
}, null, 2));

if (!APPLY) {
  console.log('Dry run only. Re-run with APPLY=1 to write bonusBalance.');
}
await mongoose.disconnect();
