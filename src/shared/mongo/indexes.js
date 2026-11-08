/**
 * Index hardening for v1 slice queries — applied at boot via
 * `ensureIndexes()` (idempotent `createIndex`, safe to re-run).
 *
 * Audit (2026-09): legacy schemas index almost nothing. The gaps below
 * were found by mapping every slice aggregation to its query shape:
 * - partners.partnerOf: NO index — every network traversal, recruit count
 *   and ancestor walk collection-scans. Highest value, added first.
 * - prospects: NO indexes — pipeline, funnel, stuck and conversion counts.
 * - carts: NO indexes — all personal/team volume windows + activation.
 * - commissions: earnerId+status+createdAt exists; releasedAt leg missing.
 * - goals: partnerId exists; list sorts by endDate (new leg).
 * - partners.dobMonth+dobDay: derived birthday parts (R6 follow-up).
 * - stored-notifications (N1/N2): center list leg, unique producer-key
 *   leg (partial — legacy unkeyed rows excluded), title/body text leg.
 * - notification-preferences (N5): digest-subscriber sweep leg.
 * - partners.status+_id (N2/N3): active-partner job sweeps.
 * - partners.username: covered by the schema's UNIQUE username_1 (do NOT
 *   re-request it here — same auto-name + different spec = every-boot
 *   IndexOptionsConflict). The unique leg serves @mention lookups best.
 * - progressions confirmedBy legs: responsiveness signal (own decisions).
 * Read-state TTL + request/report indexes already exist — untouched.
 */
/**
 * Legacy global phone uniqueness (prevents cross-partner same phone).
 * Must be dropped — scoped check in the crm slice owns this now.
 * We drop by name and also scan for any unique {prospectPhone:1} index
 * regardless of name, so renames or Atlas-managed names are covered.
 */
const LEGACY_DROP = [
  { collection: 'prospects', indexName: 'prospectPhone_1' },
  { collection: 'prospects', indexName: 'prospectEmail_1' },
  { collection: 'bookings', indexName: 'username_1' },
  // Email-subscription username was unique: every footer subscribe
  // defaulted to 'business', so subscriber #2 onward 500d. Uniqueness
  // removed from the schema; drop the stale built index here.
  { collection: 'email-subscriptions', indexName: 'username_1' },
  // Contact email was unique: a visitor could only ever send one message.
  // Uniqueness removed from the schema; drop the stale built index here.
  { collection: 'contacts', indexName: 'email_1' },
  // Reservation codes are optional for open signup. The old non-sparse
  // unique index rejects every account without a code after the first;
  // the sparse unique replacement is created from INDEXES below.
  { collection: 'partners', indexName: 'reservationCode_1' },
];

export const INDEXES = [
  { collection: 'partners', keys: { partnerOf: 1 }, options: {} },
  {
    collection: 'partners',
    keys: { reservationCode: 1 },
    options: { unique: true, sparse: true, name: 'reservationCode_sparse_1' },
  },
  {
    collection: 'partners',
    keys: { emailVerificationTokenHash: 1 },
    options: { unique: true, sparse: true, name: 'emailVerificationTokenHash_sparse_1' },
  },
  { collection: 'partners', keys: { partnerOf: 1, createdAt: -1 }, options: {} },
  // Admin directory: newest-first sort leg + role/suspended filter legs.
  { collection: 'partners', keys: { createdAt: -1 }, options: {} },
  { collection: 'partners', keys: { role: 1, createdAt: -1 }, options: {} },
  { collection: 'partners', keys: { suspendedAt: 1 }, options: {} },
  { collection: 'partners', keys: { dobMonth: 1, dobDay: 1 }, options: {} },
  { collection: 'prospects', keys: { partnerId: 1, createdAt: -1 }, options: {} },
  { collection: 'prospects', keys: { partnerId: 1, 'status.stage': 1 }, options: {} },
  // Downline contact-list coaching query (?status=&attention= match the
  // free-text `status.name` on both status shapes via anchored regexes).
  { collection: 'prospects', keys: { partnerId: 1, 'status.name': 1 }, options: {} },
  { collection: 'prospects', keys: { partnerId: 1, updatedAt: -1 }, options: {} },
  { collection: 'prospects', keys: { partnerId: 1, prospectSource: 1, createdAt: -1 }, options: {} },
  { collection: 'prospects', keys: { partnerId: 1, campaignId: 1, createdAt: -1 }, options: {} },
  { collection: 'prospects', keys: { partnerId: 1, prospectPhone: 1 }, options: { unique: true } },
  { collection: 'carts', keys: { partner: 1, orderStatus: 1, createdAt: -1 }, options: {} },
  { collection: 'carts', keys: { orderNumber: 1 }, options: {} },
  { collection: 'commissions', keys: { earnerId: 1, status: 1, releasedAt: -1 }, options: {} },
  { collection: 'goals', keys: { partnerId: 1, endDate: 1 }, options: {} },
  { collection: 'messages', keys: { recipientId: 1, createdAt: -1 }, options: {} },
  { collection: 'messages', keys: { senderId: 1, createdAt: -1 }, options: {} },
  { collection: 'communityposts', keys: { mentions: 1, createdAt: -1 }, options: {} },
  { collection: 'communitycomments', keys: { mentions: 1, createdAt: -1 }, options: {} },
  { collection: 'stored-notifications', keys: { recipientId: 1, archivedAt: 1, createdAt: -1 }, options: {} },
  {
    collection: 'stored-notifications',
    keys: { recipientId: 1, key: 1 },
    options: { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
  },
  { collection: 'stored-notifications', keys: { title: 'text', body: 'text' }, options: {} },
  { collection: 'notification-preferences', keys: { emailDigest: 1, partnerId: 1 }, options: {} },
  { collection: 'partners', keys: { status: 1, _id: 1 }, options: {} },
  { collection: 'ora-conversations', keys: { partnerId: 1, updatedAt: -1 }, options: {} },
  { collection: 'ora-actions', keys: { partnerId: 1, status: 1, createdAt: -1 }, options: {} },
  { collection: 'ora-plans', keys: { partnerId: 1, dateKey: 1 }, options: { unique: true } },
  { collection: 'bonus_seed_state', keys: { key: 1 }, options: { unique: true, name: 'key_1' } },
  { collection: 'progressions', keys: { 'ipo.confirmedBy': 1, 'ipo.confirmedAt': 1 }, options: {} },
  { collection: 'progressions', keys: { 'qsg.confirmedBy': 1, 'qsg.confirmedAt': 1 }, options: {} },
  { collection: 'progressions', keys: { 'smo.confirmedBy': 1, 'smo.confirmedAt': 1 }, options: {} },
  { collection: 'events', keys: { startsAt: 1 }, options: {} },
  { collection: 'events', keys: { authorId: 1, startsAt: -1 }, options: {} },
  { collection: 'eventrsvps', keys: { eventId: 1 }, options: {} },
  // Admin email-list desk: newest-first sort leg.
  { collection: 'email-subscriptions', keys: { createdAt: -1 }, options: {} },
  { collection: 'email-subscriptions', keys: { email: 1 }, options: {} },
  { collection: 'email-subscriptions', keys: { confirmTokenHash: 1 }, options: { sparse: true } },
  { collection: 'email-subscriptions', keys: { unsubscribeTokenHash: 1 }, options: { sparse: true } },
  { collection: 'activation_orders', keys: { partnerId: 1, createdAt: -1 }, options: {} },
  { collection: 'activation_orders', keys: { status: 1, createdAt: 1 }, options: {} },
  {
    collection: 'activation_orders',
    keys: { idempotencyKey: 1 },
    options: { unique: true, sparse: true, name: 'idempotencyKey_sparse_1' },
  },
  { collection: 'activation_queue', keys: { status: 1, enteredAt: 1 }, options: {} },
  { collection: 'kyc_submissions', keys: { status: 1, submittedAt: 1 }, options: {} },
  { collection: 'growth_campaigns', keys: { ownerId: 1, createdAt: -1 }, options: {} },
  { collection: 'growth_campaigns', keys: { status: 1, createdAt: 1 }, options: {} },
  { collection: 'growth_campaigns', keys: { status: 1, 'flight.startAt': 1 }, options: {} },
  { collection: 'growth_campaigns', keys: { trackingCode: 1 }, options: { unique: true } },
  { collection: 'partner_allocations', keys: { campaignId: 1, status: 1 }, options: {} },
  { collection: 'partner_allocations', keys: { campaignId: 1, allocatedAt: -1 }, options: {} },
  { collection: 'partner_allocations', keys: { ownerId: 1, allocatedAt: -1 }, options: {} },
  { collection: 'partners', keys: { placementCampaignId: 1 }, options: {} },
  { collection: 'partners', keys: { commissionRank: 1 }, options: {} },
  { collection: 'commission_sales', keys: { orderId: 1 }, options: { unique: true } },
  { collection: 'commission_sales', keys: { partnerId: 1, status: 1 }, options: {} },
  { collection: 'commission_sales', keys: { status: 1, activatedAt: 1 }, options: {} },
  { collection: 'growth_commissions', keys: { saleId: 1, level: 1 }, options: { unique: true } },
  { collection: 'growth_commissions', keys: { earnerId: 1, status: 1, createdAt: -1 }, options: {} },
  { collection: 'growth_commissions', keys: { status: 1, createdAt: 1 }, options: {} },
  { collection: 'growth_commissions', keys: { saleType: 1, createdAt: -1 }, options: {} },
  { collection: 'product_commission_sales', keys: { cartId: 1 }, options: { unique: true } },
  { collection: 'product_commission_sales', keys: { buyerId: 1, status: 1 }, options: {} },
  { collection: 'product_commission_sales', keys: { status: 1, createdAt: 1 }, options: {} },
  { collection: 'mentor_bonuses', keys: { orderId: 1 }, options: { unique: true } },
  { collection: 'mentor_bonuses', keys: { status: 1, dueAt: 1 }, options: {} },
  { collection: 'mentor_bonuses', keys: { mentorId: 1, status: 1, createdAt: -1 }, options: {} },
  { collection: 'stores', keys: { partnerId: 1 }, options: { unique: true } },
  { collection: 'stores', keys: { slug: 1 }, options: { unique: true } },
  { collection: 'stores', keys: { status: 1, updatedAt: -1, _id: -1 }, options: {} },
  { collection: 'stores', keys: { name: 1 } , options: {} },
  { collection: 'stores', keys: { name: 'text', tagline: 'text', bio: 'text' }, options: {} },
  { collection: 'products', keys: { status: 1, sortOrder: 1, createdAt: -1 }, options: {} },
  { collection: 'products', keys: { name: 1 }, options: {} },
  { collection: 'products', keys: { name: 'text', shortDesc: 'text', desc: 'text', category: 'text' }, options: {} },
  { collection: 'store_products', keys: { storeId: 1, productId: 1 }, options: { unique: true } },
  { collection: 'store_products', keys: { storeId: 1, status: 1, createdAt: -1 }, options: {} },
  { collection: 'store_products', keys: { partnerId: 1, status: 1 }, options: {} },
  { collection: 'store_inventory', keys: { partnerId: 1, productId: 1 }, options: { unique: true } },
  { collection: 'store_stock_ledger', keys: { partnerId: 1, createdAt: -1 }, options: {} },
  { collection: 'store_orders', keys: { reference: 1 }, options: { unique: true } },
  { collection: 'store_orders', keys: { orderNumber: 1 }, options: { unique: true } },
  { collection: 'store_orders', keys: { partnerId: 1, createdAt: -1 }, options: {} },
  { collection: 'store_orders', keys: { storeId: 1, createdAt: -1 }, options: {} },
  { collection: 'store_orders', keys: { status: 1, expiresAt: 1 }, options: {} },
  { collection: 'store_orders', keys: { status: 1, 'escrow.status': 1, 'escrow.releaseAt': 1 }, options: {} },
  { collection: 'store_escrow_ledger', keys: { orderId: 1, type: 1 }, options: { unique: true } },
  { collection: 'store_escrow_ledger', keys: { partnerId: 1, createdAt: -1 }, options: {} },
  { collection: 'platform_settings', keys: { key: 1 }, options: { unique: true } },
  { collection: 'chatgroups', keys: { rankGroup: 1 }, options: { unique: true, sparse: true } },
];

/**
 * One retry for transient Atlas network blips (pool cleared, monitor
 * closed, topology churn on free/shared tiers). Deterministic errors
 * (conflicts, bad specs) never match and still fail fast on attempt one.
 */
const transientRe = /pool.*cleared|monitor.*closed|topology.*closed|connection.*closed|ECONNRESET|ETIMEDOUT/i;
const attempt = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    if (transientRe.test(error?.message ?? '')) return await fn();
    throw error;
  }
};

/**
 * @param {import('mongoose').Mongoose} mongoose connected instance
 * @returns {{created: string[], failed: Array<{index: string, error: string}>}}
 */
export async function ensureIndexes(mongoose, { collections = INDEXES } = {}) {
  const created = [];
  const failed = [];
  const db = mongoose.connection?.db;
  if (!db) throw new Error('ensureIndexes requires a connected mongoose instance');
  for (const { collection, indexName } of LEGACY_DROP) {
    try {
      await attempt(() => db.collection(collection).dropIndex(indexName));
      created.push(`${collection}:dropped:${indexName}`);
    } catch (error) {
      if (!/index not found/i.test(error?.message ?? '')) {
        failed.push({ index: `${collection}:${indexName}`, error: error?.message ?? String(error) });
      }
    }
  }
  // Belt-and-braces: drop any remaining unique {prospectPhone:1} or
  // {prospectEmail:1} that survived a rename or manual creation, plus the
  // legacy bookings username unique that blocked multiple bookings.
  try {
    for (const coll of ['prospects', 'bookings']) {
      const idxs = await db.collection(coll).indexes();
      for (const idx of idxs) {
        const keys = idx.key ?? {};
        const isProspectPhoneUnique = coll === 'prospects' && Object.keys(keys).length === 1 && keys.prospectPhone === 1 && idx.unique === true;
        const isProspectEmailUnique = coll === 'prospects' && Object.keys(keys).length === 1 && keys.prospectEmail === 1 && idx.unique === true;
        const isBookingUsernameUnique = coll === 'bookings' && Object.keys(keys).length === 1 && keys.username === 1 && idx.unique === true;
        if (isProspectPhoneUnique || isProspectEmailUnique || isBookingUsernameUnique) {
          try {
            await attempt(() => db.collection(coll).dropIndex(idx.name));
            created.push(`${coll}:dropped:${idx.name}`);
          } catch (error) {
            failed.push({ index: `${coll}:${idx.name}`, error: error?.message ?? String(error) });
          }
        }
      }
    }
  } catch { /* listing indexes is best-effort */ }
  // Same protection for the old partner reservationCode unique index,
  // regardless of its name, so open signups are never blocked by it.
  try {
    for (const idx of await db.collection('partners').indexes()) {
      const keys = idx.key ?? {};
      const isReservationUnique = Object.keys(keys).length === 1
        && keys.reservationCode === 1
        && idx.unique === true
        && !idx.sparse
        && !idx.partialFilterExpression;
      if (isReservationUnique) {
        try {
          await attempt(() => db.collection('partners').dropIndex(idx.name));
          created.push(`partners:dropped:${idx.name}`);
        } catch (error) {
          failed.push({ index: `partners:${idx.name}`, error: error?.message ?? String(error) });
        }
      }
    }
  } catch { /* listing indexes is best-effort */ }
  for (const { collection, keys, options } of collections) {
    const name = `${collection}:${JSON.stringify(keys)}`;
    try {
      await attempt(() => db.collection(collection).createIndex(keys, options));
      created.push(name);
    } catch (error) {
      failed.push({ index: name, error: error?.message ?? String(error) });
    }
  }
  return { created, failed };
}
