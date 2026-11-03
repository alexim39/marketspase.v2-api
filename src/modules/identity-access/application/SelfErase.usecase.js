import { ConflictException, NotFoundException } from '../../../shared/domain/AppError.js';
import { lenientRole } from '../domain/PartnerRole.js';

/** Self-service erasure cooldown — request → 30 days → sweep-job execution. */
export const ERASE_COOLDOWN_DAYS = 30;
const DAY = 86400000;

/**
 * POST /v1/auth/me/erasure — schedule your own account deletion.
 *
 * Same guards as admin erase (last-admin, downline), checked again at
 * execution — a member can gain downline mid-cooldown. Payouts are NOT a
 * blocker by policy: remaining balance is forfeited to the ledger at
 * execution. Re-request while pending returns the existing date (409).
 */
export class RequestSelfErasureUseCase {
  /** @param {{partners}} deps (findById, updateById, countDownline?, countByRole) */
  constructor({ partners }) {
    this.partners = partners;
  }

  async execute({ partnerId }) {
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');
    if (target.eraseScheduledFor) {
      throw new ConflictException(
        `Erasure already scheduled for ${new Date(target.eraseScheduledFor).toISOString().slice(0, 10)}`,
      );
    }
    if (lenientRole(target.role) === 'admin') {
      const remaining = await this.partners.countByRole('admin');
      if (remaining <= 1) {
        throw new ConflictException('Cannot erase the last admin');
      }
    }
    const downline = this.partners.countDownline
      ? await this.partners.countDownline(partnerId)
      : 0;
    // Mid-tree members may request freely — the sweep moves their direct
    // recruits up at execution. Only a root with downline is refused, since
    // there is nowhere above to move them.
    if (downline > 0 && !target.partnerOf) {
      throw new ConflictException(`Reassign ${downline} downline member(s) before erasing this account`);
    }
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + ERASE_COOLDOWN_DAYS * DAY);
    await this.partners.updateById(partnerId, {
      eraseRequestedAt: now,
      eraseScheduledFor: scheduledFor,
      eraseReminderAt: null,
    });
    return {
      requestedAt: now.toISOString(),
      scheduledFor: scheduledFor.toISOString(),
      email: target.email ?? null,
      name: [target.name, target.surname].filter(Boolean).join(' ') || target.username || 'Partner',
    };
  }
}

/**
 * DELETE /v1/auth/me/erasure — cancel a pending self-erasure.
 * Idempotent: cancelling nothing still succeeds (cancelled: false).
 */
export class CancelSelfErasureUseCase {
  /** @param {{partners}} deps */
  constructor({ partners }) {
    this.partners = partners;
  }

  async execute({ partnerId }) {
    const target = await this.partners.findById(partnerId);
    if (!target) throw new NotFoundException('Partner not found');
    if (!target.eraseScheduledFor) return { cancelled: false };
    await this.partners.updateById(partnerId, {
      eraseRequestedAt: null,
      eraseScheduledFor: null,
      eraseReminderAt: null,
    });
    return { cancelled: true };
  }
}
