import { ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';
import { adminBootstrapEmails, lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { collectDownlineIds } from '../infrastructure/Network.mongo.repository.js';

/**
 * View-as entry decision: admin or downline ancestor may open a
 * read-only member view. Pure decision + audited entry — the view
 * itself only calls existing subject-scoped reads, so no access
 * rule is widened. Unit-testable with fakes.
 */
export class ResolveViewAsUseCase {
  /** @param {{partners, network, audits?}} deps */
  constructor({ partners, network, audits = null }) {
    Object.assign(this, { partners, network, audits });
  }

  async execute({ requesterId, targetId }) {
    const target = String(targetId ?? '').trim();
    const requester = String(requesterId ?? '').trim();
    if (!target || !requester) throw new ForbiddenException('Member not found');
    if (target === requester) throw new ForbiddenException('You are already viewing your own account');
    const doc = await this.partners?.findById?.(target).catch(() => null);
    if (!doc) throw new NotFoundException('Member not found');
    let relation = null;
    const me = await this.partners?.findById?.(requester).catch(() => null);
    if (me && (lenientRole(me.role) === 'admin'
      || adminBootstrapEmails().includes(String(me.email ?? '').toLowerCase()))) {
      relation = 'admin';
    } else {
      const { ids } = await collectDownlineIds(this.network, requester).catch(() => ({ ids: [] }));
      if ((ids ?? []).map(String).includes(target)) relation = 'upline';
    }
    if (!relation) throw new ForbiddenException('You can only view members in your downline');
    if (this.audits?.record) {
      await this.audits.record({
        actorId: requester, action: 'account.view-as',
        targetType: 'member', targetId: target,
        detail: { relation },
      }).catch(() => null);
    }
    return {
      member: {
        id: target,
        username: doc.username ?? null,
        name: [doc.name, doc.surname].filter(Boolean).join(' ') || doc.username || 'Member',
      },
      relation,
    };
  }
}
