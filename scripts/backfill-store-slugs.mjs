import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Store slug / in-stock backfill.
 *
 * - partners.storeSlug mirrors the canonical store slug
 * - stores.inStockCount powers the directory freshness flag
 *
 * Dry-run: node scripts/backfill-store-slugs.mjs
 * Apply:   APPLY=1 node scripts/backfill-store-slugs.mjs
 */
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1, autoIndex: false });
const db = mongoose.connection.db;
const stores = db.collection('stores');
const products = db.collection('store_products');
const partners = db.collection('partners');

const rows = await stores.find({}).project({ slug: 1, partnerId: 1 }).toArray();
let slugs = 0;
let counts = 0;
for (const store of rows) {
  if (store.partnerId && store.slug) {
    slugs += 1;
    if (process.env.APPLY === '1') {
      await partners.updateOne({ _id: store.partnerId }, { $set: { storeSlug: store.slug } });
    }
  }
  const inStock = await products.countDocuments({
    storeId: store._id,
    status: 'published',
    stock: { $gt: 0 },
  });
  counts += 1;
  if (process.env.APPLY === '1') {
    await stores.updateOne({ _id: store._id }, { $set: { inStockCount: inStock } });
  }
}

console.log(JSON.stringify({
  mode: process.env.APPLY === '1' ? 'apply' : 'dry-run',
  stores: rows.length,
  partnerSlugs: slugs,
  stockCounts: counts,
}, null, 2));

await mongoose.disconnect();
