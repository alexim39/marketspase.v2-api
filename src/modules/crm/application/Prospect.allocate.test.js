import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AllocateCampaignLeadsUseCase, AllocationSummaryUseCase, ReportAllocationUseCase,
  VerdictAllocationUseCase, fitBonus, rankCandidates,
} from './Prospect.allocate.js';

const oid = (n) => String(n).padStart(24, 'a');

const chain = (rows) => ({
  sort: () => chain(rows),
  limit: () => chain(rows),
  select: () => chain(rows),
  lean: async () => rows,
});

const fakeSurveys = (rows = []) => {
  const store = rows.map((r) => ({ ...r }));
  return {
    rows: store,
    find: () => chain(store.filter((r) => r.username === 'business' && r.prospectStatus === 'Not Moved')),
    findOneAndUpdate: (filter, update) => {
      const row = store.find((r) => String(r._id) === String(filter._id) && r.username === 'business' && r.prospectStatus === 'Not Moved');
      if (!row) return { lean: async () => null };
      Object.assign(row, update.$set ?? {});
      return { lean: async () => ({ ...row }) };
    },
    updateOne: async (filter, update) => {
      const row = store.find((r) => String(r._id) === String(filter._id));
      if (!row) return;
      Object.assign(row, update.$set ?? {});
      for (const k of Object.keys(update.$unset ?? {})) delete row[k];
    },
  };
};

const fakeProspects = (rows = []) => ({
  rows,
  find: (q) => chain(rows.filter((r) => {
    if (q?.partnerId && String(r.partnerId) !== String(q.partnerId)) return false;
    if (q?.surverId?.$in && !q.surverId.$in.map(String).includes(String(r.surverId))) return false;
    if (Array.isArray(q?.$or)) {
      const hit = q.$or.some((clause) => Object.entries(clause).every(([field, cond]) => {
        const vals = Array.isArray(cond?.$in) ? cond.$in.map(String) : [String(cond)];
        return vals.includes(String(r[field] ?? '').trim());
      }));
      if (!hit) return false;
    }
    return true;
  })),
  create: async (doc) => {
    const row = { _id: oid(`9${rows.length + 1}`), ...doc };
    rows.push(row);
    return row;
  },
});

const fakePartners = (balance = 10000) => {
  const me = { _id: oid(1), username: 'partner1', balance, email: 'p@example.com' };
  return {
    me,
    findById: () => ({ select: () => ({ lean: async () => ({ ...me }) }) }),
    findOneAndUpdate: (filter, update) => {
      const gte = filter.balance?.$gte ?? 0;
      if (me.balance < gte) {
        return { select: () => ({ lean: async () => null }), catch: async () => null };
      }
      me.balance += update.$inc?.balance ?? 0;
      return {
        select: () => ({ lean: async () => ({ _id: me._id, balance: me.balance }) }),
        catch: async () => null,
      };
    },
  };
};

const fakeCampaigns = (campaign) => ({
  campaign,
  findById: () => ({ lean: async () => ({ ...campaign }) }),
  updateOne: async (filter, update) => {
    if (String(filter._id) !== String(campaign._id)) return;
    for (const [k, v] of Object.entries(update.$inc ?? {})) {
      const path = k.split('.');
      campaign[path[0]][path[1]] += v;
    }
    Object.assign(campaign.allocation, update.$set ? Object.fromEntries(
      Object.entries(update.$set).map(([k, v]) => [k.split('.').pop(), v])
    ) : {});
  },
});

const fakeLedger = (rows = []) => ({
  rows,
  countDocuments: async (q) => rows.filter((r) =>
    (!q.campaignId || String(r.campaignId) === String(q.campaignId)) &&
    (!q.createdAt?.$gte || new Date(r.createdAt) >= new Date(q.createdAt.$gte))
  ).length,
  find: () => chain(rows),
  findById: (id) => ({ lean: async () => rows.find((r) => String(r._id) === String(id)) ?? null }),
  create: async (doc) => {
    const row = { _id: oid(`5${rows.length + 1}`), createdAt: new Date(), status: 'assigned', ...doc };
    rows.push(row);
    return row;
  },
  updateOne: async (filter, update) => {
    const row = rows.find((r) => String(r._id) === String(filter._id));
    if (row) Object.assign(row, update.$set ?? {});
  },
});

const fakeTransactions = (rows = []) => ({
  rows,
  create: async (docs) => { rows.push(...docs); return docs; },
});

const baseCampaign = (over = {}) => ({
  _id: oid(7),
  campaignName: 'Test · Facebook',
  createdBy: oid(1),
  deliveryStatus: 'Active',
  category: 'Health optimization',
  targetAudience: { locationTarget: 'States', locationTargets: ['Lagos', 'Ogun'] },
  adDuration: { campaignStartDate: new Date('2026-01-01'), noEndDate: true, campaignEndDate: null },
  allocation: { enabled: true, perLeadPrice: 300, dailyCap: 5, totalCap: 50, allowOutOfArea: false, paused: false, delivered: 0, spent: 0, fundsSkips: 0 },
  ...over,
});

const poolRow = (over = {}) => ({
  _id: oid(100 + Math.floor(Math.random() * 800)),
  username: 'business',
  prospectStatus: 'Not Moved',
  name: 'Lead',
  surname: 'One',
  email: '',
  phoneNumber: '08030000001',
  state: 'Lagos',
  stateNorm: 'lagos',
  country: 'Nigeria',
  createdAt: new Date(),
  ...over,
});

const deps = (campaign, rows, balance = 10000) => {
  const surveys = fakeSurveys(rows);
  const prospects = fakeProspects([]);
  const partners = fakePartners(balance);
  const campaigns = fakeCampaigns(campaign);
  const ledger = fakeLedger([]);
  const transactions = fakeTransactions([]);
  return {
    surveys, prospects, partners, campaigns, ledger, transactions,
    uc: new AllocateCampaignLeadsUseCase({ surveys, prospects, partners, campaigns, ledger, transactions }),
  };
};

describe('allocation ranking', () => {
  it('tiers same-state above same-zone above out-of-area', () => {
    const campaign = baseCampaign();
    const rows = [
      poolRow({ state: 'Kano', stateNorm: 'kano' }),
      poolRow({ state: 'Oyo', stateNorm: 'oyo' }),
      poolRow({ state: 'Lagos', stateNorm: 'lagos' }),
    ];
    const ranked = rankCandidates(rows, campaign);
    assert.equal(ranked[0].tier, 1);
    assert.equal(ranked[0].row.stateNorm, 'lagos');
    assert.equal(ranked[1].tier, 2); // Oyo: same South-West zone
    assert.equal(ranked[2].tier, 3); // Kano: out-of-area
  });

  it('country scope matches lead country', () => {
    const campaign = baseCampaign({ targetAudience: { locationTarget: 'Countries', locationTargets: ['Nigeria', 'Ghana'] } });
    const ranked = rankCandidates([poolRow({ country: 'Nigeria' }), poolRow({ country: 'Kenya' })], campaign);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].tier, 1);
  });

  it('fit bonus rewards age match and theme affinity, neutral otherwise', () => {
    const campaign = baseCampaign({ targetAudience: { ageRangeTarget: '25-34', locationTarget: 'States', locationTargets: [] } });
    assert.ok(fitBonus({ ageRange: '25-34' }, campaign).bonus >= 5);
    const mismatch = fitBonus({ ageRange: '55-64' }, campaign).bonus;
    assert.ok(mismatch < 0);
    assert.equal(fitBonus({}, { targetAudience: {}, category: '' }).bonus, 0);
    assert.ok(fitBonus({ primaryOnlineBusinessMotivation: 'I want more energy, fitness and good health' }, campaign).bonus >= 8);
  });
});

describe('AllocateCampaignLeadsUseCase', () => {
  it('delivers matched leads, debits ₦300 each, writes the ledger', async () => {
    const d = deps(baseCampaign(), [poolRow(), poolRow({ phoneNumber: '08030000002', state: 'Ogun', stateNorm: 'ogun' })]);
    const res = await d.uc.execute({ campaignId: oid(7), limit: 2 });
    assert.equal(res.delivered, 2);
    assert.equal(d.partners.me.balance, 10000 - 600);
    assert.equal(d.ledger.rows.length, 2);
    assert.ok(d.ledger.rows.every((r) => r.tier === 1 && r.costDebited === 300));
    assert.equal(d.transactions.rows.length, 2);
    assert.equal(d.campaigns.campaign.allocation.delivered, 2);
    assert.equal(d.campaigns.campaign.allocation.spent, 600);
    // Rows leave the shared pool for the partner's personal-list inbox.
    assert.ok(d.surveys.rows.every((r) => r.username === 'partner1' && r.campaignId));
  });

  it('skips duplicates already in the partner contacts', async () => {
    const d = deps(baseCampaign(), [poolRow({ phoneNumber: '08031111111' })]);
    d.prospects.rows.push({ partnerId: oid(1), prospectPhone: '08031111111' });
    const res = await d.uc.execute({ campaignId: oid(7) });
    assert.equal(res.delivered, 0);
    assert.equal(res.skipped.duplicate, 1);
    assert.equal(d.partners.me.balance, 10000);
  });

  it('does nothing for inactive, paused or capped campaigns', async () => {
    for (const over of [
      { deliveryStatus: 'Pending' },
      { allocation: { enabled: true, paused: true, perLeadPrice: 300, dailyCap: 5, totalCap: 50 } },
    ]) {
      const d = deps(baseCampaign(over), [poolRow()]);
      const res = await d.uc.execute({ campaignId: oid(7) });
      assert.equal(res.delivered, 0);
      assert.equal(d.ledger.rows.length, 0);
    }
  });

  it('reverts the row and warns once on insufficient balance', async () => {
    const d = deps(baseCampaign(), [poolRow()], 100);
    const res = await d.uc.execute({ campaignId: oid(7) });
    assert.equal(res.delivered, 0);
    assert.equal(res.skipped.insufficientFunds, 1);
    assert.equal(res.fundsNotice, true);
    assert.equal(d.surveys.rows[0].username, 'business');
    assert.equal(d.surveys.rows[0].prospectStatus, 'Not Moved');
  });

  it('never allocates or debits past the flight end date', async () => {
    const d = deps(
      baseCampaign({ adDuration: { campaignStartDate: new Date('2026-01-01'), noEndDate: false, campaignEndDate: new Date('2026-02-01') } }),
      [poolRow()]
    );
    const res = await d.uc.execute({ campaignId: oid(7), now: new Date('2026-03-01') });
    assert.equal(res.delivered, 0);
    assert.equal(res.skipped.flightEnded, 1);
    assert.equal(d.ledger.rows.length, 0);
    assert.equal(d.partners.me.balance, 10000);
    assert.equal(d.surveys.rows[0].username, 'business');
  });

  it('auto-pauses after five consecutive fund-failed runs', async () => {
    const campaign = baseCampaign();
    campaign.allocation.fundsSkips = 4;
    const d = deps(campaign, [poolRow()], 100);
    const res = await d.uc.execute({ campaignId: oid(7) });
    assert.equal(res.delivered, 0);
    assert.equal(d.campaigns.campaign.allocation.fundsSkips, 5);
    assert.equal(d.campaigns.campaign.allocation.paused, true);
    assert.equal(res.fundsNotice, true);
  });

  it('resets the funds streak on delivery', async () => {
    const campaign = baseCampaign();
    campaign.allocation.fundsSkips = 3;
    const d = deps(campaign, [poolRow()]);
    const res = await d.uc.execute({ campaignId: oid(7), limit: 1 });
    assert.equal(res.delivered, 1);
    assert.equal(d.campaigns.campaign.allocation.fundsSkips, 0);
  });
});

describe('AllocationSummaryUseCase', () => {
  it('builds the funnel from ledger + accepted prospects', async () => {
    const campaign = baseCampaign();
    const d = deps(campaign, [poolRow(), poolRow({ phoneNumber: '08030000009' })]);
    await d.uc.execute({ campaignId: oid(7), limit: 2 });
    // Partner accepts the first row into follow-ups.
    d.prospects.rows.push({
      partnerId: oid(1), surverId: d.ledger.rows[0].poolSurveyId,
      campaignId: oid(7), status: { stage: 'Contacted' }, stageHistory: [{ at: new Date() }], communications: [{ date: new Date() }],
    });
    const summary = new AllocationSummaryUseCase({
      campaigns: d.campaigns, ledger: d.ledger, prospects: d.prospects,
    });
    const out = await summary.execute({ campaignId: oid(7), partnerId: oid(1) });
    assert.equal(out.delivered, 2);
    assert.equal(out.accepted, 1);
    assert.equal(out.worked, 1);
    assert.equal(out.converted, 0);
    assert.equal(out.spent, 600);
    assert.equal(out.byTier[1], 2);
  });

  it('rejects other partners', async () => {
    const d = deps(baseCampaign(), []);
    const summary = new AllocationSummaryUseCase({
      campaigns: d.campaigns, ledger: d.ledger, prospects: d.prospects,
    });
    await assert.rejects(summary.execute({ campaignId: oid(7), partnerId: oid(2) }), /Not your campaign/);
  });
});

describe('report + verdict', () => {
  it('partner reports, admin replaces with credit and refill', async () => {
    const campaign = baseCampaign();
    const d = deps(campaign, [poolRow()]);
    await d.uc.execute({ campaignId: oid(7), limit: 1 });
    const ledger = d.ledger;
    const report = new ReportAllocationUseCase({ ledger });
    const before = d.partners.me.balance;
    const reported = await report.execute({ allocationId: ledger.rows[0]._id, partnerId: oid(1), reason: 'Dead line' });
    assert.equal(reported.status, 'reported-bad');
    const verdict = new VerdictAllocationUseCase({
      ledger, partners: d.partners, transactions: d.transactions, campaigns: d.campaigns,
    });
    const out = await verdict.execute({ allocationId: ledger.rows[0]._id, decision: 'replace', note: 'ok' });
    assert.equal(out.status, 'replaced');
    assert.equal(out.credited, 300);
    assert.equal(d.partners.me.balance, before + 300);
    assert.equal(d.campaigns.campaign.allocation.totalCap, 51);
  });
});
