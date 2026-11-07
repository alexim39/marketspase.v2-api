import mongoose from 'mongoose';

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

export const MONGO_QUERY_TIMEOUT_MS = timeoutMs;
