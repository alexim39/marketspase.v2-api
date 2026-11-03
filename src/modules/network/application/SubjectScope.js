import { ForbiddenException, UnauthorizedException, ValidationException } from '../../../shared/domain/AppError.js';
import { lenientRole, adminBootstrapEmails } from '../../identity-access/domain/PartnerRole.js';
import { collectDownlineIds } from '../infrastructure/Network.mongo.repository.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * Shared subject scope for per-member reads (team analytics, goals).
 * No subject (or self) → own data. Otherwise the requester must be an
 * admin or an upline of the subject (bounded downline walk); outsiders
 * get 403. Keeps coaching reads open without leaking across legs.
 */
export const resolveSubject = async ({ requesterId, subjectId, network, partners }) => {
  if (!requesterId) {
    throw new UnauthorizedException('User unauthenticated');
  }
  const subject = subjectId ? String(subjectId).trim() : String(requesterId);
  if (!OBJECT_ID_RE.test(subject)) throw new ValidationException('Invalid member id');
  if (subject === String(requesterId)) return subject;
  const net = network ?? { findNode: async () => null };
  const store = partners ?? { findById: async () => null };
  const me = await store.findById(requesterId).catch(() => null);
  const role = lenientRole(me?.role);
  if (role === 'admin' || adminBootstrapEmails().includes(String(me?.email ?? '').toLowerCase())) {
    return subject;
  }
  const { ids } = await collectDownlineIds(net, requesterId).catch(() => ({ ids: [] }));
  if (!(ids ?? []).map(String).includes(subject)) {
    throw new ForbiddenException('You can only view your own or your downline analytics');
  }
  return subject;
};
