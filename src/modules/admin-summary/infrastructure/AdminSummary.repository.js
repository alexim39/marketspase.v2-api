import { PartnersModel, TransactionModel } from '../../billing/infrastructure/Billing.models.js';
import { lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { open } from '../../../shared/security/fieldCrypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEPOSIT_METHODS = ['Paystack Deposit', 'Opay Deposit', 'Manual Transfer'];
const TONES = ['#667eea', '#2e7d32', '#d9a406', '#c62828', '#0288d1', '#7b1fa2', '#00897b', '#ef6c00'];

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round = (value) => Math.round(num(value) * 100) / 100;

const titleCase = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

const startOfWeekKey = (value) => {
  const date = new Date(value);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return dayKey(date);
};

const bucketKey = (value, days) => {
  if (days <= 7) return dayKey(value);
  if (days <= 90) return startOfWeekKey(value);
  return new Date(value).toISOString().slice(0, 7);
};

const bucketLabel = (key, days) => {
  if (days > 90) {
    const date = new Date(`${key}-01T00:00:00.000Z`);
    return date.toLocaleDateString('en-NG', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const date = new Date(`${key}T00:00:00.000Z`);
  const label = date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return days <= 7 ? label : `Week of ${label}`;
};

const buildBuckets = (from, now, days) => {
  const buckets = [];
  const cursor = new Date(from);
  if (days > 90) {
    cursor.setUTCDate(1);
    while (cursor <= now) {
      const key = cursor.toISOString().slice(0, 7);
      buckets.push({ key, label: bucketLabel(key, days) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return buckets;
  }
  // Align to Monday for weekly buckets so labels match the group step.
  if (days > 7) {
    const day = cursor.getUTCDay();
    const delta = day === 0 ? -6 : 1 - day;
    cursor.setUTCDate(cursor.getUTCDate() + delta);
  }
  while (cursor <= now) {
    const key = bucketKey(cursor, days);
    if (!buckets.some((bucket) => bucket.key === key)) {
      buckets.push({ key, label: bucketLabel(key, days) });
    }
    cursor.setUTCDate(cursor.getUTCDate() + (days <= 7 ? 1 : 7));
  }
  return buckets;
};

const seriesFromDaily = (daily, buckets) => {
  const map = new Map(buckets.map((bucket) => [bucket.key, 0]));
  for (const row of daily) {
    const key = bucketKey(row._id, row.days);
    if (map.has(key)) map.set(key, map.get(key) + num(row.amount ?? row.count));
  }
  return buckets.map((bucket) => map.get(bucket.key) ?? 0);
};

const distribution = (entries, { limit = 12, otherLabel = 'Other' } = {}) => {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, row) => sum + row.value, 0);
  if (rest > 0) head.push({ label: otherLabel, value: rest });
  return head;
};

const countBy = (rows, picker) => {
  const map = new Map();
  for (const row of rows) {
    const key = picker(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value }));
};

const peopleSummary = async ({ days, from, now }) => {
  const rows = await PartnersModel.find(
    {},
    'address.state role commissionRank accountState kycStatus createdAt lastSeenAt lastLoginAt suspendedAt',
  ).lean();

  const activeCutoff = new Date(now.getTime() - 30 * DAY_MS).getTime();
  const dormantCutoff = new Date(now.getTime() - 60 * DAY_MS).getTime();
  const fromMs = from.getTime();
  const nowMs = now.getTime();
  let total = 0;
  let newInWindow = 0;
  let new30d = 0;
  let active30 = 0;
  let dormant60 = 0;
  let suspended = 0;
  let members = 0;
  let activated = 0;
  let kycVerified = 0;
  let kycPending = 0;
  const states = [];
  const ranks = [];
  const roles = [];
  const signupDays = new Map();

  for (const row of rows) {
    total += 1;
    const createdAt = row.createdAt ? new Date(row.createdAt) : null;
    const createdMs = createdAt ? createdAt.getTime() : NaN;
    if (createdMs >= fromMs && createdMs <= nowMs) newInWindow += 1;
    if (createdMs >= nowMs - 30 * DAY_MS) new30d += 1;
    if (createdAt && createdMs >= fromMs && createdMs <= nowMs) {
      const key = dayKey(createdAt);
      signupDays.set(key, (signupDays.get(key) ?? 0) + 1);
    }
    const lastSeen = row.lastSeenAt ?? row.lastLoginAt;
    const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : NaN;
    if (lastSeenMs >= activeCutoff) active30 += 1;
    if (!Number.isFinite(lastSeenMs) || lastSeenMs < dormantCutoff) dormant60 += 1;
    if (row.suspendedAt) suspended += 1;
    if ((row.accountState ?? 'partner') === 'member') members += 1;
    else activated += 1;
    const kyc = row.kycStatus ?? 'verified';
    if (kyc === 'verified') kycVerified += 1;
    else if (kyc === 'pending') kycPending += 1;
    let state = 'Not provided';
    try {
      const rawState = String(open(row.address?.state) ?? '').trim();
      state = /^fct$/i.test(rawState) ? 'FCT' : (titleCase(rawState) || 'Not provided');
    } catch { /* unreadable state */ }
    states.push({ label: state, value: 1 });
    ranks.push({ label: titleCase(row.commissionRank) || 'Partner', value: 1 });
    const role = lenientRole(row.role);
    roles.push({ label: role === 'admin' ? 'Admin' : role === 'leader' ? 'Leader' : 'Member', value: 1 });
  }

  const stateTotals = countBy(states, (row) => row.label);
  const rankTotals = countBy(ranks, (row) => row.label)
    .sort((a, b) => b.value - a.value);
  const roleTotals = countBy(roles, (row) => row.label);
  const buckets = buildBuckets(from, now, days);
  const daily = [...signupDays.entries()]
    .map(([key, count]) => ({ _id: key, days, count }));

  return {
    domain: 'people',
    title: 'People summary',
    description: 'Who is on the platform, where they are, how active they are and where the next growth gap is.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'total', label: 'Total users', value: total, format: 'number', tone: 'brand', detail: `${new30d} joined in the last 30 days`, link: '/roles' },
      { key: 'new', label: `New in ${days} days`, value: newInWindow, format: 'number', tone: 'ok', detail: 'Fresh signups in this window' },
      { key: 'active', label: 'Active in 30 days', value: active30, format: 'number', tone: 'info', detail: total > 0 ? `${Math.round((active30 / total) * 100)}% of the base` : 'No users yet' },
      { key: 'dormant', label: 'No activity 60d', value: dormant60, format: 'number', tone: 'warn', detail: 'Follow-up or reactivation audience' },
      { key: 'activated', label: 'Activated partners', value: activated, format: 'number', tone: 'ok', detail: `${members} still members` },
      { key: 'kyc', label: 'KYC verified', value: kycVerified, format: 'number', tone: 'info', detail: kycPending ? `${kycPending} pending review` : 'No pending reviews', link: '/activation' },
      { key: 'suspended', label: 'Suspended', value: suspended, format: 'number', tone: suspended ? 'danger' : 'neutral', detail: suspended ? 'Review restricted accounts' : 'No suspensions' },
    ],
    trends: [{
      key: 'signups',
      title: 'Signups over time',
      type: 'line',
      labels: buckets.map((bucket) => bucket.label),
      series: [{ name: 'New users', color: TONES[0], values: seriesFromDaily(daily, buckets) }],
      format: 'number',
    }],
    distributions: [
      {
        key: 'states',
        title: 'Users by state',
        type: 'bar',
        items: distribution(stateTotals, { limit: 12, otherLabel: 'Other states' }),
        format: 'number',
      },
      {
        key: 'ranks',
        title: 'Commission rank',
        type: 'donut',
        items: rankTotals,
        format: 'number',
      },
      {
        key: 'roles',
        title: 'Access roles',
        type: 'donut',
        items: roleTotals,
        format: 'number',
      },
    ],
    alerts: [
      ...(suspended > 0 ? [{ tone: 'warn', title: `${suspended} suspended account${suspended === 1 ? '' : 's'}`, detail: 'Review the restriction reasons and reinstatement requests.', link: '/roles' }] : []),
      ...(kycPending > 0 ? [{ tone: 'warn', title: `${kycPending} KYC review${kycPending === 1 ? '' : 's'} pending`, detail: 'Clear the identity queue so partners can activate and withdraw.', link: '/activation' }] : []),
      ...(dormant60 > Math.max(5, total * 0.25) ? [{ tone: 'info', title: 'A large share of the base is dormant', detail: 'Consider a re-engagement campaign or a check-in from mentors.', link: '/broadcast' }] : []),
    ],
  };
};

const financeSummary = async ({ days, from, now }) => {
  const dateMatch = { date: { $gte: from, $lte: now } };
  const dayFormat = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };

  const [depositDaily, withdrawalDaily, depositByMethod, withdrawalByStatus, pendingRows, refundRow, walletRow] = await Promise.all([
    TransactionModel.aggregate([
      { $match: { ...dateMatch, transactionType: 'Credit', status: 'Completed', paymentMethod: { $in: DEPOSIT_METHODS } } },
      { $group: { _id: dayFormat, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    TransactionModel.aggregate([
      { $match: { ...dateMatch, transactionType: 'Debit', paymentMethod: 'Withdrawal', status: 'Paid' } },
      { $group: { _id: dayFormat, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    TransactionModel.aggregate([
      { $match: { ...dateMatch, transactionType: 'Credit', status: 'Completed', paymentMethod: { $in: DEPOSIT_METHODS } } },
      { $group: { _id: '$paymentMethod', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    TransactionModel.aggregate([
      { $match: { ...dateMatch, paymentMethod: 'Withdrawal' } },
      { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    TransactionModel.aggregate([
      { $match: { paymentMethod: 'Withdrawal', status: 'Pending' } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    TransactionModel.aggregate([
      { $match: { ...dateMatch, paymentMethod: 'Withdrawal Refund', status: 'Completed' } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    PartnersModel.aggregate([
      { $match: { suspendedAt: null } },
      { $group: { _id: null, amount: { $sum: '$balance' }, count: { $sum: 1 } } },
    ]),
  ]);

  const depositsIn = depositDaily.reduce((sum, row) => sum + num(row.amount), 0);
  const withdrawalsOut = withdrawalDaily.reduce((sum, row) => sum + num(row.amount), 0);
  const netFlow = depositsIn - withdrawalsOut;
  const pending = pendingRows[0] ?? { amount: 0, count: 0 };
  const refunds = refundRow[0] ?? { amount: 0, count: 0 };
  const liability = walletRow[0] ?? { amount: 0, count: 0 };
  const buckets = buildBuckets(from, now, days);
  const toDaily = (rows) => rows.map((row) => ({ _id: row._id, days, amount: row.amount, count: row.count }));

  return {
    domain: 'finance',
    title: 'Finance summary',
    description: 'Confirmed deposits, paid withdrawals and wallet liabilities. Net wallet flow is not the same as profit — it measures money funded into wallets minus money paid out.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'in', label: 'Deposits confirmed', value: round(depositsIn), format: 'currency', tone: 'ok', detail: `${depositDaily.reduce((sum, row) => sum + num(row.count), 0)} successful funding events`, link: '/deposits' },
      { key: 'out', label: 'Withdrawals paid', value: round(withdrawalsOut), format: 'currency', tone: 'info', detail: `${withdrawalDaily.reduce((sum, row) => sum + num(row.count), 0)} completed payouts`, link: '/deposits' },
      { key: 'net', label: 'Net wallet flow', value: round(netFlow), format: 'currency', tone: netFlow >= 0 ? 'ok' : 'danger', detail: 'Deposits minus paid withdrawals — not profit' },
      { key: 'pending', label: 'Pending withdrawals', value: round(num(pending.amount)), format: 'currency', tone: num(pending.count) ? 'warn' : 'neutral', detail: `${num(pending.count)} request${num(pending.count) === 1 ? '' : 's'} awaiting completion` },
      { key: 'liability', label: 'Wallet liability', value: round(num(liability.amount)), format: 'currency', tone: 'brand', detail: `Across ${num(liability.count)} active wallets` },
      { key: 'refunds', label: 'Withdrawal refunds', value: round(num(refunds.amount)), format: 'currency', tone: 'neutral', detail: `${num(refunds.count)} refunded payout${num(refunds.count) === 1 ? '' : 's'} returned to wallets` },
    ],
    trends: [{
      key: 'cashflow',
      title: 'Deposits vs paid withdrawals',
      type: 'line',
      labels: buckets.map((bucket) => bucket.label),
      series: [
        { name: 'Deposits', color: TONES[1], values: seriesFromDaily(toDaily(depositDaily), buckets) },
        { name: 'Withdrawals', color: TONES[3], values: seriesFromDaily(toDaily(withdrawalDaily), buckets) },
      ],
      format: 'currency',
    }],
    distributions: [
      {
        key: 'methods',
        title: 'Deposit methods',
        type: 'donut',
        items: depositByMethod.map((row) => ({ label: row._id, value: round(row.amount) })),
        format: 'currency',
      },
      {
        key: 'withdrawals',
        title: 'Withdrawal status',
        type: 'bar',
        items: withdrawalByStatus.map((row) => ({ label: row._id || 'Unknown', value: round(row.amount) })),
        format: 'currency',
      },
    ],
    alerts: [
      ...(netFlow < 0 ? [{ tone: 'danger', title: 'Net wallet flow is negative', detail: 'Withdrawals exceeded confirmed deposits in this window. Check payout volume and funding activity.', link: '/deposits' }] : []),
      ...(num(pending.count) > 0 ? [{ tone: 'warn', title: `${num(pending.count)} withdrawal${num(pending.count) === 1 ? '' : 's'} pending`, detail: `₦${round(pending.amount).toLocaleString('en-NG')} is awaiting completion or reconciliation.`, link: '/deposits' }] : []),
      ...(depositsIn === 0 ? [{ tone: 'info', title: 'No confirmed deposits in this window', detail: 'Check payment provider health and deposit conversion.', link: '/deposits' }] : []),
    ],
  };
};

export class AdminSummaryRepository {
  async people({ days, from, now }) {
    return peopleSummary({ days, from, now });
  }

  async finance({ days, from, now }) {
    return financeSummary({ days, from, now });
  }
}

export const summaryWindow = (days, now = new Date()) => {
  const size = Math.min(Math.max(Number(days) || 30, 7), 365);
  const to = new Date(now);
  const from = new Date(to.getTime() - size * DAY_MS);
  return { days: size, from, to };
};

export const summaryColors = TONES;
