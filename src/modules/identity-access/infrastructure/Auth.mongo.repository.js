import { PartnersModel } from './Auth.models.js';

const opts = (session) => (session ? { session } : {});
const byId = (session) => (session ? { session } : {});

/**
 * Mongo implementations of the identity-access repository contracts.
 * Reads use `.lean()` — callers get plain objects, never Mongoose docs.
 */
export class MongoPartnerRepository {
  async findByEmail(email) {
    return PartnersModel.findOne({ email }).lean();
  }
  async findByUsername(username, { session } = {}) {
    const query = PartnersModel.findOne({ username: String(username ?? '').trim().toLowerCase() })
      .select('_id username accountState kycStatus suspendedAt');
    if (session) query.session(session);
    return query.lean();
  }
  async findById(id, { session } = {}) {
    return PartnersModel.findById(id, null, byId(session)).lean();
  }
  async existsByUsername(username, { session } = {}) {
    return (await PartnersModel.exists({ username }).setOptions(opts(session))) !== null;
  }
  async create(data, { session } = {}) {
    const [doc] = await PartnersModel.create([data], opts(session));
    return doc.toObject();
  }
  async updateById(id, patch, { session } = {}) {    // Strip `undefined` so clearing resetPasswordToken works via $unset-safe set
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const unset = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v === undefined).map(([k]) => [k, '']),
    );
    const update = { ...(Object.keys(clean).length ? { $set: clean } : {}) };
    if (Object.keys(unset).length) update.$unset = unset;
    return PartnersModel.findByIdAndUpdate(id, update, { new: true, ...opts(session) }).lean();
  }
  /** Atomic single-use email verification; token fields are select:false. */
  async consumeEmailVerificationToken(hash, now = new Date()) {
    return PartnersModel.findOneAndUpdate(
      {
        emailVerificationTokenHash: String(hash),
        emailVerificationExpires: { $gt: now },
      },
      {
        $set: { emailVerified: true, emailVerifiedAt: now },
        $unset: { emailVerificationTokenHash: '', emailVerificationExpires: '' },
      },
      { new: true },
    ).lean();
  }
  /** Login telemetry (Member 360) — stamp only, never fails signin. */
  async trackLogin(id, { at, ip = null, agent = null } = {}) {
    const now = at ?? new Date();
    return PartnersModel.findByIdAndUpdate(id, {
      $set: { lastLoginAt: now, lastSeenAt: now, ...(ip ? { lastLoginIp: ip } : {}), ...(agent ? { lastLoginAgent: agent } : {}) },
      $inc: { loginCount: 1 },
    }).lean().catch(() => null);
  }

  /**
   * Presence heartbeat — stamps `lastSeenAt` at most once per `idleMs`
   * (default 2 min) so a 4-min app ping costs ~1 write per cycle, not per
   * request. Returns true when a write happened.
   */
  async touchPresence(id, { idleMs = 120000, now = new Date() } = {}) {
    const cutoff = new Date(new Date(now).getTime() - Math.max(0, Number(idleMs) || 0));
    const res = await PartnersModel.updateOne(
      { _id: id, $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: cutoff } }] },
      { $set: { lastSeenAt: now instanceof Date ? now : new Date() } },
    ).catch(() => null);
    return (res?.modifiedCount ?? 0) > 0;
  }
  /** Signup cohort for activation analytics (bounded, recent first). */
  async activationCohort(ids, since) {
    if (ids.length === 0) return { total: 0, rows: [] };
    const filter = { _id: { $in: ids }, createdAt: { $gte: since } };
    const [total, docs] = await Promise.all([
      PartnersModel.countDocuments(filter),
      PartnersModel.find(filter)
        .select('createdAt phone address name surname username')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);
    return {
      total,
      capped: total > docs.length,
      rows: docs.map((d) => ({
        id: String(d._id),
        createdAt: d.createdAt,
        phone: d.phone ?? null,
        address: d.address ?? null,
        name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
        username: d.username,
      })),
    };
  }
  /** Bulk presence read — id + lastSeenAt only, capped, lean. */
  /**
   * Directory-safe labels for a bounded id set (username + display name).
   * Used by admin desks (e.g. ticket reporters) — never emails/phones.
   */
  async findLabelsByIds(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map((v) => String(v ?? '').trim()))]
      .filter((v) => /^[a-fA-F0-9]{24}$/.test(v)).slice(0, 100);
    if (list.length === 0) return [];
    const docs = await PartnersModel.find({ _id: { $in: list } })
      .select('_id username name surname')
      .limit(100)
      .lean()
      .catch(() => []);
    return (docs ?? []).map((d) => ({
      id: String(d._id),
      username: d.username ?? null,
      name: [d.name, d.surname].filter(Boolean).join(' ') || d.username || 'Member',
    }));
  }
  async findPresence(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map((v) => String(v ?? '').trim()))].slice(0, 100);
    if (list.length === 0) return [];
    const docs = await PartnersModel.find({ _id: { $in: list } })
      .select('_id lastSeenAt')
      .limit(100)
      .lean()
      .catch(() => []);
    return (docs ?? []).map((d) => ({ id: String(d._id), lastSeenAt: d.lastSeenAt ?? null }));
  }

  async findPlaybookSnapshots(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map((v) => String(v ?? '').trim()))]
      .filter((v) => /^[a-fA-F0-9]{24}$/.test(v)).slice(0, 2000);
    if (list.length === 0) return [];
    const docs = await PartnersModel.find({ _id: { $in: list } })
      .select('_id phone address accountState createdAt activatedAt profileImage')
      .limit(2000)
      .lean()
      .catch(() => []);
    return (docs ?? []).map((d) => ({
      id: String(d._id),
      phone: d.phone ?? '',
      address: d.address ?? null,
      accountState: d.accountState ?? 'member',
      createdAt: d.createdAt ?? null,
      activatedAt: d.activatedAt ?? null,
      profileImage: d.profileImage ?? null,
    }));
  }
  /** Case-insensitive role count (absorbs legacy 'User'/'admin' casing). */
  /**
   * Signup cohorts: member ids per trailing calendar month (newest last),
   * bounded per cohort so org rollups stay cheap at any scale.
   */
  async signupCohorts(months = 6, perCohortCap = 2000, now = new Date()) {
    const m = Math.min(Math.max(Number(months) || 6, 2), 12);
    const cap = Math.min(Math.max(Number(perCohortCap) || 2000, 100), 5000);
    const cursor = new Date(now);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    const out = [];
    for (let i = m - 1; i >= 0; i -= 1) {
      const start = new Date(cursor);
      start.setMonth(cursor.getMonth() - i);
      const end = new Date(start);
      end.setMonth(start.getMonth() + 1);
      const ids = await PartnersModel.find({ createdAt: { $gte: start, $lt: end } })
        .select('_id')
        .sort({ _id: 1 })
        .limit(cap)
        .lean();
      const y = start.getFullYear();
      const mo = String(start.getMonth() + 1).padStart(2, '0');
      out.push({ month: `${y}-${mo}`, ids: ids.map((r) => String(r._id)), capped: ids.length >= cap });
    }
    return out;
  }

  async countByRole(role) {
    return PartnersModel.find({ role: String(role) })
      .collation({ locale: 'en', strength: 2 })
      .countDocuments();
  }

  /** Direct recruits — GDPR erasure refuses while this is nonzero. */
  async countDownline(partnerId) {
    return PartnersModel.countDocuments({ partnerOf: partnerId });
  }

  /**
   * Erasure support: move direct recruits one level up (their subtrees
   * follow by parent id — no recursion, no cycles possible upward).
   * Returns the moved count.
   */
  async reassignDownline(partnerId, newUplineId) {
    const res = await PartnersModel.updateMany(
      { partnerOf: partnerId },
      { $set: { partnerOf: newUplineId } },
    ).catch(() => null);
    return res?.modifiedCount ?? 0;
  }

  /** Admin directory listing — lean, paginated, safe fields projected upstream. */
  async listPartners({ limit = 25, skip = 0, q = '', role = null, suspended = 'all', login = 'all', hideErased = true }) {
    const filter = {};
    // Erased accounts stay in the DB (ledger/audit trail) but leave the
    // directory view. Marker must match ErasePartnerUseCase's suspendReason.
    if (hideErased) filter.suspendReason = { $ne: 'Account erased (GDPR)' };
    if (q) {
      const escaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      const or = [{ name: re }, { surname: re }, { username: re }, { email: re }];
      // Phone numbers are digit strings users type bare — fold the needle
      // to digits so `0803 123` still matches `0803123…` rows.
      const digits = String(q).replace(/\D/g, '');
      if (digits.length >= 4) or.push({ phone: new RegExp(digits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      filter.$or = or;
    }
    if (role) {
      // Legacy rows store 'User'/'admin' free-text — match all casings.
      const r = String(role).toLowerCase();
      filter.role = { $in: [r, r.charAt(0).toUpperCase() + r.slice(1), r.toUpperCase()] };
    }
    if (suspended === 'yes') filter.suspendedAt = { $exists: true, $ne: null };
    else if (suspended === 'no') filter.suspendedAt = null;
    // Login-window filter for the directory's Active/Dormant tabs.
    const days = login === 'dormant30' ? 30 : login === 'new7' ? 7 : null;
    // Presence filters for the directory's Online tabs (lastSeenAt window).
    const presenceMin = login === 'online' ? 5 : login === 'active1h' ? 60 : null;
    if (presenceMin !== null) {
      filter.lastSeenAt = { $gte: new Date(Date.now() - presenceMin * 60000) };
    }
    if (days !== null) {
      const cutoff = new Date(Date.now() - days * 86400000);
      if (login === 'dormant30') {
        filter.$and = [
          ...(filter.$and ?? []),
          { $or: [{ lastLoginAt: { $lt: cutoff } }, { lastLoginAt: null }] },
        ];
      } else {
        filter.createdAt = { $gte: cutoff };
      }
    }
    const [items, total] = await Promise.all([
      PartnersModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PartnersModel.countDocuments(filter),
    ]);
    return { items, total };
  }
  /** Platform headcount for the admin console — one parallel batch, no documents. */
  async platformStats({ now = new Date() } = {}) {
    const t = new Date(now).getTime();
    const since = (days) => new Date(t - days * 24 * 60 * 60 * 1000);
    const role = (r) => PartnersModel.find({ role: r }).collation({ locale: 'en', strength: 2 }).countDocuments();
    const [total, new7d, new30d, user, leader, admin, suspended] = await Promise.all([
      PartnersModel.countDocuments({}),
      PartnersModel.countDocuments({ createdAt: { $gte: since(7) } }),
      PartnersModel.countDocuments({ createdAt: { $gte: since(30) } }),
      role('user'),
      role('leader'),
      role('admin'),
      PartnersModel.countDocuments({ suspendedAt: { $ne: null } }),
    ]);
    return { total, new7d, new30d, roles: { user, leader, admin }, suspended };
  }
}
