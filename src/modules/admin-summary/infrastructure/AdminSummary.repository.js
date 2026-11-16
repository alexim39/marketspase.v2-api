import { PartnersModel, TransactionModel } from '../../billing/infrastructure/Billing.models.js';
import { StoreModel, StoreOrderModel, StoreProductModel } from '../../stores/infrastructure/Store.models.js';
import { GrowthCampaignModel, PartnerAllocationModel } from '../../campaigns/infrastructure/Campaign.models.js';
import { TicketMongooseModel } from '../../support-ticketing/infrastructure/Ticket.schema.js';
import {
  WeeklyVideoCommentModel,
  WeeklyVideoModel,
  WeeklyVideoProgressModel,
} from '../../weekly-video/infrastructure/WeeklyVideo.models.js';
import { TrainingCourseModel, TrainingProgressModel } from '../../training/infrastructure/Training.models.js';
import { EmailSubscriptionModel } from '../../../apps/email-subscription/models/email-subscription.model.js';
import { BroadcastModel } from '../../broadcast/infrastructure/Broadcast.mongo.model.js';
import { lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { open } from '../../../shared/security/fieldCrypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEPOSIT_METHODS = ['Paystack Deposit', 'Opay Deposit', 'Manual Transfer'];
const COLORS = ['#667eea', '#2e7d32', '#d9a406', '#c62828', '#0288d1', '#7b1fa2', '#00897b', '#ef6c00'];

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round = (value) => Math.round(num(value) * 100) / 100;
const fromKobo = (value) => round(num(value) / 100);
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

const titleCase = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

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
  const rankTotals = countBy(ranks, (row) => row.label).sort((a, b) => b.value - a.value);
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
      series: [{ name: 'New users', color: COLORS[0], values: seriesFromDaily(daily, buckets) }],
      format: 'number',
    }],
    distributions: [
      { key: 'states', title: 'Users by state', type: 'bar', items: distribution(stateTotals, { limit: 12, otherLabel: 'Other states' }), format: 'number' },
      { key: 'ranks', title: 'Commission rank', type: 'donut', items: rankTotals, format: 'number' },
      { key: 'roles', title: 'Access roles', type: 'donut', items: roleTotals, format: 'number' },
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
      { key: 'in', label: 'Deposits confirmed', value: round(depositsIn), format: 'currency', tone: 'ok', detail: `${depositDaily.reduce((sum, row) => sum + num(row.count), 0)} successful funding events`, link: '/finance/transactions' },
      { key: 'out', label: 'Withdrawals paid', value: round(withdrawalsOut), format: 'currency', tone: 'info', detail: `${withdrawalDaily.reduce((sum, row) => sum + num(row.count), 0)} completed payouts`, link: '/finance/transactions' },
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
        { name: 'Deposits', color: COLORS[1], values: seriesFromDaily(toDaily(depositDaily), buckets) },
        { name: 'Withdrawals', color: COLORS[3], values: seriesFromDaily(toDaily(withdrawalDaily), buckets) },
      ],
      format: 'currency',
    }],
    distributions: [
      { key: 'methods', title: 'Deposit methods', type: 'donut', items: depositByMethod.map((row) => ({ label: row._id, value: round(row.amount) })), format: 'currency' },
      { key: 'withdrawals', title: 'Withdrawal status', type: 'bar', items: withdrawalByStatus.map((row) => ({ label: row._id || 'Unknown', value: round(row.amount) })), format: 'currency' },
    ],
    alerts: [
      ...(netFlow < 0 ? [{ tone: 'danger', title: 'Net wallet flow is negative', detail: 'Withdrawals exceeded confirmed deposits in this window. Check payout volume and funding activity.', link: '/finance/transactions' }] : []),
      ...(num(pending.count) > 0 ? [{ tone: 'warn', title: `${num(pending.count)} withdrawal${num(pending.count) === 1 ? '' : 's'} pending`, detail: `₦${round(pending.amount).toLocaleString('en-NG')} is awaiting completion or reconciliation.`, link: '/finance/transactions' }] : []),
      ...(depositsIn === 0 ? [{ tone: 'info', title: 'No confirmed deposits in this window', detail: 'Check payment provider health and deposit conversion.', link: '/finance/transactions' }] : []),
    ],
  };
};

const commerceSummary = async ({ days, from, now }) => {
  const dateMatch = { createdAt: { $gte: from, $lte: now } };
  const [stores, products, orderRows, paidRow, escrowRow, topStores, pendingRow, paidDaily] = await Promise.all([
    StoreModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    StoreProductModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    StoreOrderModel.aggregate([
      { $match: dateMatch },
      { $group: { _id: '$status', count: { $sum: 1 }, totalKobo: { $sum: '$amounts.totalKobo' } } },
    ]),
    StoreOrderModel.aggregate([
      { $match: { ...dateMatch, 'payment.status': 'paid' } },
      { $group: { _id: null, count: { $sum: 1 }, totalKobo: { $sum: '$amounts.totalKobo' }, feeKobo: { $sum: '$amounts.serviceFeeKobo' } } },
    ]),
    StoreOrderModel.aggregate([
      { $match: { 'escrow.status': 'held' } },
      { $group: { _id: null, count: { $sum: 1 }, pendingKobo: { $sum: '$amounts.partnerPendingKobo' } } },
    ]),
    StoreOrderModel.aggregate([
      { $match: { ...dateMatch, 'payment.status': 'paid' } },
      { $group: { _id: { slug: '$storeSlug', name: '$storeName' }, totalKobo: { $sum: '$amounts.totalKobo' }, count: { $sum: 1 } } },
      { $sort: { totalKobo: -1 } },
      { $limit: 8 },
    ]),
    StoreOrderModel.aggregate([
      { $match: { ...dateMatch, status: 'pending_payment' } },
      { $group: { _id: null, count: { $sum: 1 }, totalKobo: { $sum: '$amounts.totalKobo' } } },
    ]),
    StoreOrderModel.aggregate([
      { $match: { ...dateMatch, 'payment.status': 'paid' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, totalKobo: { $sum: '$amounts.totalKobo' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const storeCount = stores.reduce((sum, row) => sum + num(row.count), 0);
  const publishedStores = stores.find((row) => row._id === 'published')?.count ?? 0;
  const suspendedStores = stores.find((row) => row._id === 'suspended')?.count ?? 0;
  const publishedProducts = products.find((row) => row._id === 'published')?.count ?? 0;
  const productCount = products.reduce((sum, row) => sum + num(row.count), 0);
  const paid = paidRow[0] ?? { count: 0, totalKobo: 0, feeKobo: 0 };
  const escrow = escrowRow[0] ?? { count: 0, pendingKobo: 0 };
  const pending = pendingRow[0] ?? { count: 0, totalKobo: 0 };
  const gmv = fromKobo(paid.totalKobo);
  const aov = num(paid.count) > 0 ? round(gmv / num(paid.count)) : 0;
  const buckets = buildBuckets(from, now, days);

  return {
    domain: 'commerce',
    title: 'Commerce summary',
    description: 'Store supply, customer demand, payment health and escrow in one view.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'stores', label: 'Published stores', value: publishedStores, format: 'number', tone: 'brand', detail: `${storeCount} total stores · ${suspendedStores} suspended`, link: '/stores' },
      { key: 'products', label: 'Published listings', value: publishedProducts, format: 'number', tone: 'info', detail: `${productCount} listings across all stores`, link: '/products' },
      { key: 'orders', label: 'Paid orders', value: num(paid.count), format: 'number', tone: 'ok', detail: `In the last ${days} days`, link: '/store-orders' },
      { key: 'gmv', label: 'Gross merchandise value', value: gmv, format: 'currency', tone: 'ok', detail: `Average order ₦${aov.toLocaleString('en-NG')}`, link: '/store-orders' },
      { key: 'fees', label: 'Service fees earned', value: fromKobo(paid.feeKobo), format: 'currency', tone: 'brand', detail: 'Platform service fee on paid orders' },
      { key: 'escrow', label: 'Escrow held', value: fromKobo(escrow.pendingKobo), format: 'currency', tone: 'warn', detail: `${num(escrow.count)} orders awaiting release`, link: '/store-settlements' },
    ],
    trends: [{
      key: 'gmv',
      title: 'Paid order value over time',
      type: 'line',
      labels: buckets.map((bucket) => bucket.label),
      series: [{
        name: 'GMV',
        color: COLORS[0],
        values: seriesFromDaily(paidDaily.map((row) => ({ _id: row._id, days, amount: fromKobo(row.totalKobo) })), buckets),
      }],
      format: 'currency',
    }],
    distributions: [
      { key: 'status', title: 'Orders by status', type: 'donut', items: orderRows.map((row) => ({ label: row._id || 'Unknown', value: num(row.count) })), format: 'number' },
      { key: 'topStores', title: 'Top stores by GMV', type: 'bar', items: topStores.map((row) => ({ label: row._id?.name || row._id?.slug || 'Store', value: fromKobo(row.totalKobo) })), format: 'currency' },
    ],
    alerts: [
      ...(num(pending.count) > 0 ? [{ tone: 'warn', title: `${num(pending.count)} order${num(pending.count) === 1 ? '' : 's'} awaiting payment`, detail: `₦${fromKobo(pending.totalKobo).toLocaleString('en-NG')} in unpaid checkouts.`, link: '/store-orders' }] : []),
      ...(num(escrow.count) > 0 ? [{ tone: 'info', title: 'Escrow is holding partner earnings', detail: `${num(escrow.count)} orders are waiting for delivery or release.`, link: '/store-settlements' }] : []),
      ...(suspendedStores > 0 ? [{ tone: 'warn', title: `${suspendedStores} suspended store${suspendedStores === 1 ? '' : 's'}`, detail: 'Review the suspension reasons and restore healthy stores.', link: '/stores' }] : []),
    ],
  };
};

const growthSummary = async ({ days, from, now }) => {
  const [campaignRows, allocationRows, allocationDaily] = await Promise.all([
    GrowthCampaignModel.aggregate([
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        budget: { $sum: '$budget.total' },
        spent: { $sum: '$budget.spent' },
        refunded: { $sum: '$budget.refunded' },
        allocated: { $sum: '$capacity.allocated' },
      } },
    ]),
    PartnerAllocationModel.aggregate([
      { $match: { allocatedAt: { $gte: from, $lte: now } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    PartnerAllocationModel.aggregate([
      { $match: { allocatedAt: { $gte: from, $lte: now } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$allocatedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const campaignTotal = campaignRows.reduce((sum, row) => sum + num(row.count), 0);
  const activeCampaigns = campaignRows.find((row) => row._id === 'Active')?.count ?? 0;
  const totalBudget = campaignRows.reduce((sum, row) => sum + num(row.budget), 0);
  const spent = campaignRows.reduce((sum, row) => sum + num(row.spent), 0);
  const remaining = Math.max(0, totalBudget - spent - campaignRows.reduce((sum, row) => sum + num(row.refunded), 0));
  const activeAllocations = allocationRows.find((row) => row._id === 'active')?.count ?? 0;
  const newAllocations = allocationRows.reduce((sum, row) => sum + num(row.count), 0);
  const buckets = buildBuckets(from, now, days);

  return {
    domain: 'growth',
    title: 'Growth summary',
    description: 'Campaign funding, partner placement and the pace of the acquisition engine.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'campaigns', label: 'Active campaigns', value: activeCampaigns, format: 'number', tone: 'brand', detail: `${campaignTotal} campaigns in total`, link: '/growth' },
      { key: 'budget', label: 'Campaign budget', value: totalBudget, format: 'currency', tone: 'info', detail: 'Across all campaigns' },
      { key: 'spent', label: 'Budget spent', value: spent, format: 'currency', tone: 'ok', detail: totalBudget > 0 ? `${Math.round((spent / totalBudget) * 100)}% utilisation` : 'No budget yet' },
      { key: 'remaining', label: 'Budget remaining', value: remaining, format: 'currency', tone: remaining > 0 ? 'ok' : 'warn', detail: 'Available for future allocation' },
      { key: 'allocations', label: 'Active allocations', value: activeAllocations, format: 'number', tone: 'info', detail: `${newAllocations} new placements in this window` },
    ],
    trends: [{
      key: 'allocations',
      title: 'Partner placements over time',
      type: 'line',
      labels: buckets.map((bucket) => bucket.label),
      series: [{
        name: 'Placements',
        color: COLORS[2],
        values: seriesFromDaily(allocationDaily.map((row) => ({ _id: row._id, days, count: row.count })), buckets),
      }],
      format: 'number',
    }],
    distributions: [
      { key: 'campaignStatus', title: 'Campaign status', type: 'donut', items: campaignRows.map((row) => ({ label: row._id || 'Unknown', value: num(row.count) })), format: 'number' },
      { key: 'allocationStatus', title: 'Allocation status', type: 'bar', items: allocationRows.map((row) => ({ label: row._id || 'Unknown', value: num(row.count) })), format: 'number' },
    ],
    alerts: [
      ...(remaining === 0 && totalBudget > 0 ? [{ tone: 'warn', title: 'Campaign budgets are exhausted', detail: 'Fund a new campaign to keep partner allocation moving.', link: '/growth' }] : []),
      ...(activeCampaigns === 0 ? [{ tone: 'info', title: 'No active growth campaign', detail: 'Create or reactivate a campaign to bring in new partners.', link: '/growth' }] : []),
    ],
  };
};

const supportSummary = async ({ days, from, now }) => {
  const dateMatch = { createdAt: { $gte: from, $lte: now } };
  const [statusRows, priorityRows, categoryRows, openRows, oldOpen, resolutionRow, resolvedWindow] = await Promise.all([
    TicketMongooseModel.aggregate([
      { $match: dateMatch },
      { $group: { _id: { $ifNull: ['$status', 'open'] }, count: { $sum: 1 } } },
    ]),
    TicketMongooseModel.aggregate([
      { $match: { ...dateMatch, status: { $nin: ['resolved', 'closed'] } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    TicketMongooseModel.aggregate([
      { $match: dateMatch },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    TicketMongooseModel.countDocuments({ status: { $nin: ['resolved', 'closed'] } }),
    TicketMongooseModel.countDocuments({
      status: { $nin: ['resolved', 'closed'] },
      createdAt: { $lt: new Date(now.getTime() - 3 * DAY_MS) },
    }),
    TicketMongooseModel.aggregate([
      { $match: { ...dateMatch, resolvedAt: { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } }, count: { $sum: 1 } } },
    ]),
    TicketMongooseModel.countDocuments({ resolvedAt: { $gte: from, $lte: now } }),
  ]);
  const total = statusRows.reduce((sum, row) => sum + num(row.count), 0);
  const resolved = resolvedWindow;
  const highPriority = priorityRows.filter((row) => String(row._id).toLowerCase() === 'high').reduce((sum, row) => sum + num(row.count), 0);
  const resolution = resolutionRow[0] ?? { avgMs: null, count: 0 };
  const avgHours = resolution.avgMs === null ? null : Math.round((num(resolution.avgMs) / 3600000) * 10) / 10;

  return {
    domain: 'support',
    title: 'Support & trust summary',
    description: 'Ticket load, unresolved demand and response health so the team knows where to intervene.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'open', label: 'Open tickets', value: openRows, format: 'number', tone: openRows > 0 ? 'warn' : 'ok', detail: 'All unresolved tickets', link: '/tickets' },
      { key: 'old', label: 'Open over 3 days', value: oldOpen, format: 'number', tone: oldOpen > 0 ? 'danger' : 'ok', detail: 'Needs an owner and a next step', link: '/tickets' },
      { key: 'high', label: 'High-priority open', value: highPriority, format: 'number', tone: highPriority > 0 ? 'danger' : 'neutral', detail: 'Triage first' },
      { key: 'resolved', label: 'Resolved in window', value: resolved, format: 'number', tone: 'ok', detail: `${total} tickets created` },
      { key: 'resolution', label: 'Average resolution', value: avgHours === null ? '—' : `${avgHours}h`, format: 'text', tone: 'info', detail: `${num(resolution.count)} completed resolutions` },
    ],
    trends: [],
    distributions: [
      { key: 'status', title: 'Ticket status', type: 'donut', items: statusRows.map((row) => ({ label: row._id || 'open', value: num(row.count) })), format: 'number' },
      { key: 'priority', title: 'Open by priority', type: 'bar', items: priorityRows.map((row) => ({ label: row._id || 'Normal', value: num(row.count) })), format: 'number' },
      { key: 'category', title: 'Top ticket categories', type: 'bar', items: distribution(categoryRows.map((row) => ({ label: row._id || 'Uncategorised', value: num(row.count) })), { limit: 8 }), format: 'number' },
    ],
    alerts: [
      ...(oldOpen > 0 ? [{ tone: 'danger', title: `${oldOpen} ticket${oldOpen === 1 ? '' : 's'} open over 3 days`, detail: 'Assign an owner or close with a clear resolution.', link: '/tickets' }] : []),
      ...(highPriority > 0 ? [{ tone: 'warn', title: `${highPriority} high-priority open ticket${highPriority === 1 ? '' : 's'}`, detail: 'Clear these before normal queue work.', link: '/tickets' }] : []),
    ],
  };
};

const contentSummary = async ({ days, from, now }) => {
  const latest = await WeeklyVideoModel.findOne({ status: 'published' }).sort({ weekStart: -1 }).lean();
  const [publishedVideos, latestProgress, latestComments, completionDaily, courseRows, trainingProgress, certificateCount] = await Promise.all([
    WeeklyVideoModel.countDocuments({ status: 'published' }),
    latest
      ? WeeklyVideoProgressModel.aggregate([
        { $match: { videoId: latest._id } },
        { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] } } } },
      ])
      : Promise.resolve([]),
    latest ? WeeklyVideoCommentModel.countDocuments({ videoId: latest._id, status: 'visible' }) : Promise.resolve(0),
    WeeklyVideoProgressModel.aggregate([
      { $match: { completedAt: { $gte: from, $lte: now } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    TrainingCourseModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    TrainingProgressModel.countDocuments({}),
    TrainingProgressModel.countDocuments({ certificateAt: { $ne: null } }),
  ]);
  const progress = latestProgress[0] ?? { total: 0, completed: 0 };
  const completionRate = num(progress.total) > 0 ? Math.round((num(progress.completed) / num(progress.total)) * 100) : 0;
  const publishedCourses = courseRows.find((row) => row._id === 'published')?.count ?? 0;
  const buckets = buildBuckets(from, now, days);

  return {
    domain: 'content',
    title: 'Content & learning summary',
    description: 'Weekly video follow-through, reflection participation and course completion.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'videos', label: 'Published weekly videos', value: publishedVideos, format: 'number', tone: 'brand', detail: latest ? `Latest: ${latest.title}` : 'No video published', link: '/weekly-videos' },
      { key: 'watch', label: 'Latest watch completion', value: completionRate, format: 'percent', tone: completionRate >= 70 ? 'ok' : 'warn', detail: `${num(progress.completed)} of ${num(progress.total)} starters completed`, link: '/weekly-videos' },
      { key: 'reflections', label: 'Latest reflections', value: latestComments, format: 'number', tone: 'info', detail: 'Shared lessons on the latest video', link: '/weekly-videos' },
      { key: 'courses', label: 'Published courses', value: publishedCourses, format: 'number', tone: 'brand', detail: 'Across the training academy', link: '/training-quizzes' },
      { key: 'learners', label: 'Training progress records', value: trainingProgress, format: 'number', tone: 'info', detail: `${certificateCount} certificates earned` },
    ],
    trends: [{
      key: 'completions',
      title: 'Weekly video completions',
      type: 'line',
      labels: buckets.map((bucket) => bucket.label),
      series: [{
        name: 'Completions',
        color: COLORS[1],
        values: seriesFromDaily(completionDaily.map((row) => ({ _id: row._id, days, count: row.count })), buckets),
      }],
      format: 'number',
    }],
    distributions: [
      { key: 'courses', title: 'Course status', type: 'donut', items: courseRows.map((row) => ({ label: row._id || 'Unknown', value: num(row.count) })), format: 'number' },
    ],
    alerts: [
      ...(latest && completionRate < 50 ? [{ tone: 'warn', title: 'Weekly video completion is below half', detail: 'Use the dashboard reminder and a personal follow-up to bring members back.', link: '/weekly-videos' }] : []),
      ...(!latest ? [{ tone: 'info', title: 'No weekly video is published', detail: 'Publish this week’s briefing so the reminder job can run.', link: '/weekly-videos' }] : []),
    ],
  };
};

const communicationsSummary = async ({ days, from, now }) => {
  const buckets = buildBuckets(from, now, days);
  const [subscriptionRows, subscriptionDaily, broadcastRows, sentRow] = await Promise.all([
    EmailSubscriptionModel.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    EmailSubscriptionModel.aggregate([
      { $match: { deletedAt: null, createdAt: { $gte: from, $lte: now } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    BroadcastModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, recipients: { $sum: '$recipientCount' } } }]),
    BroadcastModel.aggregate([
      { $match: { status: 'sent', createdAt: { $gte: from, $lte: now } } },
      { $group: { _id: null, count: { $sum: 1 }, recipients: { $sum: '$recipientCount' } } },
    ]),
  ]);
  const totalSubscribers = subscriptionRows.reduce((sum, row) => sum + num(row.count), 0);
  const confirmed = subscriptionRows
    .filter((row) => ['confirmed', 'active', 'subscribed'].includes(String(row._id ?? '').toLowerCase()))
    .reduce((sum, row) => sum + num(row.count), 0);
  const pending = subscriptionRows
    .filter((row) => ['pending', 'unconfirmed'].includes(String(row._id ?? '').toLowerCase()))
    .reduce((sum, row) => sum + num(row.count), 0);
  const sent = sentRow[0] ?? { count: 0, recipients: 0 };
  const scheduled = broadcastRows.find((row) => row._id === 'scheduled')?.count ?? 0;
  const failed = broadcastRows.find((row) => row._id === 'failed')?.count ?? 0;

  return {
    domain: 'communications',
    title: 'Communications summary',
    description: 'List health, platform announcements and audience reach.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      { key: 'subscribers', label: 'Email subscribers', value: totalSubscribers, format: 'number', tone: 'brand', detail: `${confirmed} confirmed · ${pending} pending`, link: '/subscriptions' },
      { key: 'sent', label: 'Broadcasts sent', value: num(sent.count), format: 'number', tone: 'ok', detail: `In the last ${days} days`, link: '/broadcast' },
      { key: 'reach', label: 'Recipients reached', value: num(sent.recipients), format: 'number', tone: 'info', detail: 'Across sent broadcasts in this window' },
      { key: 'scheduled', label: 'Scheduled broadcasts', value: scheduled, format: 'number', tone: 'info', detail: 'Waiting for their send time', link: '/broadcast' },
      { key: 'failed', label: 'Failed broadcasts', value: failed, format: 'number', tone: failed ? 'danger' : 'neutral', detail: failed ? 'Review delivery errors' : 'No delivery failures' },
    ],
    trends: [{
      key: 'subscribers',
      title: 'New subscribers',
      type: 'line',
      labels: buckets.map((bucket) => bucket.label),
      series: [{
        name: 'Subscribers',
        color: COLORS[3],
        values: seriesFromDaily(subscriptionDaily.map((row) => ({ _id: row._id, days, count: row.count })), buckets),
      }],
      format: 'number',
    }],
    distributions: [
      { key: 'subscriptions', title: 'Subscriber status', type: 'donut', items: subscriptionRows.map((row) => ({ label: row._id || 'Unknown', value: num(row.count) })), format: 'number' },
      { key: 'broadcasts', title: 'Broadcast status', type: 'bar', items: broadcastRows.map((row) => ({ label: row._id || 'Unknown', value: num(row.count) })), format: 'number' },
    ],
    alerts: [
      ...(pending > 0 ? [{ tone: 'info', title: `${pending} subscriber${pending === 1 ? '' : 's'} awaiting confirmation`, detail: 'A clean list keeps broadcast deliverability healthy.', link: '/subscriptions' }] : []),
      ...(failed > 0 ? [{ tone: 'danger', title: `${failed} broadcast${failed === 1 ? '' : 's'} failed`, detail: 'Open the broadcast desk and retry the failed audience.', link: '/broadcast' }] : []),
    ],
  };
};

const overviewSummary = async ({ days, from, now }) => {
  const [people, finance, commerce, growth, support, content, communications] = await Promise.all([
    peopleSummary({ days, from, now }),
    financeSummary({ days, from, now }),
    commerceSummary({ days, from, now }),
    growthSummary({ days, from, now }),
    supportSummary({ days, from, now }),
    contentSummary({ days, from, now }),
    communicationsSummary({ days, from, now }),
  ]);
  const kpi = (summary, key) => summary.kpis.find((item) => item.key === key);
  const pick = (summary, keys) => keys.map((key) => kpi(summary, key)).filter(Boolean);
  const alerts = [people, finance, commerce, growth, support, content, communications]
    .flatMap((summary) => summary.alerts)
    .slice(0, 5);

  return {
    domain: 'overview',
    title: 'Platform overview',
    description: 'The cross-domain picture: people, money, commerce, support, growth and learning in one place.',
    generatedAt: now.toISOString(),
    window: { days, from: from.toISOString(), to: now.toISOString() },
    kpis: [
      ...pick(people, ['total', 'active', 'new']),
      ...pick(finance, ['in', 'out', 'net']),
      ...pick(commerce, ['gmv', 'escrow']),
      ...pick(support, ['open']),
      ...pick(growth, ['campaigns']),
      ...pick(content, ['watch']),
      ...pick(communications, ['subscribers']),
    ],
    trends: [
      finance.trends[0],
      people.trends[0],
      commerce.trends[0],
    ].filter(Boolean),
    distributions: [
      commerce.distributions[0],
      support.distributions[0],
    ].filter(Boolean),
    alerts,
  };
};

export class AdminSummaryRepository {
  async people({ days, from, now }) {
    return peopleSummary({ days, from, now });
  }

  async finance({ days, from, now }) {
    return financeSummary({ days, from, now });
  }

  async commerce({ days, from, now }) {
    return commerceSummary({ days, from, now });
  }

  async growth({ days, from, now }) {
    return growthSummary({ days, from, now });
  }

  async support({ days, from, now }) {
    return supportSummary({ days, from, now });
  }

  async content({ days, from, now }) {
    return contentSummary({ days, from, now });
  }

  async communications({ days, from, now }) {
    return communicationsSummary({ days, from, now });
  }

  async overview({ days, from, now }) {
    return overviewSummary({ days, from, now });
  }
}

export const summaryWindow = (days, now = new Date()) => {
  const size = Math.min(Math.max(Number(days) || 30, 7), 365);
  const to = new Date(now);
  const from = new Date(to.getTime() - size * DAY_MS);
  return { days: size, from, to };
};

export const summaryColors = COLORS;
