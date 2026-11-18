import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SmsService } from './Sms.service.js';

const ACTOR = '507f1f77bcf86cd799439001';
const OTHER = '507f1f77bcf86cd799439002';
const P_MERCY = '507f1f77bcf86cd799439011';
const P_NO_CONSENT = '507f1f77bcf86cd799439012';
const P_OPTED_OUT = '507f1f77bcf86cd799439013';
const P_OTHER = '507f1f77bcf86cd799439014';
const D_JOHN = '507f1f77bcf86cd799439021';
const D_NO_CONTACT = '507f1f77bcf86cd799439022';
const D_OTHER = '507f1f77bcf86cd799439023';
const D_SMS_OFF = '507f1f77bcf86cd799439024';
const SUPPRESSION = '507f1f77bcf86cd799439031';

const clone = (value) => structuredClone(value);

const matches = (row, filter = {}) => Object.entries(filter).every(([key, expected]) => {
  const actual = row[key];
  if (expected === null) return actual === null || actual === undefined;
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$in' in expected) return expected.$in.map(String).includes(String(actual));
    if ('$gte' in expected) return Number(actual) >= Number(expected.$gte);
    if ('$lte' in expected) return new Date(actual).getTime() <= new Date(expected.$lte).getTime();
    if ('$ne' in expected) return String(actual) !== String(expected.$ne);
  }
  if (expected instanceof Date) return new Date(actual).getTime() === expected.getTime();
  return String(actual) === String(expected);
});

const applyUpdate = (row, update = {}) => {
  for (const [key, value] of Object.entries(update.$set ?? {})) row[key] = clone(value);
  for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] = Number(row[key] ?? 0) + Number(value);
};

const selectQuery = (rows, { skip = 0, limit = null, single = false } = {}) => {
  const query = {
    select: () => query,
    sort: () => query,
    lean: () => query,
    skip: (value) => selectQuery(rows, { skip: value, limit, single }),
    limit: (value) => selectQuery(rows, { skip, limit: value, single }),
    then: (resolve, reject) => Promise.resolve(
      single
        ? (rows[skip] ? clone(rows[skip]) : null)
        : rows.slice(skip, limit === null ? undefined : skip + limit).map(clone),
    ).then(resolve, reject),
    catch: (reject) => query.then(undefined, reject),
  };
  return query;
};

class FakeModel {
  constructor(rows = []) {
    this.rows = rows.map(clone);
    this.sequence = 0;
  }

  nextId() {
    this.sequence += 1;
    return `507f1f77bcf86cd79943${String(this.sequence).padStart(4, '0')}`;
  }

  create(data) {
    const row = {
      ...clone(data),
      _id: this.nextId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return Promise.resolve({ ...clone(row), toObject: () => clone(row) });
  }

  insertMany(docs) {
    for (const doc of docs) {
      this.rows.push({
        ...clone(doc),
        _id: this.nextId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return Promise.resolve(clone(docs));
  }

  find(filter = {}) {
    return selectQuery(this.rows.filter((row) => matches(row, filter)));
  }

  findOne(filter = {}) {
    return selectQuery(this.rows.filter((row) => matches(row, filter)).slice(0, 1), { single: true });
  }

  findById(id) {
    return this.findOne({ _id: id });
  }

  countDocuments(filter = {}) {
    return Promise.resolve(this.rows.filter((row) => matches(row, filter)).length);
  }

  findOneAndUpdate(filter, update, options = {}) {
    const index = this.rows.findIndex((row) => matches(row, filter));
    if (index < 0) {
      if (!options.upsert) return selectQuery([], { single: true });
      const created = { ...clone(filter), _id: this.nextId(), createdAt: new Date(), updatedAt: new Date() };
      applyUpdate(created, update);
      this.rows.push(created);
      return selectQuery([created], { single: true });
    }
    const before = clone(this.rows[index]);
    applyUpdate(this.rows[index], update);
    return selectQuery([options.new ? this.rows[index] : before], { single: true });
  }

  findByIdAndUpdate(id, update, options = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options);
  }

  findOneAndDelete(filter = {}) {
    const index = this.rows.findIndex((row) => matches(row, filter));
    if (index < 0) return selectQuery([], { single: true });
    const [removed] = this.rows.splice(index, 1);
    return selectQuery([removed], { single: true });
  }

  deleteOne(filter = {}) {
    const index = this.rows.findIndex((row) => matches(row, filter));
    if (index >= 0) this.rows.splice(index, 1);
    return Promise.resolve({ deletedCount: index >= 0 ? 1 : 0 });
  }

  deleteMany(filter = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, filter));
    return Promise.resolve({ deletedCount: before - this.rows.length });
  }

  updateOne(filter, update) {
    const row = this.rows.find((entry) => matches(entry, filter));
    if (row) applyUpdate(row, update);
    return Promise.resolve({ modifiedCount: row ? 1 : 0 });
  }

  updateMany(filter, update) {
    const rows = this.rows.filter((entry) => matches(entry, filter));
    rows.forEach((row) => applyUpdate(row, update));
    return Promise.resolve({ modifiedCount: rows.length });
  }

  aggregate(pipeline = []) {
    let rows = [...this.rows];
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((row) => matches(row, stage.$match));
      if (stage.$group) {
        const sum = stage.$group.amount?.$sum;
        const field = String(sum ?? '').replace(/^\$/, '');
        return Promise.resolve([{
          _id: stage.$group._id ?? null,
          amount: rows.reduce((total, row) => total + Number(row[field] ?? 0), 0),
        }]);
      }
    }
    return Promise.resolve(rows);
  }
}

const baseProspects = () => [
  {
    _id: P_MERCY,
    partnerId: ACTOR,
    prospectName: 'Mercy',
    prospectSurname: 'Lebo',
    prospectPhone: '08031234567',
    consentToContact: true,
    relationship: 'Friend',
    priority: 'high',
    status: { stage: 'Contacted', stageEnteredAt: new Date(Date.now() - 6 * 86400000) },
    communications: [{ date: new Date(Date.now() - 2 * 86400000), followUpDate: null }],
    updatedAt: new Date(),
  },
  {
    _id: P_NO_CONSENT,
    partnerId: ACTOR,
    prospectName: 'Sam',
    prospectSurname: 'Eze',
    prospectPhone: '08032223333',
    consentToContact: false,
    status: { stage: 'New' },
    updatedAt: new Date(),
  },
  {
    _id: P_OPTED_OUT,
    partnerId: ACTOR,
    prospectName: 'Rita',
    prospectSurname: 'Bello',
    prospectPhone: '08039876543',
    consentToContact: true,
    status: { stage: 'Interested' },
    updatedAt: new Date(),
  },
  {
    _id: P_OTHER,
    partnerId: OTHER,
    prospectName: 'Not Mine',
    prospectSurname: 'At All',
    prospectPhone: '08039998888',
    consentToContact: true,
    status: { stage: 'New' },
    updatedAt: new Date(),
  },
];

const basePartners = (balance = 500) => [
  {
    _id: ACTOR,
    name: 'Ada',
    surname: 'Obi',
    username: 'ada',
    balance,
    settings: { notification: { receive: 'email' } },
    updatedAt: new Date(),
  },
  {
    _id: D_JOHN,
    partnerOf: ACTOR,
    name: 'John',
    surname: 'Doe',
    username: 'john',
    phone: '08035550001',
    accountState: 'member',
    commissionRank: 'Partner',
    activatedAt: new Date(),
    mentorContactPreference: 'in_app',
    createdAt: new Date(Date.now() - 20 * 86400000),
    settings: { notification: { receive: 'email' } },
    updatedAt: new Date(),
  },
  {
    _id: D_NO_CONTACT,
    partnerOf: ACTOR,
    name: 'Ngozi',
    surname: 'Ibe',
    username: 'ngozi',
    phone: '08035550002',
    mentorContactPreference: 'prefer_not_now',
    settings: { notification: { receive: 'email' } },
    updatedAt: new Date(),
  },
  {
    _id: D_OTHER,
    partnerOf: OTHER,
    name: 'Elsewhere',
    surname: 'Person',
    username: 'elsewhere',
    phone: '08035550003',
    mentorContactPreference: 'in_app',
    settings: { notification: { receive: 'email' } },
    updatedAt: new Date(),
  },
  {
    _id: D_SMS_OFF,
    partnerOf: ACTOR,
    name: 'Quiet',
    surname: 'Member',
    username: 'quiet',
    phone: '08035550004',
    mentorContactPreference: 'in_app',
    settings: { notification: { receive: 'off' } },
    updatedAt: new Date(),
  },
];

const world = ({ balance = 500 } = {}) => {
  const state = {
    partners: new FakeModel(basePartners(balance)),
    prospects: new FakeModel(baseProspects()),
    campaigns: new FakeModel(),
    recipients: new FakeModel(),
    templates: new FakeModel(),
    suppressions: new FakeModel([{
      _id: SUPPRESSION,
      partnerId: ACTOR,
      phone: '2348039876543',
      reason: 'Asked to stop',
      createdAt: new Date(),
    }]),
    transactions: new FakeModel(),
  };
  const sent = [];
  const enqueued = [];
  const failedPhones = new Set();
  const sms = {
    send: async ({ to, body }) => {
      if (failedPhones.has(to)) throw new Error('provider rejected this number');
      sent.push({ to, body });
      return { providerId: `provider-${sent.length}` };
    },
  };
  const service = new SmsService({
    ...state,
    sms,
    enqueue: (id) => enqueued.push(id),
    logCommunication: { execute: async () => null },
  });
  return { state, service, sent, enqueued, failedPhones };
};

const balanceOf = (state, id = ACTOR) =>
  Number(state.partners.rows.find((row) => String(row._id) === String(id))?.balance ?? 0);

describe('SMS service', () => {
  let kit;

  beforeEach(() => {
    kit = world();
  });

  it('quotes per-recipient pages after personalisation', async () => {
    const quote = await kit.service.quote(ACTOR, {
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'A'.repeat(170),
    });
    assert.equal(quote.pages, 2);
    assert.equal(quote.cost, 20);
    assert.equal(quote.recipients, 1);
    assert.equal(quote.canSend, true);

    const personalised = await kit.service.quote(ACTOR, {
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hi {{first_name}}, this is {{my_name}}.',
    });
    assert.equal(personalised.previews[0].body, 'Hi Mercy, this is Ada Obi.');
  });

  it('excludes prospects without consent or with an opt-out', async () => {
    const quote = await kit.service.quote(ACTOR, {
      recipients: [
        { type: 'prospect', id: P_MERCY },
        { type: 'prospect', id: P_NO_CONSENT },
        { type: 'prospect', id: P_OPTED_OUT },
        { type: 'prospect', id: P_OTHER },
      ],
      body: 'Hello from Ada.',
    });
    assert.equal(quote.recipients, 1);
    assert.equal(quote.cost, 10);
    const reasons = Object.fromEntries(quote.ineligible.map((row) => [row.id, row.reason]));
    assert.equal(reasons[P_NO_CONSENT], 'No contact consent');
    assert.equal(reasons[P_OPTED_OUT], 'Opted out of SMS');
    assert.equal(reasons[P_OTHER], 'Not in your pipeline');
  });

  it('only lists direct partners who have not opted out', async () => {
    const list = await kit.service.recipients(ACTOR, { type: 'partners' });
    const rows = Object.fromEntries(list.items.map((row) => [row.id, row]));
    assert.equal(rows[D_JOHN].eligible, true);
    assert.equal(rows[D_NO_CONTACT].eligible, false);
    assert.equal(rows[D_NO_CONTACT].reason, 'Asked not to be contacted');
    assert.equal(rows[D_SMS_OFF].eligible, false);
    assert.equal(rows[D_SMS_OFF].reason, 'Asked not to be contacted');
    assert.equal(rows[D_OTHER], undefined);
  });

  it('send debits the wallet once and writes the ledger', async () => {
    const result = await kit.service.send(ACTOR, {
      idempotencyKey: 'send-once-1',
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hello {{first_name}}, quick update.',
    });

    assert.equal(result.status, 'sending');
    assert.equal(result.totalCost, 10);
    assert.equal(result.recipientCount, 1);
    assert.equal(balanceOf(kit.state), 490);
    assert.equal(kit.enqueued.length, 1);

    const ledger = kit.state.transactions.rows;
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].amount, -10);
    assert.equal(ledger[0].balanceBefore, 500);
    assert.equal(ledger[0].balanceAfter, 490);
    assert.equal(ledger[0].transactionType, 'SMS');

    const recipient = kit.state.recipients.rows[0];
    assert.equal(recipient.status, 'queued');
    assert.equal(recipient.renderedBody, 'Hello Mercy, quick update.');
    assert.equal(recipient.cost, 10);
  });

  it('rejects a send that exceeds the wallet without creating anything', async () => {
    const poor = world({ balance: 5 });
    await assert.rejects(
      () => poor.service.send(ACTOR, {
        idempotencyKey: 'too-expensive-1',
        recipients: [{ type: 'prospect', id: P_MERCY }],
        body: 'Hello from Ada.',
      }),
      (error) => error.statusCode === 409 && /Insufficient wallet balance/.test(error.message),
    );
    assert.equal(balanceOf(poor.state), 5);
    assert.equal(poor.state.campaigns.rows.length, 0);
    assert.equal(poor.state.transactions.rows.length, 0);
  });

  it('is idempotent for a replayed send reference', async () => {
    const first = await kit.service.send(ACTOR, {
      idempotencyKey: 'idempotent-1',
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hello from Ada.',
    });
    const second = await kit.service.send(ACTOR, {
      idempotencyKey: 'idempotent-1',
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hello from Ada.',
    });
    assert.equal(second.id, first.id);
    assert.equal(balanceOf(kit.state), 490);
    assert.equal(kit.state.campaigns.rows.length, 1);
    assert.equal(kit.state.recipients.rows.length, 1);
    assert.equal(kit.state.transactions.rows.length, 1);
  });

  it('refunds a failed provider send and re-debits only on retry', async () => {
    kit.failedPhones.add('2348031234567');
    const campaign = await kit.service.send(ACTOR, {
      idempotencyKey: 'failure-1',
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hello from Ada.',
    });
    assert.equal(balanceOf(kit.state), 490);

    await kit.service.processCampaign(campaign.id);
    assert.equal(balanceOf(kit.state), 500);
    assert.equal(kit.state.campaigns.rows[0].status, 'failed');
    assert.equal(kit.state.campaigns.rows[0].refundedAmount, 10);
    assert.equal(kit.state.recipients.rows[0].status, 'failed');
    const refund = kit.state.transactions.rows.find((row) => row.transactionType === 'SMS refund');
    assert.equal(refund.amount, 10);

    kit.failedPhones.clear();
    await kit.service.retry(ACTOR, campaign.id);
    assert.equal(balanceOf(kit.state), 490);
    assert.equal(kit.state.campaigns.rows[0].status, 'sending');
    assert.equal(kit.state.campaigns.rows[0].refundedAmount, 0);

    await kit.service.processCampaign(campaign.id);
    assert.equal(kit.state.campaigns.rows[0].status, 'sent');
    assert.equal(kit.state.recipients.rows[0].status, 'sent');
    assert.equal(balanceOf(kit.state), 490);
  });

  it('debits at schedule time and refunds on cancel', async () => {
    const scheduledAt = new Date(Date.now() + 3600000).toISOString();
    const campaign = await kit.service.send(ACTOR, {
      idempotencyKey: 'schedule-1',
      recipients: [
        { type: 'prospect', id: P_MERCY },
        { type: 'partner', id: D_JOHN },
      ],
      body: 'Hello from Ada.',
      scheduledAt,
    });
    assert.equal(campaign.status, 'scheduled');
    assert.equal(campaign.totalCost, 20);
    assert.equal(balanceOf(kit.state), 480);
    assert.equal(kit.enqueued.length, 0);

    const cancelled = await kit.service.cancel(ACTOR, campaign.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.refundedAmount, 20);
    assert.equal(balanceOf(kit.state), 500);
    assert.ok(kit.state.recipients.rows.every((row) => row.status === 'cancelled'));
    assert.equal(
      kit.state.transactions.rows.filter((row) => row.transactionType === 'SMS refund').length,
      2,
    );
  });

  it('processes scheduled sends once they are due', async () => {
    const campaign = await kit.service.send(ACTOR, {
      idempotencyKey: 'due-1',
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hello from Ada.',
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const row = kit.state.campaigns.rows.find((entry) => entry._id === campaign.id);
    row.scheduledAt = new Date(Date.now() - 1000);

    const result = await kit.service.processDueScheduled();
    assert.equal(result.checked, 1);
    assert.equal(kit.state.campaigns.rows.find((entry) => entry._id === campaign.id).status, 'sent');
    assert.equal(kit.sent.length, 1);
  });

  it('recovers a campaign abandoned in the sending state', async () => {
    const campaign = await kit.state.campaigns.create({
      partnerId: ACTOR,
      idempotencyKey: 'stuck-1',
      body: 'Hello',
      pages: 1,
      pricePerPage: 10,
      totalCost: 10,
      recipientCount: 1,
      status: 'sending',
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      createdBy: ACTOR,
    });
    await kit.state.recipients.insertMany([{
      campaignId: campaign._id,
      partnerId: ACTOR,
      recipientType: 'prospect',
      recipientId: P_MERCY,
      name: 'Mercy Lebo',
      phone: '2348031234567',
      renderedBody: 'Hello',
      pages: 1,
      cost: 10,
      status: 'queued',
    }]);

    const result = await kit.service.processDueScheduled();
    assert.equal(result.recovered, 1);
    assert.equal(kit.state.campaigns.rows[0].status, 'sent');
    assert.equal(kit.state.recipients.rows[0].status, 'sent');
  });

  it('suggests copy from the prospect stage and partner activation state', async () => {
    const prospect = await kit.service.suggest(ACTOR, { type: 'prospect', id: P_MERCY });
    assert.ok(prospect.suggestions.length >= 2);
    assert.ok(prospect.suggestions.some((row) => row.body.includes('{{first_name}}')));

    const partner = await kit.service.suggest(ACTOR, { type: 'partner', id: D_JOHN });
    assert.ok(partner.suggestions.some((row) => row.intent === 'follow_up'));
  });

  it('normalises opt-out numbers and applies them to future quotes', async () => {
    const added = await kit.service.addSuppression(ACTOR, { phone: '0803 123 4567', reason: 'Asked by phone' });
    assert.equal(added.phone, '2348031234567');
    const quote = await kit.service.quote(ACTOR, {
      recipients: [{ type: 'prospect', id: P_MERCY }],
      body: 'Hello from Ada.',
    });
    assert.equal(quote.recipients, 0);
    assert.equal(quote.ineligible[0].reason, 'Opted out of SMS');
  });
});
