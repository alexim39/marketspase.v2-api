import 'dotenv/config';
import mongoose from 'mongoose';
import { PartnersModel } from '../src/modules/identity-access/infrastructure/Auth.models.js';
import { MongoCampaignRepository } from '../src/modules/campaigns/infrastructure/Campaign.mongo.repository.js';

/**
 * Attribution verification — read-only.
 *
 * Usage (from `api/`):
 *   node scripts/verify-attribution.js
 *   node scripts/verify-attribution.js --email=member@example.com
 *   node scripts/verify-attribution.js --campaign=gc_ab12cd34ef56
 *
 * Prints signups/activations grouped by `partner.campaignCode`, and optionally
 * checks one partner's stored code / activation / KYC state. Exits non-zero
 * when the database cannot be reached.
 */

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || 'true'];
  }),
);

const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
const database = process.env.MONGODB_DATABASE ?? '';
const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
const uri = `mongodb+srv://${username}:${password}@${host}/${database}?retryWrites=true&w=majority`;

const pad = (value, width) => String(value ?? '').padEnd(width);
const num = (value) => Number(value ?? 0).toLocaleString();

const main = async () => {
  if (!process.env.MONGODB_USERNAME || !process.env.MONGODB_PASSWORD || !database) {
    console.error('Missing MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE in api/.env');
    process.exit(2);
  }

  console.log(`Connecting to ${host}/${database} …`);
  await mongoose.connect(uri);

  const repo = new MongoCampaignRepository();
  const rows = await repo.attribution(200);

  const wantedCampaign = args.get('campaign') ?? null;
  const wantedEmail = args.get('email') ?? null;

  if (rows.length === 0) {
    console.log('No attributed signups found (no partner has campaignCode).');
  } else {
    console.log(`\nAttribution by campaign (${rows.length} code${rows.length === 1 ? '' : 's'}):`);
    console.log('-'.repeat(96));
    console.log(
      pad('CODE', 22),
      pad('CAMPAIGN', 28),
      pad('SIGNUPS', 9),
      pad('ACTIVATED', 10),
      pad('KYC', 6),
      pad('RATE', 7),
      'LAST SIGNUP',
    );
    console.log('-'.repeat(96));
    for (const row of rows) {
      if (wantedCampaign && row.campaignCode !== wantedCampaign) continue;
      console.log(
        pad(row.campaignCode, 22),
        pad(row.campaign?.name ?? '(deleted campaign)', 28),
        pad(num(row.signups), 9),
        pad(num(row.activated), 10),
        pad(num(row.kycVerified), 6),
        pad(`${row.activationRate}%`, 7),
        row.lastSignupAt ? new Date(row.lastSignupAt).toISOString().slice(0, 10) : '—',
      );
    }
    console.log('-'.repeat(96));
  }

  if (wantedCampaign) {
    const match = rows.find((row) => row.campaignCode === wantedCampaign);
    if (!match) {
      console.error(`\n✗ No partner has campaignCode "${wantedCampaign}".`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`\n✓ Campaign ${wantedCampaign}: ${match.signups} signup(s), ${match.activated} activated.`);
  }

  if (wantedEmail) {
    const partner = await PartnersModel.findOne({ email: String(wantedEmail).trim().toLowerCase() })
      .select('email username name surname campaignCode accountState kycStatus createdAt')
      .lean();
    if (!partner) {
      console.error(`\n✗ No partner found for ${wantedEmail}.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`\nPartner ${partner.email} (@${partner.username}):`);
    console.log(`  campaignCode : ${partner.campaignCode ?? '— (not attributed)'}`);
    console.log(`  accountState : ${partner.accountState ?? '—'}`);
    console.log(`  kycStatus    : ${partner.kycStatus ?? '—'}`);
    console.log(`  createdAt    : ${partner.createdAt ? new Date(partner.createdAt).toISOString() : '—'}`);
    if (!partner.campaignCode) {
      console.error('\n✗ Partner has no campaignCode — attribution was not stored.');
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log('\n✓ Attributed signup verified.');
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Attribution verification failed:', error?.message ?? error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
