#!/usr/bin/env node
/**
 * Read-only single-upline audit.
 *
 * Verifies that `partnerOf` is the only upline edge after the migration:
 *   - no legacy parent field remains in partners, commission sales or queue,
 *   - every non-null partnerOf points to an existing partner,
 *   - no self-references or cycles,
 *   - reports chain depth and unplaced/system-owned counts.
 *
 * Exits 1 when a hard problem is found, so it can gate a deploy or run in CI.
 *
 *   npm run audit:upline
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

const LEGACY_FIELD = ['placementParent', 'Id'].join('');
const MAX_CHAIN = 32;

const fail = (message) => {
  console.error(`[upline] ${message}`);
  process.exit(1);
};

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1, autoIndex: false });
const db = mongoose.connection.db;

try {
  const [legacyPartners, legacySales, legacyQueue] = await Promise.all([
    db.collection('partners').countDocuments({ [LEGACY_FIELD]: { $exists: true } }),
    db.collection('commission_sales').countDocuments({ [LEGACY_FIELD]: { $exists: true } }),
    db.collection('activation_queue').countDocuments({ [LEGACY_FIELD]: { $exists: true } }),
  ]);

  const partners = await db.collection('partners').find(
    {},
    { projection: { username: 1, partnerOf: 1, systemOwned: 1 } },
  ).toArray();

  const byId = new Map(partners.map((p) => [String(p._id), p]));
  const problems = { selfReferences: [], dangling: [], cycles: [] };
  const parentOf = (p) => (p.partnerOf ? String(p.partnerOf) : null);

  let placed = 0;
  let unplaced = 0;
  let systemOwned = 0;
  for (const partner of partners) {
    if (partner.systemOwned) systemOwned += 1;
    const parent = parentOf(partner);
    if (!parent) {
      unplaced += 1;
      continue;
    }
    placed += 1;
    if (parent === String(partner._id)) problems.selfReferences.push(partner.username ?? String(partner._id));
    else if (!byId.has(parent)) problems.dangling.push({ username: partner.username ?? String(partner._id), partnerOf: parent });
  }

  // 0 = unvisited, 1 = in the current walk, 2 = done.
  const state = new Map();
  let maxDepth = 0;
  for (const partner of partners) {
    if (state.get(String(partner._id)) === 2) continue;
    const path = [];
    let current = partner;
    while (current) {
      const id = String(current._id);
      if (state.get(id) === 1) {
        const cycle = [...path.slice(path.indexOf(id)), id].map((x) => byId.get(x)?.username ?? x);
        problems.cycles.push(cycle.join(' -> '));
        break;
      }
      if (state.get(id) === 2) break;
      state.set(id, 1);
      path.push(id);
      const parent = parentOf(current);
      current = parent ? byId.get(parent) : null;
      if (path.length > MAX_CHAIN) break;
    }
    for (const id of path) state.set(id, 2);
    maxDepth = Math.max(maxDepth, path.length);
  }

  const hardFailures = legacyPartners + legacySales + legacyQueue
    + problems.selfReferences.length + problems.dangling.length + problems.cycles.length;

  const report = {
    mode: 'read-only',
    partners: {
      total: partners.length,
      placed,
      unplaced,
      systemOwned,
      referralOnly: partners.filter((p) => p.partnerOf && !p.systemOwned).length,
    },
    legacyField: {
      partners: legacyPartners,
      commissionSales: legacySales,
      activationQueue: legacyQueue,
    },
    graph: {
      maxChain: maxDepth,
      selfReferences: problems.selfReferences,
      dangling: problems.dangling,
      cycles: problems.cycles,
    },
    ok: hardFailures === 0,
  };

  console.log(JSON.stringify(report, null, 1));
  if (hardFailures > 0) fail('single-upline audit failed; fix the rows above before deploying.');
  console.log('[upline] OK — partnerOf is the only upline edge.');
} finally {
  await mongoose.disconnect();
}
