import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWTTOKENSECRET ??= 'test-secret-for-manual-suite';

const domain = await import('../domain/Deposit.js');
const {
  SubmitManualDepositUseCase, MyManualClaimsUseCase, ListManualQueueUseCase,
  DecideManualDepositUseCase, AdminCreditWalletUseCase, LookupPartnerUseCase,
  creditPartnerWallet,
} = await import('./Deposit.usecases.js');

const ACCOUNTS = [
  { bank: 'Opay', number: '6102514335', name: 'ASYNC SOLUTIONS LTD' },
  { bank: 'Opay', number: '6102513801', name: 'ASYNC SOLUTIONS LTD' },
];

const goodClaim = (over = {}) => ({
  amountNgn: 5000,
  destinationAccount: '6102514335',
  senderName: 'Ada Tester',
  senderAccount: '0123456789',
  paidAt: new Date(Date.now() - 3600000),
  bankReference: 'SES12345678',
  note: 'test transfer',
  ...over,
});

const matches = (doc, filter) => Object.entries(filter ?? {}).every(([k, v]) => {
  const actual = doc[k];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('$ne' in v) return actual !== v.$ne;
    if ('$in' in v) return v.$in.map(String).includes(String(actual));
    return false;
  }
  return String(actual) === String(v);
});

const fakeDeposits = () => {
  const rows = new Map();
  const api = {
    rows,
    create: async (doc, _opts) => {
      const list = Array.isArray(doc) ? doc : [doc];
      const made = list.map((d, i) => ({ _id: `d${rows.size + i + 1}`, ...d }));
      made.forEach((m) => rows.set(m._id, m));
      const out = made.map((m) => ({ ...m }));
      return Array.isArray(doc) ? out : out[0];
    },
    find: (filter) => {
      const found = [...rows.values()].filter((r) => matches(r, filter)).map((r) => ({ ...r }));
      const chain = {
        sort: () => chain,
        limit: (n) => ({ lean: async () => found.slice(0, n) }),
        lean: async () => found,
      };
      return chain;
    },
    findOne: (filter) => ({
      lean: async () => {
        const row = [...rows.values()].find((r) => matches(r, filter));
        return row ? { ...row } : null;
      },
    }),
    findOneAndUpdate: (filter, update) => {
      const row = [...rows.values()].find((r) => matches(r, filter));
      if (!row) return { lean: async () => null };
      const before = { ...row };
      Object.assign(row, update.$set ?? {});
      return { lean: async () => before };
    },
    updateOne: async (filter, update) => {
      const row = [...rows.values()].find((r) => matches(r, filter));
      if (row) Object.assign(row, update.$set ?? {});
      return { modifiedCount: row ? 1 : 0 };
    },
  };
  return api;
};

const fakePartners = (seed = {}) => {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    findById: (id) => ({
      select: () => ({ lean: async () => {
        const r = rows.get(String(id));
        return r ? { ...r } : null;
      } }),
    }),
    findOne: (filter) => ({
      select: () => ({ lean: async () => {
        const ors = filter?.$or ?? [];
        const hit = [...rows.values()].find((r) => ors.some((c) => {
          if (c.email) return String(r.email).toLowerCase() === String(c.email).toLowerCase();
          if (c.username) return c.username.test(String(r.username ?? ''));
          return false;
        }));
        return hit ? { ...hit } : null;
      } }),
    }),
    find: (filter) => ({
      select: () => {
        const run = (n) => {
          const ors = filter?.$or ?? [];
          return [...rows.values()]
            .filter((r) => {
              if (filter?._id?.$in) return filter._id.$in.map(String).includes(String(r._id));
              return ors.some((c) => {
                if (c.email) return c.email.test(String(r.email ?? ''));
                if (c.username) return c.username.test(String(r.username ?? ''));
                return false;
              });
            })
            .slice(0, n ?? 1000)
            .map((r) => ({ ...r }));
        };
        return { limit: (n) => ({ lean: async () => run(n) }), lean: async () => run() };
      },
    }),
    findByIdAndUpdate: async (id, update) => {
      const r = rows.get(String(id));
      if (!r) return null;
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) r[k] = Number(r[k] ?? 0) + Number(v);
      Object.assign(r, update.$set ?? {});
      return { ...r };
    },
  };
};

const fakeTransactions = () => {
  const docs = [];
  return {
    docs,
    create: async (doc, _opts) => {
      // Array form (Mongoose requires it when a session is passed).
      const list = Array.isArray(doc) ? doc : [doc];
      const made = list.map((d) => ({ _id: `t${docs.length + 1}`, ...d }));
      made.forEach((m) => docs.push(m));
      const out = made.map((m) => ({ ...m }));
      return Array.isArray(doc) ? out : out[0];
    },
  };
};

const member = (over = {}) => ({
  _id: 'p1', name: 'Ada', surname: 'Tester', email: 'ada@x.test',
  phone: '08031234567', username: 'adat', balance: 1000, ...over,
});

// --- domain ---------------------------------------------------------------

test('assertManualClaim accepts a good claim and normalizes digits', () => {
  const c = domain.assertManualClaim(goodClaim({ destinationAccount: '610-251 4335' }), ACCOUNTS);
  assert.equal(c.destinationAccount, '6102514335');
  assert.equal(c.amountNgn, 5000);
});

test('assertManualClaim rejects unknown accounts, senders, dates, references', () => {
  assert.throws(() => domain.assertManualClaim(goodClaim({ destinationAccount: '9999999999' }), ACCOUNTS), /paid into/);
  assert.throws(() => domain.assertManualClaim(goodClaim({ senderName: 'x' }), ACCOUNTS), /sender name/);
  assert.throws(() => domain.assertManualClaim(goodClaim({ paidAt: new Date(Date.now() + 99999) }), ACCOUNTS), /future/);
  assert.throws(() => domain.assertManualClaim(goodClaim({ bankReference: 'ab' }), ACCOUNTS), /reference/);
  assert.throws(() => domain.assertManualClaim(goodClaim({ amountNgn: 50 }), ACCOUNTS), /between/);
});

test('manualAccounts parses env JSON and falls back on garbage', () => {
  const parsed = domain.manualAccounts({
    MANUAL_DEPOSIT_ACCOUNTS: JSON.stringify([{ bank: 'X', number: '1234567890', name: 'N' }]),
  });
  assert.deepEqual(parsed, [{ bank: 'X', number: '1234567890', name: 'N' }]);
  assert.ok(domain.manualAccounts({ MANUAL_DEPOSIT_ACCOUNTS: 'nope{' }).length >= 2);
  assert.ok(domain.manualAccounts({}).length >= 2);
});

// --- submit + mine ---------------------------------------------------------

test('submit stores an awaiting-review manual intent, nothing credited', async () => {
  const deposits = fakeDeposits();
  const partners = fakePartners({ p1: member() });
  const uc = new SubmitManualDepositUseCase({ deposits, partners, accounts: ACCOUNTS });
  const res = await uc.execute({ partnerId: 'p1', claim: goodClaim() });
  assert.match(res.reference, /^DP/);
  assert.equal(res.status, 'awaiting-review');
  const row = [...deposits.rows.values()][0];
  assert.equal(row.method, 'manual');
  assert.equal(row.claim.senderName, 'Ada Tester');
  assert.equal(partners.rows.get('p1').balance, 1000);
});

test('submit rejects unknown partners without storing', async () => {
  const deposits = fakeDeposits();
  const uc = new SubmitManualDepositUseCase({
    deposits, partners: fakePartners({}), accounts: ACCOUNTS,
  });
  await assert.rejects(uc.execute({ partnerId: 'ghost', claim: goodClaim() }), /Partner not found/);
  assert.equal(deposits.rows.size, 0);
});

test('mine is owner-scoped', async () => {
  const deposits = fakeDeposits();
  const partners = fakePartners({ p1: member(), p2: member({ _id: 'p2', email: 'b@x.test' }) });
  const submit = new SubmitManualDepositUseCase({ deposits, partners, accounts: ACCOUNTS });
  await submit.execute({ partnerId: 'p1', claim: goodClaim() });
  await submit.execute({ partnerId: 'p2', claim: goodClaim() });
  const mine = new MyManualClaimsUseCase({ deposits });
  const rows = await mine.execute({ partnerId: 'p1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'awaiting-review');
});

// --- queue + decide ---------------------------------------------------------

const seedClaim = async (deposits, partners) => {
  const submit = new SubmitManualDepositUseCase({ deposits, partners, accounts: ACCOUNTS });
  return submit.execute({ partnerId: 'p1', claim: goodClaim() });
};

test('queue lists awaiting claims with partner labels', async () => {
  const deposits = fakeDeposits();
  const partners = fakePartners({ p1: member() });
  await seedClaim(deposits, partners);
  const rows = await new ListManualQueueUseCase({ deposits, partners }).execute({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partner.email, 'ada@x.test');
});

test('approve credits exactly once across double decisions', async () => {
  const deposits = fakeDeposits();
  const partners = fakePartners({ p1: member() });
  const transactions = fakeTransactions();
  let notified = 0;
  const decide = new DecideManualDepositUseCase({
    deposits, partners, transactions,
    notifier: async () => { notified += 1; },
  });
  const { reference } = await seedClaim(deposits, partners);
  const first = await decide.execute({ reference, adminId: 'admin1', decision: 'approve', note: 'seen on statement' });
  assert.equal(first.status, 'approved');
  assert.ok(first.transactionId);
  assert.equal(first.balance, 6000);
  assert.equal(notified, 1);
  await assert.rejects(
    decide.execute({ reference, adminId: 'admin1', decision: 'approve' }),
    /already decided/,
  );
  assert.equal(partners.rows.get('p1').balance, 6000);
  assert.equal(transactions.docs.length, 1);
  assert.equal(transactions.docs[0].paymentMethod, 'Manual Transfer');
});

test('decide on an unknown reference is 404, not a masked 409', async () => {
  const decide = new DecideManualDepositUseCase({
    deposits: fakeDeposits(),
    partners: fakePartners({ p1: member() }),
    transactions: fakeTransactions(),
  });
  try {
    await decide.execute({ reference: 'DPNOPE1234', adminId: 'a', decision: 'approve' });
    assert.fail('must throw');
  } catch (err) {
    assert.equal(err.statusCode, 404);
    assert.match(err.message, /does not exist/);
  }
});

test('reject requires a reason and credits nothing', async () => {
  const deposits = fakeDeposits();
  const partners = fakePartners({ p1: member() });
  const transactions = fakeTransactions();
  let rejected = 0;
  const decide = new DecideManualDepositUseCase({
    deposits, partners, transactions,
    rejectNotifier: async () => { rejected += 1; },
  });
  const { reference } = await seedClaim(deposits, partners);
  await assert.rejects(decide.execute({ reference, adminId: 'a', decision: 'reject', note: '' }), /reason is required/);
  const out = await decide.execute({ reference, adminId: 'a', decision: 'reject', note: 'no such transfer found' });
  assert.equal(out.status, 'rejected');
  assert.equal(rejected, 1);
  assert.equal(partners.rows.get('p1').balance, 1000);
  assert.equal(transactions.docs.length, 0);
});

// --- admin credit + lookup ---------------------------------------------------

test('admin credit validates, records an approved intent, and notifies', async () => {
  const deposits = fakeDeposits();
  const partners = fakePartners({ p1: member() });
  const transactions = fakeTransactions();
  let notified = 0;
  const uc = new AdminCreditWalletUseCase({
    deposits, partners, transactions, notifier: async () => { notified += 1; },
  });
  const res = await uc.execute({ adminId: 'a1', partnerId: 'p1', amountNgn: 2500, reason: 'promo bonus' });
  assert.equal(res.amountNgn, 2500);
  assert.equal(res.balance, 3500);
  assert.ok(res.transactionId);
  assert.equal(notified, 1);
  const intent = [...deposits.rows.values()][0];
  assert.equal(intent.status, 'approved');
  assert.equal(intent.method, 'manual');
  assert.equal(transactions.docs[0].paymentMethod, 'Admin Credit');
});

test('admin credit rejects short reasons, bad amounts, unknown partners', async () => {
  const uc = new AdminCreditWalletUseCase({
    deposits: fakeDeposits(), partners: fakePartners({ p1: member() }), transactions: fakeTransactions(),
  });
  await assert.rejects(uc.execute({ adminId: 'a', partnerId: 'p1', amountNgn: 100, reason: 'no' }), /reason/);
  await assert.rejects(uc.execute({ adminId: 'a', partnerId: 'p1', amountNgn: 0, reason: 'valid reason' }), /between/);
  await assert.rejects(uc.execute({ adminId: 'a', partnerId: 'ghost', amountNgn: 100, reason: 'valid reason' }), /Partner not found/);
});

test('lookup finds exact emails and partial usernames, rejects short queries', async () => {
  const partners = fakePartners({ p1: member(), p2: member({ _id: 'p2', email: 'b@x.test', username: 'bobby' }) });
  const uc = new LookupPartnerUseCase({ partners });
  const exact = await uc.execute({ q: 'ADA@X.TEST' });
  assert.equal(exact.exact.email, 'ada@x.test');
  assert.equal(exact.exact.balance, 1000);
  assert.ok(!('password' in exact.exact));
  const partial = await uc.execute({ q: 'bob' });
  assert.equal(partial.exact, null);
  assert.equal(partial.matches.length, 1);
  await assert.rejects(uc.execute({ q: 'x' }), /at least 2/);
});

test('resolveAdminEmails collects role-admins plus extras, deduped', async () => {
  const { resolveAdminEmails } = await import('./Deposit.usecases.js');
  const partners = {
    find: () => ({
      select: () => ({
        lean: async () => [
          { email: 'A@x.test' },
          { email: 'a@x.test' },
          { email: 'b@x.test' },
          { email: 'not-an-email' },
        ],
      }),
    }),
  };
  const out = await resolveAdminEmails({ partners }, ['b@x.test', 'ops@x.test']);
  assert.deepEqual(out, ['a@x.test', 'b@x.test', 'ops@x.test']);
});

test('creditPartnerWallet increments and records in one core', async () => {
  const partners = fakePartners({ p1: member() });
  const transactions = fakeTransactions();
  const out = await creditPartnerWallet(
    { partners, transactions },
    { partnerId: 'p1', amountNgn: 400, paymentMethod: 'Test', reference: 'R1' },
  );
  assert.equal(out.balance, 1400);
  assert.ok(out.transactionId);
});
