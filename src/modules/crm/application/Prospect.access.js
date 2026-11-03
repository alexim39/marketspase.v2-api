import { ForbiddenException, NotFoundException, UnauthorizedException } from '../../../shared/domain/AppError.js';
import { adminBootstrapEmails, lenientRole } from '../../identity-access/domain/PartnerRole.js';

/**
 * Prospect ownership guard — one rule for v1 + legacy routes.
 *
 * Levels:
 * - read:    owner, upline (ancestor) or admin. Outsiders get 404 (never
 *            confirm a stranger's prospect exists).
 * - support: owner, upline or admin. Stage moves, notes and touches logged
 *            by an upline ride `by/byName` attribution + owner notify
 *            downstream. Strangers get 403.
 * - owner:   owner or admin only. PII edits, history deletes, prospect
 *            deletes, converts and pool returns move money/identity/credit.
 *
 * Upline = requester appears in the owner's `partnerOf` ancestor chain
 * (bounded, cycle-safe). Admin = role check incl. bootstrap emails.
 * Every dependency is injected (fakes in tests, Mongoose in prod).
 */
const MAX_CHAIN = 12;

const sameId = (a, b) => !!a && !!b && String(a) === String(b);

export const isAdminDoc = (doc) => {
  if (!doc) return false;
  if (lenientRole(doc.role) === 'admin') return true;
  return adminBootstrapEmails().includes(String(doc.email ?? '').toLowerCase());
};

/** Walk the owner's upline chain; true when ancestorId is above ownerId. */
export const isUplineOf = async (findPartnerById, ancestorId, ownerId) => {
  if (!ancestorId || !ownerId || sameId(ancestorId, ownerId)) return false;
  const seen = new Set([String(ownerId)]);
  let current = String(ownerId);
  for (let d = 0; d < MAX_CHAIN && current; d++) {
    const node = await findPartnerById(current).catch(() => null);
    const parent = node?.partnerOf ? String(node.partnerOf) : null;
    if (!parent) return false;
    if (parent === String(ancestorId)) return true;
    if (seen.has(parent)) return false;
    seen.add(parent);
    current = parent;
  }
  return false;
};

/**
 * @param {{findProspectById, findPartnerById}} deps
 *   findProspectById(id) -> {partnerId} | null (invalid ids resolve null)
 *   findPartnerById(id) -> {role?, email?, partnerOf?} | null
 */
export const buildProspectAccess = ({ findProspectById, findPartnerById }) => {  if (!findProspectById || !findPartnerById) throw new Error('buildProspectAccess requires findProspectById + findPartnerById');

  const loadOwner = async (prospectId) => {
    const doc = await findProspectById(prospectId).catch(() => null);
    if (!doc || !doc.partnerId) throw new NotFoundException('Prospect not found');
    return { doc, ownerId: String(doc.partnerId) };
  };

  const requester = async (requesterId) => {
    if (!requesterId) throw new UnauthorizedException('User unauthenticated');
    const me = await findPartnerById(requesterId).catch(() => null);
    if (!me) throw new UnauthorizedException('User unauthenticated');
    return me;
  };

  const adminOrUpline = async (me, requesterId, ownerId) => {
    if (isAdminDoc(me)) return 'admin';
    if (sameId(requesterId, ownerId)) return 'owner';
    if (await isUplineOf(findPartnerById, requesterId, ownerId)) return 'upline';
    return null;
  };

  return {
    /** Read one prospect (404 for outsiders — never confirm existence). */
    async requireRead(requesterId, prospectId) {
      const me = await requester(requesterId);
      const { doc, ownerId } = await loadOwner(prospectId);
      const rel = await adminOrUpline(me, requesterId, ownerId);
      if (!rel) throw new NotFoundException('Prospect not found');
      return { prospect: doc, ownerId, relation: rel };
    },

    /** Read a partner's list (by-partner/notifications/stuck). Same rule. */
    async requireListAccess(requesterId, ownerId) {
      const me = await requester(requesterId);
      if (!ownerId) throw new NotFoundException('Partner not found');
      const rel = await adminOrUpline(me, requesterId, String(ownerId));
      if (!rel) throw new NotFoundException('Prospect not found');
      return { ownerId: String(ownerId), relation: rel };
    },

    /** Stage moves, notes, touches — owner, upline or admin. */
    async requireSupport(requesterId, prospectId) {
      const me = await requester(requesterId);
      const { doc, ownerId } = await loadOwner(prospectId);
      const rel = await adminOrUpline(me, requesterId, ownerId);
      if (!rel) throw new ForbiddenException('You can only work your own or your downline prospects');
      return { prospect: doc, ownerId, relation: rel };
    },

    /** PII edits, history deletes, deletes, converts — owner or admin. */
    async requireOwner(requesterId, prospectId, action = 'perform this action') {
      const me = await requester(requesterId);
      const { doc, ownerId } = await loadOwner(prospectId);
      if (isAdminDoc(me)) return { prospect: doc, ownerId, relation: 'admin' };
      if (sameId(requesterId, ownerId)) return { prospect: doc, ownerId, relation: 'owner' };
      throw new ForbiddenException(`Only the prospect owner can ${action}`);
    },

    /** Admin-only desks (e.g. full pool dump). */
    async requireAdmin(requesterId) {
      const me = await requester(requesterId);
      if (!isAdminDoc(me)) throw new ForbiddenException('Admin access required');
      return me;
    },
  };
};

/**
 * Partner-scoped guard for slices without a prospect (e.g. bookings, which
 * key off `username`). Same owner/upline/admin rule as requireListAccess.
 */
export const buildPartnerAccess = ({ findPartnerById }) => {
  if (!findPartnerById) throw new Error('buildPartnerAccess requires findPartnerById');

  const requester = async (requesterId) => {
    if (!requesterId) throw new UnauthorizedException('User unauthenticated');
    const me = await findPartnerById(requesterId).catch(() => null);
    if (!me) throw new UnauthorizedException('User unauthenticated');
    return me;
  };

  return {
    async requireListAccess(requesterId, ownerId) {
      const me = await requester(requesterId);
      if (!ownerId) throw new NotFoundException('Partner not found');
      if (isAdminDoc(me)) return { ownerId: String(ownerId), relation: 'admin' };
      if (String(requesterId) === String(ownerId)) return { ownerId: String(ownerId), relation: 'owner' };
      if (await isUplineOf(findPartnerById, requesterId, ownerId)) {
        return { ownerId: String(ownerId), relation: 'upline' };
      }
      throw new NotFoundException('Record not found');
    },

    async requireOwnerId(requesterId, ownerId, action = 'perform this action') {
      const me = await requester(requesterId);
      if (!ownerId) throw new NotFoundException('Partner not found');
      if (isAdminDoc(me)) return { ownerId: String(ownerId), relation: 'admin' };
      if (String(requesterId) === String(ownerId)) return { ownerId: String(ownerId), relation: 'owner' };
      throw new ForbiddenException(`Only the owner can ${action}`);
    },
  };
};
