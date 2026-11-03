import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ProgressionModel } from '../modules/progression/infrastructure/Progression.mongo.repository.js';

/**
 * One-shot grandfather for training confirmation.
 * Stamps confirmedAt/confirmedBy(null = system) on every ipo/qsg/smo
 * already marked done, so pre-existing completions keep opening gates
 * after the confirmation reform. Only NEW marks enter the upline path.
 * Idempotent and rerun-safe: skips stamps that already carry confirmedAt.
 *
 * Run manually once (NOT on boot):
 *   node src/jobs/backfill-training-confirmed.js
 */
const KEYS = ['ipo', 'qsg', 'smo'];

export async function backfillTrainingConfirmed({ progressions = ProgressionModel, batchSize = 500, logger = console } = {}) {
  const size = Math.min(Math.max(Number(batchSize) || 500, 1), 5000);
  let processed = 0;
  let stamped = 0;
  let cursor = null;
  for (;;) {
    const filter = {
      $or: KEYS.map((k) => ({ [`${k}.done`]: true, [`${k}.confirmedAt`]: null })),
    };
    if (cursor) filter._id = { $gt: cursor };
    const docs = await progressions
      .find(filter)
      .select('_id ipo qsg smo')
      .sort({ _id: 1 })
      .limit(size)
      .lean();
    if (docs.length === 0) break;
    const ops = [];
    const at = new Date();
    for (const d of docs) {
      const set = {};
      for (const k of KEYS) {
        if (d[k]?.done === true && d[k]?.confirmedAt == null) {
          set[`${k}.confirmedAt`] = at;
        }
      }
      if (Object.keys(set).length > 0) {
        ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
      }
    }
    if (ops.length > 0) {
      const res = await progressions.bulkWrite(ops, { ordered: false });
      stamped += res.modifiedCount ?? ops.length;
    }
    processed += docs.length;
    cursor = docs[docs.length - 1]._id;
    logger.log?.(`[backfill-training] processed=${processed} stamped=${stamped}`);
  }
  return { processed, stamped };
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  dotenv.config();
  mongoose
    .connect(`mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.buvy2cx.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`)
    .then(() => backfillTrainingConfirmed())
    .then(
      (r) => { console.log('[backfill-training] done', r); process.exit(0); },
      (e) => { console.error('[backfill-training] failed', e?.message ?? e); process.exit(1); },
    );
}
