import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { PartnersModel } from '../src/modules/identity-access/infrastructure/Auth.models.js';
import {
  GrowthCampaignModel,
  PartnerAllocationModel,
} from '../src/modules/campaigns/infrastructure/Campaign.models.js';
import {
  CommissionSaleModel,
  GrowthCommissionModel,
  MentorBonusModel,
} from '../src/modules/compensation/infrastructure/Compensation.models.js';
import {
  ActivationOrderModel,
  KycSubmissionModel,
} from '../src/modules/onboarding/infrastructure/Onboarding.models.js';
import { TransactionModel } from '../src/apps/transaction/models/transaction.model.js';

/**
 * Full money-path smoke test: signup attribution → KYC → activation →
 * campaign funding → allocation → commission release → mentor bonus.
 *
 * Requirements:
 *   - API running and reachable (default http://localhost:8080)
 *   - api/.env with working MONGODB_* credentials (same DB as the API)
 *   - A network that allows Atlas SRV DNS
 *
 * Usage (from `api/`):
 *   node scripts/smoke-compensation-flow.js
 *   node scripts/smoke-compensation-flow.js --api=http://localhost:8080
 *   node scripts/smoke-compensation-flow.js --keep          # keep test data
 *
 * Defaults: deletes the users/campaigns/orders it created on success.
 * On failure the test data is left in place and its identifiers are printed.
 */

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || 'true'];
  }),
);

const API = String(
  args.get('api')
  ?? process.env.SMOKE_API_URL
  ?? `http://localhost:${process.env.PORT || 8080}`,
).replace(/\/+$/, '');
const KEEP = args.has('keep');
const PASSWORD = 'SmokeTest123!';
const stamp = Date.now();
const suffix = String(stamp).slice(-8);

const campaignCode = `gc_smoke${suffix}`;
const emails = {
  admin: `smoke.admin.${stamp}@example.com`,
  owner: `smoke.owner.${stamp}@example.com`,
  member: `smoke.member.${stamp}@example.com`,
};
const usernames = {
  admin: `smokeadmin${suffix}`,
  owner: `smokeowner${suffix}`,
  member: `smokemember${suffix}`,
};
const phones = {
  admin: `+23480${suffix}1`,
  owner: `+23480${suffix}2`,
  member: `+23480${suffix}3`,
};

const ids = { admin: null, owner: null, member: null };
let campaignId = null;
let failed = false;

const c = {
  ok: (m) => console.log(`  \u2713 ${m}`),
  step: (m) => console.log(`\n\u25B6 ${m}`),
  fail: (m) => { failed = true; console.error(`  \u2717 ${m}`); },
  info: (m) => console.log(`    ${m}`),
};
const ngn = (v) => `\u20A6${Number(v ?? 0).toLocaleString('en-NG')}`;

const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
const database = process.env.MONGODB_DATABASE ?? '';
const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
const mongoUri = `mongodb+srv://${username}:${password}@${host}/${database}?retryWrites=true&w=majority`;

const parseBody = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await parseBody(res);
  if (!res.ok) {
    const message = typeof data === 'object' && data ? (data.message ?? JSON.stringify(data)) : String(data);
    throw new Error(`${method} /${path} \u2192 ${res.status}: ${message}`);
  }
  return data;
}

async function signin(email) {
  const res = await api('v1/auth/signin', { method: 'POST', body: { email, password: PASSWORD } });
  const token = res?.data?.token;
  if (!token) throw new Error(`Signin for ${email} returned no token`);
  return token;
}

async function createPartner({ email, username: user, phone, role = 'User', balance = 0, rank = 'Partner', name, surname }) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const doc = await PartnersModel.create({
    username: user,
    name,
    surname,
    email,
    phone,
    password: hash,
    tnc: true,
    emailVerified: true,
    emailVerifiedAt: now,
    accountState: 'partner',
    kycStatus: 'verified',
    kycVerifiedAt: now,
    activatedAt: now,
    balance,
    role,
    commissionRank: rank,
    address: { street: '1 Smoke Test Way', city: 'Lagos', state: 'Lagos', country: 'Nigeria' },
  });
  return String(doc._id);
}

async function findPartner(email) {
  const doc = await PartnersModel.findOne({ email }).select('_id').lean();
  return doc ? String(doc._id) : null;
}

async function cleanup() {
  c.step('Cleanup');
  const memberId = ids.member;
  const ownerId = ids.owner;
  const adminId = ids.admin;
  const campaignIds = ownerId
    ? (await GrowthCampaignModel.find({ ownerId }).select('_id').lean()).map((row) => row._id)
    : [];

  if (campaignIds.length) {
    await PartnerAllocationModel.deleteMany({ campaignId: { $in: campaignIds } });
    await GrowthCampaignModel.deleteMany({ _id: { $in: campaignIds } });
  }
  if (memberId) {
    await PartnerAllocationModel.deleteMany({ partnerId: memberId });
    await ActivationOrderModel.deleteMany({ partnerId: memberId });
    await KycSubmissionModel.deleteMany({ partnerId: memberId });
    await CommissionSaleModel.deleteMany({ partnerId: memberId });
    await GrowthCommissionModel.deleteMany({ $or: [{ partnerId: memberId }, { earnerId: ownerId ?? memberId }] });
    await MentorBonusModel.deleteMany({ activationPartnerId: memberId });
  }
  const partnerIds = [memberId, ownerId, adminId].filter(Boolean);
  if (partnerIds.length) {
    await TransactionModel.deleteMany({ partnerId: { $in: partnerIds } });
    await PartnersModel.deleteMany({ _id: { $in: partnerIds } });
  }
  c.ok('Test users, campaign, orders, commissions and ledger rows removed');
}

async function main() {
  if (!process.env.MONGODB_USERNAME || !process.env.MONGODB_PASSWORD || !database) {
    console.error('Missing MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE in api/.env');
    process.exit(2);
  }

  c.step(`Connecting to ${host}/${database}`);
  await mongoose.connect(mongoUri);
  c.ok('Mongo connected');

  c.step(`Checking API at ${API}`);
  const health = await fetch(`${API}/`).then((r) => r.text());
  if (!health.includes('Node server is up')) throw new Error(`Unexpected health response: ${health.slice(0, 80)}`);
  c.ok('API healthy');

  // 1. Admin + owner test identities (direct DB seed, verified).
  c.step('Create test identities');
  ids.admin = await createPartner({
    email: emails.admin, username: usernames.admin, phone: phones.admin,
    role: 'admin', balance: 0, name: 'Smoke', surname: 'Admin',
  });
  ids.owner = await createPartner({
    email: emails.owner, username: usernames.owner, phone: phones.owner,
    balance: 100000, name: 'Smoke', surname: 'Owner',
  });
  const adminToken = await signin(emails.admin);
  const ownerToken = await signin(emails.owner);
  c.ok(`Admin and owner ready (${ids.admin}, ${ids.owner})`);

  // 2. Member signup through the public API, carrying a campaign code.
  c.step('Signup with campaign attribution');
  await api('v1/auth/signup', {
    method: 'POST',
    body: {
      name: 'Smoke', surname: 'Member', email: emails.member, phone: phones.member,
      password: PASSWORD, tnc: true, campaign: campaignCode,
    },
  });
  ids.member = await findPartner(emails.member);
  if (!ids.member) throw new Error('Signup did not create a partner');
  const signupDoc = await PartnersModel.findById(ids.member).select('campaignCode emailVerified').lean();
  if (signupDoc?.campaignCode !== campaignCode) {
    throw new Error(`campaignCode not persisted (got ${signupDoc?.campaignCode ?? 'null'})`);
  }
  c.ok(`Partner created with campaignCode ${campaignCode}`);

  // Bypass the email link (the script has no inbox access).
  await PartnersModel.updateOne(
    { _id: ids.member },
    { $set: { emailVerified: true, emailVerifiedAt: new Date() }, $unset: { emailVerificationTokenHash: '', emailVerificationExpires: '' } },
  );
  const memberToken = await signin(emails.member);
  c.ok('Member signed in after email verification');

  // 3. KYC + wallet funding + activation order.
  c.step('KYC and activation');
  await api('v1/onboarding/kyc', { method: 'POST', token: memberToken, body: {} });
  const products = await api('v1/onboarding/products', { token: memberToken });
  const product = products.data?.[0];
  if (!product) throw new Error('No starter product found');

  await PartnersModel.updateOne({ _id: ids.member }, { $set: { balance: Number(product.price) + 20000 } });
  const orderRes = await api('v1/onboarding/orders', {
    method: 'POST', token: memberToken,
    body: {
      productId: product.id,
      shipping: {
        fullName: 'Smoke Member', phone: phones.member, street: '1 Smoke Test Way',
        city: 'Lagos', state: 'Lagos', country: 'Nigeria',
      },
      idempotencyKey: `smoke-${stamp}-activation`,
    },
  });
  if (orderRes.data?.order?.status !== 'Paid') throw new Error('Activation order was not paid');
  c.ok(`Activated with ${product.name} (${ngn(orderRes.data.order.amount)})`);

  // 4. Fund and activate an owner campaign.
  c.step('Fund and activate a growth campaign');
  const created = await api('v1/campaigns', {
    method: 'POST', token: ownerToken,
    body: {
      name: `Smoke campaign ${stamp}`, category: 'Network marketing', brief: 'Automated smoke test',
      budgetAmount: 20000, capacityTotal: 2, maxPerWeek: 2, targetStates: [],
      ageRange: 'All', gender: 'All', startAt: new Date(Date.now() - 60000).toISOString(),
    },
  });
  campaignId = created.data?.id;
  if (!campaignId) throw new Error('Campaign was not created');
  await api(`v1/admin/campaigns/${campaignId}/activate`, { method: 'POST', token: adminToken });
  c.ok(`Campaign ${campaignId} active`);

  // 5. Allocate the activated member to the campaign owner.
  c.step('Run fair allocation');
  const alloc = await api('v1/admin/campaigns/allocate', {
    method: 'POST', token: adminToken, body: { campaignId, limit: 10 },
  });
  const allocatedIds = (alloc.data?.allocated ?? []).map((row) => String(row.partner?.id));
  if (!allocatedIds.includes(ids.member)) {
    throw new Error(`Member was not allocated (allocated: ${allocatedIds.join(', ') || 'none'})`);
  }
  const mine = await api('v1/campaigns/me/allocation', { token: memberToken });
  if (mine.data?.allocation?.owner?.id !== ids.owner) {
    throw new Error('Member allocation does not point at the test owner');
  }
  c.ok(`Member placed under owner (score ${mine.data.allocation.score?.total ?? '—'})`);

  // 6. Release the owner's level-1 commission.
  c.step('Release commission');
  const entries = await api('v1/admin/compensation/entries?status=Pending&limit=100', { token: adminToken });
  const ownerEntry = (entries.data ?? []).find((row) => row.earner?.id === ids.owner);
  if (!ownerEntry) throw new Error('No pending commission entry for the owner');
  const released = await api(`v1/admin/compensation/entries/${ownerEntry.id}/release`, {
    method: 'POST', token: adminToken,
  });
  if (released.data?.entry?.status !== 'Released') throw new Error('Commission did not release');
  const ownerComp = await api('v1/compensation/me', { token: ownerToken });
  const releasedTotal = Number(ownerComp.data?.summary?.released ?? 0);
  c.ok(`Commission ${ngn(ownerEntry.amount)} released (owner released total ${ngn(releasedTotal)})`);

  // 7. Mentor bonus is immediate; if a legacy scheduled row remains, force it due and run the sweep.
  c.step('Mentor bonus');
  let bonus = await MentorBonusModel.findOne({
    activationPartnerId: ids.member,
    status: 'paid',
  }).lean();
  if (!bonus) {
    const dueAt = await MentorBonusModel.findOneAndUpdate(
      { activationPartnerId: ids.member, status: 'scheduled', mentorId: { $ne: null } },
      { $set: { dueAt: new Date(Date.now() - 60000) } },
      { new: true },
    ).lean();
    if (!dueAt) throw new Error('No scheduled or paid mentor bonus was found');
    const run = await api('v1/admin/compensation/mentor-bonuses/run', { method: 'POST', token: adminToken });
    if (Number(run.data?.paid ?? 0) < 1) throw new Error(`Mentor bonus not paid (result ${JSON.stringify(run.data)})`);
    bonus = await MentorBonusModel.findById(dueAt._id).lean();
  }
  if (bonus?.status !== 'paid') throw new Error(`Mentor bonus status is ${bonus?.status}`);
  c.ok(`Mentor bonus ${ngn(bonus.amount)} paid to owner`);

  // 8. Attribution reporting endpoint.
  c.step('Attribution report');
  const attribution = await api('v1/admin/campaigns/attribution?limit=200', { token: adminToken });
  const row = (attribution.data ?? []).find((r) => r.campaignCode === campaignCode);
  if (!row) throw new Error('Attribution report does not include the test campaign code');
  if (Number(row.signups) < 1) throw new Error('Attribution report shows no signups');
  c.ok(`Attribution: ${row.signups} signup(s), ${row.activated} activated`);

  c.step('All checks passed');
}

const run = async () => {
  try {
    await main();
  } catch (error) {
    failed = true;
    console.error(`\n\u2717 Smoke test failed: ${error?.message ?? error}`);
    console.error('  Test identifiers:', {
      admin: ids.admin, owner: ids.owner, member: ids.member, campaignId, campaignCode,
    });
    console.error('  Data was left in place for inspection. Re-run with a fresh stamp to retry.');
  } finally {
    if (!failed && !KEEP) {
      try { await cleanup(); } catch (error) {
        console.error('Cleanup failed:', error?.message ?? error);
      }
    } else if (KEEP) {
      console.log('\nKeeping test data (--keep).');
      console.log('  Identifiers:', { admin: ids.admin, owner: ids.owner, member: ids.member, campaignId, campaignCode });
    }
    await mongoose.disconnect().catch(() => null);
    process.exit(failed ? 1 : 0);
  }
};

run();
