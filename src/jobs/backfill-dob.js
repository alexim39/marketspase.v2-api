import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PartnersModel, dobParts } from '../apps/partner/models/partner.model.js';

/**
 * One-shot backfill for derived birthday parts (R6 follow-up).
 * Idempotent and rerun-safe: only touches docs that have a DoB but no
 * derived parts yet; invalid dates are counted and left for review.
 *
 * Run manually once (NOT on boot):
 *   node src/jobs/backfill-dob.js
 */
export async function backfillDobParts({ partners = PartnersModel, batchSize = 500, logger = console } = {}) {
  const size = Math.min(Math.max(Number(batchSize) || 500, 1), 5000);
  let processed = 0;
  let stamped = 0;
  let skipped = 0;
  let cursor = null;
  for (;;) {
    const filter = { dobDatePicker: { $ne: null }, dobMonth: { $exists: false } };
    if (cursor) filter._id = { $gt: cursor };
    const docs = await partners
      .find(filter)
      .select('_id dobDatePicker')
      .sort({ _id: 1 })
      .limit(size)
      .lean();
    if (docs.length === 0) break;
    const ops = [];
    for (const d of docs) {
      const { dobMonth, dobDay } = dobParts(d.dobDatePicker);
      if (dobMonth == null) {
        skipped += 1;
        continue;
      }
      ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { dobMonth, dobDay } } } });
    }
    if (ops.length > 0) {
      const res = await partners.bulkWrite(ops, { ordered: false });
      stamped += res.modifiedCount ?? ops.length;
    }
    processed += docs.length;
    cursor = docs[docs.length - 1]._id;
    logger.log?.(`[backfill-dob] processed=${processed} stamped=${stamped} skipped=${skipped}`);
  }
  return { processed, stamped, skipped };
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  dotenv.config();
  mongoose
    .connect(`mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.buvy2cx.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`)
    .then(() => backfillDobParts())
    .then(
      (r) => { console.log('[backfill-dob] done', r); process.exit(0); },
      (e) => { console.error('[backfill-dob] failed', e?.message ?? e); process.exit(1); },
    );
}
