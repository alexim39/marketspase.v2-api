import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { PartnersModel } from '../infrastructure/Billing.models.js';
import { sendEmail } from '../../../services/emailService.js';

const money = (amountNgn) => `₦${Number(amountNgn ?? 0).toLocaleString()}`;

/**
 * One withdrawal notification surface for every outcome.
 * `pending + manual` is the admin-review wording; `pending + automatic`
 * means the Paystack transfer is already in flight. Best-effort: money
 * state has already been written when this is called.
 */
export const notifyPayoutOutcome = async ({
  partnerId,
  amountNgn,
  reference,
  outcome = 'pending',
  payoutMode = 'manual',
  reason = null,
  bank = null,
  accountName = null,
}) => {
  const amount = money(amountNgn);
  const destination = [bank, accountName].filter(Boolean).join(' · ');
  const title = outcome === 'paid'
    ? 'Withdrawal paid'
    : outcome === 'refunded'
      ? 'Withdrawal refunded'
      : outcome === 'reversed'
        ? 'Withdrawal reversed'
        : payoutMode === 'automatic'
          ? 'Withdrawal on the way'
          : 'Withdrawal requested';
  const body = outcome === 'paid'
    ? `${amount} was sent to ${destination || 'your bank account'} (ref ${reference}).`
    : outcome === 'refunded'
      ? `${amount} could not be paid and was refunded to your wallet.${reason ? ` ${reason}` : ''}`
      : outcome === 'reversed'
        ? `Your bank reversed the ${amount} payout (ref ${reference}). Please contact support so we can review it.`
        : payoutMode === 'automatic'
          ? `${amount} is on its way to ${destination || 'your bank account'}. You will be notified when it settles.`
          : `${amount} to ${destination || 'your bank account'} is pending review.`;

  try {
    await new NotifyUseCase({ stored: new MongoStoredNotificationStore() }).execute({
      recipientId: String(partnerId),
      category: 'system',
      priority: 'high',
      title,
      body,
      icon: 'payments',
      link: '/dashboard/wallet/history',
      key: `withdrawal:${reference}:${outcome}`,
    });
  } catch { /* notification is best-effort */ }

  try {
    const member = await PartnersModel.findById(partnerId).select('email').lean();
    if (member?.email) await sendEmail(member.email, title, `<p>${body}</p>`);
  } catch { /* email is best-effort */ }
};
