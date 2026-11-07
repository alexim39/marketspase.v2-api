import mongoose from 'mongoose';
import { recordSlowQuery } from '../observability/slowQueries.js';

const timeoutMs = Math.max(250, Number(process.env.MONGO_QUERY_TIMEOUT_MS || 2000));

const skip = (query) => {
  const options = query?.getOptions?.() ?? {};
  return options.skipTimeout === true || options.maxTimeMS !== undefined;
};

const apply = (query) => {
  if (!skip(query)) query.maxTimeMS(timeoutMs);
};

/**
 * Global request-path query cap. Applied before model compilation so every
 * model inherits it. Jobs/legacy code can opt out per query with
 * `{ skipTimeout: true }` or supply their own `maxTimeMS`.
 */
export const queryTimeoutPlugin = (schema) => {
  schema.pre(/^find/, function preFindTimeout() { apply(this); });
  schema.pre('countDocuments', function preCountTimeout() { apply(this); });
  schema.pre('estimatedDocumentCount', function preEstimatedTimeout() { apply(this); });
  schema.pre('findOneAndUpdate', function preFindUpdateTimeout() { apply(this); });
  schema.pre('updateOne', function preUpdateTimeout() { apply(this); });
  schema.pre('updateMany', function preUpdateManyTimeout() { apply(this); });
  schema.pre('deleteOne', function preDeleteTimeout() { apply(this); });
  schema.pre('deleteMany', function preDeleteManyTimeout() { apply(this); });
  schema.pre('aggregate', function preAggregateTimeout() {
    const options = this.options ?? {};
    if (options.skipTimeout !== true && options.maxTimeMS === undefined) {
      this.option({ maxTimeMS: timeoutMs });
    }
  });
};

mongoose.plugin(queryTimeoutPlugin);

const SLOW_HOOKS = /^(find|findOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|updateOne|updateMany|deleteOne|deleteMany|replaceOne|countDocuments|estimatedDocumentCount)/;

const collectionName = (ctx) => ctx?.model?.collection?.name
  ?? ctx?.mongooseCollection?.name
  ?? ctx?._model?.collection?.name
  ?? 'unknown';

/**
 * Wall-clock timing for every Mongoose read/write/aggregate. Only samples
 * above `MONGO_SLOW_QUERY_MS` are logged, so normal traffic pays just two
 * hook calls. Filters and documents are never touched.
 */
export const slowQueryPlugin = (schema) => {
  schema.pre(SLOW_HOOKS, function markSlowQueryStart() {
    this.__marketspaseQueryStartedAt = process.hrtime.bigint();
  });
  schema.post(SLOW_HOOKS, function reportSlowQuery() {
    const startedAt = this.__marketspaseQueryStartedAt;
    if (!startedAt) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordSlowQuery({ collection: collectionName(this), op: this.op, durationMs });
  });
  schema.pre('aggregate', function markSlowAggregateStart() {
    this.__marketspaseQueryStartedAt = process.hrtime.bigint();
  });
  schema.post('aggregate', function reportSlowAggregate() {
    const startedAt = this.__marketspaseQueryStartedAt;
    if (!startedAt) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordSlowQuery({ collection: collectionName(this), op: 'aggregate', durationMs });
  });
};

mongoose.plugin(slowQueryPlugin);

export const MONGO_QUERY_TIMEOUT_MS = timeoutMs;
