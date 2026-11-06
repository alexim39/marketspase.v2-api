import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { PartnersModel } from '../src/modules/identity-access/infrastructure/Auth.models.js';
import { TransactionModel } from '../src/apps/transaction/models/transaction.model.js';
import {
  PlatformSettingModel,
  StoreEscrowLedgerModel,
  StoreInventoryModel,
  StoreModel,
  StoreOrderModel,
  StoreProductModel,
  StoreStockLedgerModel,
} from '../src/modules/stores/infrastructure/Store.models.js';

/**
 * Idempotent fixtures for the commerce smoke test.
 * Refuses to run unless MONGODB_DATABASE contains "e2e" or "test".
 *
 * Usage from api/:
 *   MONGODB_DATABASE=marketspaseV2_e2e node scripts/seed-store-e2e.js
 */

const database = String(process.env.MONGODB_DATABASE ?? '').trim();
if (!/e2e|test/i.test(database)) {
  console.error(`Refusing to seed "${database || '(empty database)'}" - the database name must contain e2e or test.`);
  process.exit(2);
}

const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
const mongoUri = `mongodb+srv://${username}:${password}@${host}/${database}?retryWrites=true&w=majority`;

const OWNER_EMAIL = 'store.owner.e2e@marketspase.test';
const ADMIN_EMAIL = 'store.admin.e2e@marketspase.test';
const OWNER_PASSWORD = 'E2eStore!2345';
const ADMIN_PASSWORD = 'E2eAdmin!2345';
const STORE_SLUG = 'e2e-store';
const PRODUCT_ID = new mongoose.Types.ObjectId('64b000000000000000000001');

const upsertPartner = async ({ email, password, username: partnerUsername, name, surname, phone, role }) => {
  const hash = await bcrypt.hash(password, 10);
  return PartnersModel.findOneAndUpdate(
    { email },
    {
      $set: {
        username: partnerUsername,
        name,
        surname,
        email,
        phone,
        password: hash,
        role,
        status: true,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        accountState: 'partner',
        kycStatus: 'verified',
        kycVerifiedAt: new Date(),
        activatedAt: new Date(),
        commissionRank: 'Partner',
        balance: 0,
        suspendedAt: null,
        suspendReason: null,
      },
      $setOnInsert: { tnc: true },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
};

const main = async () => {
  await mongoose.connect(mongoUri);
  console.log(`[seed-store-e2e] connected to ${host}/${database}`);

  const owner = await upsertPartner({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    username: 'e2eowner',
    name: 'E2E',
    surname: 'Owner',
    phone: '08030000001',
    role: 'User',
  });
  const admin = await upsertPartner({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    username: 'e2eadmin',
    name: 'E2E',
    surname: 'Admin',
    phone: '08030000002',
    role: 'Admin',
  });

  const store = await StoreModel.findOneAndUpdate(
    { slug: STORE_SLUG },
    {
      $set: {
        partnerId: owner._id,
        name: 'E2E Store',
        tagline: 'Commerce smoke-test storefront',
        bio: 'Temporary store used by the MarketSpase commerce smoke test.',
        deliveryFee: 1500,
        status: 'published',
        autoPublish: true,
        deliveryNote: 'Test delivery only',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const storeProduct = await StoreProductModel.findOneAndUpdate(
    { storeId: store._id, productId: PRODUCT_ID },
    {
      $set: {
        partnerId: owner._id,
        name: 'E2E Test Product',
        image: '',
        category: 'Essentials',
        shortDesc: 'A product used only by the local commerce smoke test.',
        description: 'No real fulfilment is required for this test listing.',
        retailPrice: 10000,
        stock: 20,
        soldCount: 0,
        status: 'published',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  await StoreInventoryModel.findOneAndUpdate(
    { partnerId: owner._id, productId: PRODUCT_ID },
    { $set: { quantity: 100 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await PlatformSettingModel.findOneAndUpdate(
    { key: 'store' },
    { $set: { storeServiceFeePercent: 2, storeEscrowHoldDays: 7 }, $setOnInsert: { key: 'store' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Clear previous smoke orders/ledgers for this owner and store only.
  await StoreOrderModel.deleteMany({ partnerId: owner._id });
  await StoreEscrowLedgerModel.deleteMany({ partnerId: owner._id });
  await StoreStockLedgerModel.deleteMany({ partnerId: owner._id });
  await TransactionModel.deleteMany({ partnerId: owner._id, paymentMethod: 'Store sale' });

  const result = {
    database,
    owner: {
      id: String(owner._id),
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    },
    admin: {
      id: String(admin._id),
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
    store: {
      id: String(store._id),
      slug: STORE_SLUG,
      url: `http://localhost:4201/${STORE_SLUG}`,
    },
    product: {
      id: String(storeProduct._id),
      productId: String(PRODUCT_ID),
      name: storeProduct.name,
      retailPrice: storeProduct.retailPrice,
      deliveryFee: store.deliveryFee,
    },
  };
  console.log(JSON.stringify(result, null, 2));

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('[seed-store-e2e] failed:', error?.stack ?? error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
