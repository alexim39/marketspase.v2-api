import mongoose from 'mongoose';

/**
 * Initialize a single-node MongoDB replica set for CI.
 *
 * The application uses transactions, which require a replica set (or mongos).
 * The GitHub Actions `mongo:7` service starts as a standalone by default, so
 * this script initiates `rs0` and waits for the node to become primary.
 *
 * Usage:
 *   MONGODB_ADMIN_URI=mongodb://127.0.0.1:27017/admin?directConnection=true \
 *     node scripts/ci-init-mongo-replica.js
 */

const uri = process.env.MONGODB_ADMIN_URI
  || 'mongodb://127.0.0.1:27017/admin?directConnection=true';
const replSetName = process.env.MONGODB_REPLSET_NAME || 'rs0';
const host = process.env.MONGODB_REPLSET_HOST || '127.0.0.1:27017';
const timeoutMs = Number(process.env.MONGODB_REPLSET_TIMEOUT_MS || 60000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  await mongoose.connect(uri);
  const admin = mongoose.connection.db.admin();

  try {
    await admin.command({
      replSetInitiate: {
        _id: replSetName,
        members: [{ _id: 0, host }],
      },
    });
    console.log(`[ci-mongo] initiated replica set ${replSetName}`);
  } catch (error) {
    if (error?.codeName === 'AlreadyInitialized' || error?.code === 23) {
      console.log(`[ci-mongo] replica set ${replSetName} already initialized`);
    } else {
      throw error;
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const hello = await admin.command({ hello: 1 });
      if (hello.isWritablePrimary) {
        console.log('[ci-mongo] node is primary');
        await mongoose.disconnect();
        return;
      }
    } catch {
      // The node can briefly reject commands while it elects itself.
    }
    await sleep(1000);
  }

  await mongoose.disconnect();
  throw new Error(`Replica set ${replSetName} did not become primary within ${timeoutMs}ms`);
};

main().catch(async (error) => {
  console.error('[ci-mongo] failed:', error?.stack ?? error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
