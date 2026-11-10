import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Rank auto-sync backfill.
 *
 * Existing partners predate `commissionRankSource`. Auto-sync must not silently
 * overwrite a pilot rank an admin set by hand, so:
 *   - commission rank already matches the journey level -> source = auto
 *   - commission rank differs from the journey level -> source = admin
 *     (the current payout rank is preserved for review)
 *
 * This script never changes any partner's current commissionRank.
 * Dry-run by default. Apply with APPLY=1.
 */
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

const RANKS = ['Partner', 'Builder', 'Leader', 'Ambassador'];
const rankLabel = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  return RANKS.find((rank) => rank.toLowerCase() === raw) ?? 'Partner';
};

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1, autoIndex: false });
const db = mongoose.connection.db;
const partners = db.collection('partners');
const progressions = db.collection('progressions');

const rows = await partners.find(
  { commissionRankSource: { $exists: false } },
  { projection: { _id: 1, username: 1, commissionRank: 1 } },
).toArray();
const ids = rows.map((row) => row._id);
const levels = ids.length
  ? await progressions.find(
    { partnerId: { $in: ids } },
    { projection: { partnerId: 1, level: 1 } },
  ).toArray()
  : [];
const levelByPartner = new Map(levels.map((row) => [String(row.partnerId), row.level]));

const same = [];
const different = [];
for (const row of rows) {
  const current = rankLabel(row.commissionRank);
  const journey = rankLabel(levelByPartner.get(String(row._id)) ?? 'partner');
  (current === journey ? same : different).push({ row, current, journey });
}

console.log(JSON.stringify({
  missingSource: rows.length,
  matchesJourney: same.length,
  differsFromJourney: different.length,
  examples: different.slice(0, 10).map(({ row, current, journey }) => ({
    username: row.username,
    commissionRank: current,
    journeyRank: journey,
  })),
}, null, 1));

const apply = String(process.env.APPLY ?? '') === '1';
if (!apply) {
  console.log('Dry run only. Re-run with APPLY=1 to tag rank sources.');
  await mongoose.disconnect();
  process.exit(0);
}

const now = new Date();
let auto = 0;
let admin = 0;
for (const { row, current, journey } of same) {
  const result = await partners.updateOne(
    { _id: row._id, commissionRankSource: { $exists: false } },
    {
      $set: {
        commissionRankSource: 'auto',
        commissionRankReason: 'Backfilled: matches journey rank',
        commissionRankOverrideUntil: null,
        commissionRankUpdatedAt: now,
      },
    },
  );
  if (result.modifiedCount) auto += 1;
}
for (const { row, current, journey } of different) {
  const result = await partners.updateOne(
    { _id: row._id, commissionRankSource: { $exists: false } },
    {
      $set: {
        commissionRankSource: 'admin',
        commissionRankReason: `Legacy manual rank preserved (journey rank: ${journey})`,
        commissionRankOverrideUntil: null,
        commissionRankUpdatedAt: now,
      },
    },
  );
  if (result.modifiedCount) admin += 1;
}

console.log(JSON.stringify({ taggedAuto: auto, taggedAdminOverride: admin }, null, 1));
await mongoose.disconnect();
