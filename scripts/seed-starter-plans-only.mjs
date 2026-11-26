import 'dotenv/config';
import mongoose from 'mongoose';
import { StarterProductModel } from '../src/modules/onboarding/infrastructure/Onboarding.models.js';
import { STARTER_PRODUCTS } from '../src/modules/onboarding/domain/StarterProduct.js';

/**
 * Upsert ONLY the activation plans. Does not touch resale products or upload
 * media, so it is safe to run on its own after the plan definitions change.
 *
 * Usage from api/:
 *   node scripts/seed-starter-plans-only.mjs          # dry run
 *   APPLY=1 node scripts/seed-starter-plans-only.mjs  # write
 */

const APPLY = process.env.APPLY === '1';
const database = String(process.env.MONGODB_DATABASE ?? '').trim();
const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${username}:${password}@${host}/${database}?retryWrites=true&w=majority`;

const view = (plan) => ({
  sku: plan.sku,
  tier: plan.tier,
  name: plan.name,
  price: plan.price,
  cogs: plan.cogs,
  shippingCost: plan.shippingCost,
  mentorBonus: plan.mentorBonus,
  upgradeCredit: plan.upgradeCredit,
  imageCount: plan.images?.length ?? 0,
  active: plan.active,
  sortOrder: plan.sortOrder,
});

if (!APPLY) {
  console.log(JSON.stringify({
    mode: 'dry-run (set APPLY=1 to write)',
    database,
    plans: STARTER_PRODUCTS.map(view),
  }, null, 2));
  process.exit(0);
}

await mongoose.connect(uri);
const written = [];
for (const plan of STARTER_PRODUCTS) {
  // Spread: Mongoose casts update objects in place and the domain objects
  // are frozen, so passing the frozen object directly silently drops fields.
  const doc = await StarterProductModel.findOneAndUpdate(
    { sku: plan.sku },
    { $set: { ...plan } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  written.push({
    sku: doc.sku,
    tier: doc.tier,
    name: doc.name,
    price: doc.price,
    active: doc.active,
    cogs: doc.cogs,
    shippingCost: doc.shippingCost,
    mentorBonus: doc.mentorBonus,
    upgradeCredit: doc.upgradeCredit,
    imageCount: doc.images?.length ?? 0,
    sortOrder: doc.sortOrder,
  });
}

console.log(JSON.stringify({ mode: 'apply', database, plans: written }, null, 2));
await mongoose.connection.close(false);
