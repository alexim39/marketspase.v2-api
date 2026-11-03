import { ConflictException, ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';
import { lenientRole, normalizeRole } from '../domain/PartnerRole.js';
import { normalizePermissions } from '../domain/Permissions.js';
import { toSafePartner } from '../domain/Partner.entity.js';

/**
 * Change a partner's role. Guards: cannot change your own role (would
 * lock you out or self-escalate silently) and cannot demote the last admin.
 */
export class SetPartnerRoleUseCase {
  /** @param {{partners}} deps */
  constructor({ partners }) {
    this.partners = partners;
  }

  async execute({ requesterId, partnerId, role }) {
    const next = normalizeRole(role);
    if (String(requesterId) === String(partnerId)) {
      throw new ForbiddenException('You cannot change your own role');
    }
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');

    if (lenientRole(target.role) === 'admin' && next !== 'admin') {
      const remaining = await this.partners.countByRole('admin');
      if (remaining <= 1) {
        throw new ConflictException('Cannot demote the last admin');
      }
    }

    const updated = await this.partners.updateById(partnerId, { role: next });
    return toSafePartner(updated);
  }
}

export class SetPartnerPermissionsUseCase {
  constructor({ partners }) {
    this.partners = partners;
  }

  async execute({ partnerId, permissions }) {
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');

    const updated = await this.partners.updateById(partnerId, {
      permissions: normalizePermissions(permissions),
    });
    return toSafePartner(updated);
  }
}

/** Paginated partner directory for the admin console (safe fields only). */
export class ListPartnersUseCase {
  /** @param {{partners}} deps */
  constructor({ partners }) {
    this.partners = partners;
  }

  async execute({ limit = 25, skip = 0, q = '', role = null, suspended = 'all', login = 'all', hideErased = true } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const { items, total } = await this.partners.listPartners({
      limit: lim,
      skip: sk,
      q: String(q ?? '').trim(),
      role: role && role !== 'all' ? String(role).toLowerCase() : null,
      suspended: ['yes', 'no'].includes(suspended) ? suspended : 'all',
      login: ['dormant30', 'new7', 'online', 'active1h'].includes(login) ? login : 'all',
      hideErased: hideErased !== false,
    });
    return { items: items.map(toSafePartner), total, limit: lim, skip: sk };
  }
}

/** Platform headcount for the admin console — totals, growth, roles, suspended. */
export class PlatformStatsUseCase {
  /** @param {{partners, progress?}} deps (progress optional — levels omitted without it) */
  constructor({ partners, progress = null }) {
    Object.assign(this, { partners, progress });
  }

  async execute() {
    const base = await this.partners.platformStats();
    let levels = {};
    if (this.progress?.levelDistribution) {
      levels = await this.progress.levelDistribution().catch(() => ({}));
    }
    const distributed = Object.values(levels).reduce((s, n) => s + Number(n), 0);
    return {
      ...base,
      levels,
      // Partners without a journey record yet (never touched progression).
      unranked: Math.max(0, base.total - distributed),
    };
  }
}

/**
 * Suspend / unsuspend a partner. Guards mirror role changes: never
 * yourself (locks you out mid-session) and never the last admin while
 * they still hold the role (locks the console out). Suspension blocks
 * signin immediately; live sessions die at the next session check.
 */
export class SetSuspendUseCase {
  /** @param {{partners, sessions?}} deps (`sessions` = {revoke, clear}; revoked live JWTs on suspend) */
  constructor({ partners, sessions = null }) {
    Object.assign(this, { partners, sessions });
  }

  async execute({ requesterId, partnerId, suspended, reason = null }) {
    if (String(requesterId) === String(partnerId)) {
      throw new ForbiddenException('You cannot suspend your own account');
    }
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');

    const next = !!suspended;
    if (next && lenientRole(target.role) === 'admin') {
      const remaining = await this.partners.countByRole('admin');
      if (remaining <= 1) {
        throw new ConflictException('Cannot suspend the last admin');
      }
    }

    const cleanReason = reason === undefined || reason === null || String(reason).trim() === ''
      ? null
      : String(reason).trim().slice(0, 500);
    const updated = await this.partners.updateById(partnerId, next
      ? { suspendedAt: new Date(), suspendReason: cleanReason }
      : { suspendedAt: null, suspendReason: null });
    // Live JWTs die on the next call (denylist); unsuspend clears it.
    if (this.sessions) {
      if (next) await this.sessions.revoke(String(partnerId), { reason: cleanReason, by: String(requesterId) }).catch(() => null);
      else await this.sessions.clear(String(partnerId)).catch(() => null);
    }
    return toSafePartner(updated);
  }
}

/**
 * Reset-on-behalf: an admin triggers the standard reset flow for a member
 * by id. The link goes to the MEMBER's email — admins never see or set
 * passwords. Unknown ids 404 (admin console, no enumeration concern).
 */
export class ResetOnBehalfUseCase {
  /** @param {{partners, reset}} deps (`reset` = RequestPasswordResetUseCase) */
  constructor({ partners, reset }) {
    Object.assign(this, { partners, reset });
  }

  async execute({ partnerId }) {
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');
    if (!target.email) throw new ConflictException('Partner has no email on record');
    return this.reset.execute({ email: String(target.email).toLowerCase() });
  }
}

/**
 * Reassign a partner's direct upline (partnerOf). Admin-only.
 * Guards: not yourself, target exists, no self-loop, no cycle
 * (new upline cannot be the member's own descendant). Commission,
 * tree and progression downstream recalc on next read — this only
 * rewires the parent pointer and audits the move.
 */
export class ReassignUplineUseCase {
  /** @param {{partners, network}} deps */
  constructor({ partners, network }) {
    Object.assign(this, { partners, network });
  }

  async execute({ requesterId, partnerId, newUplineId, newUplineUsername }) {
    if (String(requesterId) === String(partnerId)) {
      throw new ForbiddenException('You cannot change your own upline');
    }
    const member = await this.partners.findById(partnerId);
    if (!member) throw new NotFoundException('Partner not found');

    let targetId = newUplineId ? String(newUplineId).trim() : '';
    const username = newUplineUsername ? String(newUplineUsername).trim() : '';

    let target = null;
    if (targetId) {
      target = await this.partners.findById(targetId);
      if (!target) throw new NotFoundException('New upline not found');
    } else if (username) {
      // Resolve by username for the admin UX (type @market).
      const clean = username.replace(/^@/, '').trim();
      if (!clean) throw new ValidationException('Provide a valid username');
      const { PartnersModel } = await import('../../../apps/partner/models/partner.model.js');
      target = await PartnersModel.findOne({ username: clean }).lean().catch(() => null);
      if (!target) throw new NotFoundException(`Partner @${clean} not found`);
      targetId = String(target._id ?? target.id);
    } else {
      throw new ValidationException('Provide new upline id or username');
    }

    if (String(partnerId) === String(targetId)) {
      throw new ValidationException('A partner cannot be their own upline');
    }

    // Cycle guard: new upline must not sit under the member.
    if (this.network?.isAncestor) {
      const cycle = await this.network.isAncestor(partnerId, targetId).catch(() => false);
      if (cycle) throw new ConflictException('Cannot move a partner under their own downline — would create a cycle');
    } else {
      // Fallback BFS via network repo (collect downline).
      const downline = await this.partners.collectDownline?.(partnerId).catch(() => null);
      if (downline) {
        const ids = Array.isArray(downline) ? downline : downline.ids ?? [];
        if (ids.map(String).includes(String(targetId))) {
          throw new ConflictException('Cannot move a partner under their own downline — would create a cycle');
        }
      }
      // Last resort: walk parent chain of target up to 20 hops.
      if (!downline && this.partners.findById) {
        let cur = await this.partners.findById(targetId).catch(() => null);
        for (let d = 0; d < 20 && cur; d++) {
          const pid = cur.partnerOf ? String(cur.partnerOf) : null;
          if (!pid) break;
          if (pid === String(partnerId)) {
            throw new ConflictException('Cannot move a partner under their own downline — would create a cycle');
          }
          cur = await this.partners.findById(pid).catch(() => null);
        }
      }
    }

    const prevUplineId = member.partnerOf ? String(member.partnerOf) : null;
    const updated = await this.partners.updateById(partnerId, { partnerOf: targetId });
    return { member: toSafePartner(updated), prevUplineId, newUplineId: String(targetId), newUplineUsername: target?.username ?? username };
  }
}

/**
 * GDPR erasure: anonymize PII + delete member-owned working data.
 * Guards: never yourself, never the last admin, and never a partner
 * with downline — reassign recruits first (dangling partnerOf links
 * would orphan subtrees in trees, compliance and commission flow).
 *
 * Boundary (documented, deliberate): financial records (ledger entries,
 * transactions, carts/orders) and community posts are RETAINED for
 * dispute and accounting history; the author link stays but the profile
 * behind it is anonymous. The audit row records targetId + counts only —
 * never the erased PII.
 */
export class ErasePartnerUseCase {
  /** @param {{partners, prospects, tickets, codes, sessions?}} deps */
  constructor({ partners, prospects, tickets, codes, sessions = null }) {
    Object.assign(this, { partners, prospects, tickets, codes, sessions });
  }

  async execute({ requesterId, partnerId, viaSelfRequest = false }) {
    if (String(requesterId) === String(partnerId) && !viaSelfRequest) {
      throw new ForbiddenException('You cannot erase your own account');
    }
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');
    if (lenientRole(target.role) === 'admin') {
      const remaining = await this.partners.countByRole('admin');
      if (remaining <= 1) {
        throw new ConflictException('Cannot erase the last admin');
      }
    }
    const downline = await this.partners.countDownline
      ? await this.partners.countDownline(partnerId)
      : 0;
    // No orphaned subtrees: direct recruits move one level up first (their
    // own downlines follow by parent id). Only a root with downline still
    // refuses — there is nowhere above to move them.
    let movedDownline = 0;
    let newUplineId = null;
    if (downline > 0) {
      const upline = target.partnerOf ? String(target.partnerOf) : '';
      if (!upline) {
        throw new ConflictException(`Reassign ${downline} downline member(s) before erasing this account`);
      }
      newUplineId = upline;
      movedDownline = this.partners.reassignDownline
        ? await this.partners.reassignDownline(partnerId, upline)
        : 0;
    }

    const tag = `${String(target._id ?? target.id ?? partnerId).slice(-6)}${Math.random().toString(36).slice(2, 6)}`;
    const anonymized = {
      name: 'Deleted',
      surname: 'Member',
      email: `deleted_${tag}@deleted.local`.toLowerCase(),
      phone: `deleted_${tag}`,
      username: `deleted_${tag}`.toLowerCase(),
      password: `unusable:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
      bio: null,
      profileImage: null,
      testimonial: null,
      jobTitle: null,
      educationBackground: null,
      hobby: null,
      skill: null,
      whatsappGroupLink: null,
      whatsappChatLink: null,
      linkedinPage: null,
      youtubePage: null,
      instagramPage: null,
      tiktokPage: null,
      facebookPage: null,
      twitterPage: null,
      address: null,
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined,
      suspendedAt: new Date(),
      suspendReason: 'Account erased (GDPR)',
    };
    const updated = await this.partners.updateById(partnerId, anonymized);

    const removed = { prospects: 0, tickets: 0, codes: 0 };
    if (this.prospects?.deleteByPartner) {
      removed.prospects = await this.prospects.deleteByPartner(partnerId).catch(() => 0);
    }
    if (this.tickets?.deleteByPartner) {
      removed.tickets = await this.tickets.deleteByPartner(partnerId).catch(() => 0);
    }
    if (this.codes?.deleteByPartner) {
      removed.codes = await this.codes.deleteByPartner(partnerId).catch(() => 0);
    }
    if (this.sessions?.revoke) {
      await this.sessions.revoke(String(partnerId), { reason: 'Account erased', by: String(requesterId) }).catch(() => null);
    }
    return { erased: toSafePartner(updated), removed, movedDownline, newUplineId };
  }
}
