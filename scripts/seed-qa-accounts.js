import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { PartnersModel } from '../src/modules/identity-access/infrastructure/Auth.models.js';
import { TransactionModel } from '../src/apps/transaction/models/transaction.model.js';
import {
  ActivationOrderModel,
  ActivationQueueEntryModel,
  KycSubmissionModel,
} from '../src/modules/onboarding/infrastructure/Onboarding.models.js';
import {
  CommissionSaleModel,
  GrowthCommissionModel,
  MentorBonusModel,
} from '../src/modules/compensation/infrastructure/Compensation.models.js';

/**
 * Idempotent QA fixtures for the dual activation plans, the network upline
 * card and the admin Ora/roles desks.
 *
 * Safety: APPLY refuses to write unless the database name looks disposable
 * (test/dev/e2e/staging/local) or ALLOW_NON_TEST_DB=1 is set.
 *
 * Usage from api/:
 *   node scripts/seed-qa-accounts.js                                  # dry run
 *   APPLY=1 node scripts/seed-qa-accounts.js                          # create/reset
 *   CLEANUP=1 node scripts/seed-qa-accounts.js                        # delete fixtures
 *   ALLOW_NON_TEST_DB=1 APPLY=1 node scripts/seed-qa-accounts.js      # explicit override
 *
 * The accounts persist until CLEANUP=1. Re-running APPLY resets their wallet,
 * activation, orders, commissions and queue state to the values below.
 */

const APPLY = process.env.APPLY === '1';
const CLEANUP = process.env.CLEANUP === '1';
const database = String(process.env.MONGODB_DATABASE ?? '').trim();
const disposableDb = /(test|dev|e2e|staging|local)/i.test(database);
const override = process.env.ALLOW_NON_TEST_DB === '1';

const ACCOUNTS = [
  {
    key: 'admin',
    email: 'qa.admin@marketspase.test',
    password: 'QaAdmin!2345',
    username: 'qaadmin',
    name: 'QA',
    surname: 'Admin',
    phone: '08039000001',
    role: 'Admin',
    accountState: 'partner',
    tier: 'signature',
    rank: 'Ambassador',
    balance: 0,
    bonusBalance: 0,
    sponsor: null,
    purpose: 'Admin desks: /roles member dialog, /ora drawer, activation reporting.',
  },
  {
    key: 'upline',
    email: 'qa.upline@marketspase.test',
    password: 'QaUpline!2345',
    username: 'qaupline',
    name: 'QA',
    surname: 'Upline',
    phone: '08039000002',
    role: 'User',
    accountState: 'partner',
    tier: 'signature',
    rank: 'Leader',
    balance: 0,
    bonusBalance: 0,
    sponsor: null,
    purpose: 'Shown as the immediate upline on the network tree/org chart.',
  },
  {
    key: 'member',
    email: 'qa.member@marketspase.test',
    password: 'QaMember!2345',
    username: 'qamember',
    name: 'QA',
    surname: 'Member',
    phone: '08039000003',
    role: 'User',
    accountState: 'member',
    tier: null,
    rank: 'Partner',
    balance: 60000,
    bonusBalance: 5000,
    sponsor: 'upline',
    purpose: 'Activate Essential or Signature, then test the lifetime upgrade and the upline card.',
  },
  {
    key: 'blocked',
    email: 'qa.blocked@marketspase.test',
    password: 'QaBlocked!2345',
    username: 'qablocked',
    name: 'QA',
    surname: 'Blocked',
    phone: '08039000004',
    role: 'User',
    accountState: 'member',
    tier: null,
    rank: 'Partner',
    balance: 10000,
    bonusBalance: 5000,
    sponsor: null,
    purpose: 'Cash-only rule: total ₦15,000 but only ₦10,000 cash, so Essential ₦12,500 is blocked.',
  },
];

const publicView = (account) => ({
  email: account.email,
  password: account.password,
  role: account.role,
  state: account.accountState,
  plan: account.tier ?? 'not activated',
  rank: account.rank,
  wallet: account.balance,
  bonus: account.bonusBalance,
  purpose: account.purpose,
});

if (!APPLY && !CLEANUP) {
  console.log(JSON.stringify({
    mode: 'dry-run (set APPLY=1 to create/reset, CLEANUP=1 to delete)',
    database,
    disposableDatabase: disposableDb,
    warning: disposableDb
      ? null
      : 'APPLY will refuse this database unless ALLOW_NON_TEST_DB=1 is set.',
    accounts: ACCOUNTS.map(publicView),
    lifecycle: 'Accounts persist until CLEANUP=1. APPLY resets them to the values above.',
  }, null, 2));
  process.exit(0);
}

if (APPLY && !disposableDb && !override) {
  console.error(
    `Refusing to write QA accounts to "${database}". `
    + 'Use a test/dev/e2e/staging database, or set ALLOW_NON_TEST_DB=1 only if this environment is disposable.',
  );
  process.exit(2);
}

const encodedUser = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
const encodedPass = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${encodedUser}:${encodedPass}@${host}/${database}?retryWrites=true&w=majority`;

const emails = ACCOUNTS.map((account) => account.email);

const clearFixtures = async (ids) => {
  if (ids.length === 0) return;
  await ActivationOrderModel.deleteMany({ partnerId: { $in: ids } });
  await ActivationQueueEntryModel.deleteMany({ partnerId: { $in: ids } });
  await KycSubmissionModel.deleteMany({ partnerId: { $in: ids } });
  await CommissionSaleModel.deleteMany({ partnerId: { $in: ids } });
  await GrowthCommissionModel.deleteMany({
    $or: [{ partnerId: { $in: ids } }, { earnerId: { $in: ids } }],
  });
  await MentorBonusModel.deleteMany({
    $or: [{ activationPartnerId: { $in: ids } }, { mentorId: { $in: ids } }],
  });
  await TransactionModel.deleteMany({ partnerId: { $in: ids } });
};

const upsertAccount = async (account, sponsorId) => {
  const now = new Date();
  const password = await bcrypt.hash(account.password, 10);
  const set = {
    username: account.username,
    name: account.name,
    surname: account.surname,
    email: account.email,
    phone: account.phone,
    password,
    role: account.role,
    status: true,
    emailVerified: true,
    emailVerifiedAt: now,
    tnc: true,
    accountState: account.accountState,
    kycStatus: 'verified',
    kycVerifiedAt: now,
    suspendedAt: null,
    suspendReason: null,
    commissionRank: account.rank,
    commissionRankSource: 'admin',
    commissionRankReason: 'QA seed',
    commissionRankOverrideUntil: null,
    balance: account.balance,
    bonusBalance: account.bonusBalance,
    partnerOf: sponsorId ?? null,
    systemOwned: !sponsorId,
    placementCampaignId: null,
    placedAt: null,
  };
  const unset = {};
  if (account.accountState === 'partner') {
    set.activatedAt = now;
    set.activationTier = account.tier;
    set.upgradedAt = account.tier === 'signature' ? now : null;
  } else {
    unset.activatedAt = '';
    unset.activationTier = '';
    unset.activationOrderId = '';
    unset.upgradedAt = '';
    unset.upgradeOrderId = '';
  }

  const update = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return PartnersModel.findOneAndUpdate(
    { email: account.email },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
};

const main = async () => {
  await mongoose.connect(uri);

  const existing = await PartnersModel.find({ email: { $in: emails } }).select('_id').lean();
  const ids = existing.map((row) => row._id);
  await clearFixtures(ids);

  if (CLEANUP) {
    if (ids.length > 0) await PartnersModel.deleteMany({ _id: { $in: ids } });
    console.log(JSON.stringify({
      mode: 'cleanup',
      database,
      removed: ids.length,
      emails,
    }, null, 2));
    await mongoose.connection.close(false);
    return;
  }

  const created = {};
  for (const account of ACCOUNTS) {
    const sponsor = account.sponsor ? created[account.sponsor] : null;
    created[account.key] = await upsertAccount(account, sponsor?._id ?? null);
  }

  console.log(JSON.stringify({
    mode: 'apply',
    database,
    accounts: ACCOUNTS.map((account) => ({
      ...publicView(account),
      id: String(created[account.key]._id),
    })),
    lifecycle: 'Persist until CLEANUP=1. APPLY resets them to these values.',
    loginUrls: {
      platform: 'http://localhost:4200/partner/signin',
      admin: 'http://localhost:4202/signin',
    },
  }, null, 2));

  await mongoose.connection.close(false);
};

main().catch(async (error) => {
  console.error('[seed-qa-accounts] failed:', error?.message ?? error);
  await mongoose.connection.close(false).catch(() => null);
  process.exit(1);
});
