import { ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';
import { toSafePartner } from '../domain/Partner.entity.js';
import { lenientRole } from '../domain/PartnerRole.js';

/**
 * Member 360 — one admin read answering "who is this member and do I need
 * to act?" Identity + contact + login telemetry + money snapshot +
 * growth signals + computed risk flags. Composed from bounded reads with
 * per-section fallbacks (a failing counter never 500s the profile).
 * Why usecase-shaped like a dashboard query: the admin console is the only
 * caller today, but support tooling reuses it tomorrow.
 */
export class GetMember360UseCase {
  /** @param {{partners, transactions, deposits, prospects, progress}} deps */
  constructor({ partners, transactions, deposits, prospects, progress }) {
    Object.assign(this, { partners, transactions, deposits, prospects, progress });
  }

  async execute({ requesterId, partnerId }) {
    if (String(requesterId) === String(partnerId)) {
      throw new ForbiddenException('Open your own record from Me & Settings');
    }
    const member = await this.partners.findById(partnerId);
    if (!member) throw new NotFoundException('Partner not found');
    const id = String(member._id ?? member.id ?? partnerId);
    const [money, leads, journey, upline] = await Promise.all([
      this.money(id).catch(() => ({ balance: Number(member.balance ?? 0), in30d: null, txCount: null })),
      this.growth(id).catch(() => ({ activeLeads: null, claims7d: null, rating: null })),
      this.journey(id).catch(() => ({ level: '—', rankAt: null })),
      this.resolveUpline(member).catch(() => null),
    ]);
    return {
      identity: this.identity(member),
      login: this.login(member),
      money,
      growth: leads,
      journey,
      upline,
      risks: this.risks(member, money, leads),
    };
  }

  identity(member) {
    const safe = toSafePartner(member);
    return {
      id: String(safe.id ?? safe._id),
      name: [safe.name, safe.surname].filter(Boolean).join(' ') || safe.username,
      username: safe.username ?? null,
      email: safe.email ?? null,
      phone: safe.phone ?? null,
      state: safe.address?.state ?? null,
      role: lenientRole(safe.role),
      suspended: !!safe.suspended,
      suspendReason: safe.suspendReason ?? null,
      createdAt: safe.createdAt ?? null,
    };
  }

  login(member) {
    const at = member.lastLoginAt ? new Date(member.lastLoginAt) : null;
    const valid = at && !Number.isNaN(at.getTime()) ? at : null;
    const days = valid ? Math.floor((Date.now() - valid.getTime()) / 86400000) : null;
    return {
      lastLoginAt: valid ? valid.toISOString() : null,
      daysSinceLogin: days,
      neverSeen: !valid,
      loginCount: Number(member.loginCount ?? 0),
      lastIp: member.lastLoginIp ?? null,
      lastAgent: this.agentLabel(member.lastLoginAgent),
      dormant30: valid ? days >= 30 : true,
    };
  }

  agentLabel(agent) {
    const s = String(agent ?? '');
    if (!s) return null;
    if (/mobile|android|iphone|ipad/i.test(s)) return 'Mobile app browser';
    if (/windows|macintosh|linux/i.test(s)) return 'Desktop browser';
    return 'Browser';
  }

  async money(id) {
    const [balanceRow, recent, txCount] = await Promise.all([
      this.partners.findById(id).catch(() => null),
      this.transactions
        ? this.transactions.find({ partnerId: id }).sort({ createdAt: -1 }).limit(5).lean().catch(() => [])
        : [],
      this.transactions ? this.transactions.countDocuments({ partnerId: id }).catch(() => null) : null,
    ]);
    const in30d = recent
      ? recent
        .filter((t) => /credit|deposit|refund|fund|release/i.test(`${t.transactionType ?? ''} ${t.paymentMethod ?? ''}`))
        .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
      : null;
    return {
      balance: Number(balanceRow?.balance ?? 0),
      in30d,
      txCount,
      recent: (recent ?? []).map((t) => ({
        amount: Number(t.amount ?? 0),
        kind: String(t.transactionType ?? ''),
        method: String(t.paymentMethod ?? ''),
        status: String(t.status ?? ''),
        at: t.createdAt ?? t.date ?? null,
      })),
    };
  }

  async growth(id) {
    const since = new Date(Date.now() - 7 * 86400000);
    const [activeLeads, claims, ratings] = await Promise.all([
      this.prospects ? this.prospects.countDocuments({ partnerId: id, 'status.stage': { $ne: 'Converted' } }).catch(() => null) : null,
      this.prospects
        ? this.prospects.find({ partnerId: id, claimedAt: { $gte: since } }).select('rating').lean().catch(() => [])
        : [],
      this.deposits ? this.deposits.countDocuments({ partnerId: id }).catch(() => null) : null,
    ]);
    const scores = (claims ?? []).map((c) => Number(c?.rating?.score)).filter((n) => n >= 1 && n <= 5);
    return {
      activeLeads,
      claims7d: (claims ?? []).length,
      rating: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      ratingCount: scores.length,
      deposits: ratings,
    };
  }

  async journey(id) {
    if (!this.progress?.levelsFor) return { level: null, rankAt: null };
    const levels = await this.progress.levelsFor([id]).catch(() => null);
    if (!levels) return { level: null, rankAt: null };
    return { level: levels?.[id] ?? 'partner', rankAt: null };
  }

  async resolveUpline(member) {
    const upId = member.partnerOf;
    if (!upId) return null;
    const up = await this.partners.findById(String(upId)).catch(() => null);
    if (!up) return null;
    return {
      id: String(up._id ?? up.id ?? upId),
      name: [up.name, up.surname].filter(Boolean).join(' ') || up.username,
      username: up.username ?? null,
    };
  }

  risks(member, money, growth) {
    const flags = [];
    const days = member.lastLoginAt
      ? Math.floor((Date.now() - new Date(member.lastLoginAt).getTime()) / 86400000)
      : null;
    if (days === null || Number.isNaN(days)) flags.push({ tone: 'warn', label: 'Never signed in' });
    else if (days >= 30) flags.push({ tone: 'bad', label: `Dormant ${days}d` });
    if (member.suspendedAt) flags.push({ tone: 'bad', label: 'Suspended' });
    if (Number(money?.balance ?? 0) < 250 && (growth?.activeLeads ?? 0) > 0) {
      flags.push({ tone: 'warn', label: 'Low wallet for claims' });
    }
    if (!member.phone) flags.push({ tone: 'warn', label: 'No phone on file' });
    return flags;
  }
}
