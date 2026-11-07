/**
 * Admin audit vocabulary — who did what to whom, when.
 * New admin actions add a `domain.verb` key here AND record it at the
 * decision site (best-effort, never fails the request). The viewer and
 * tests pin this list so renames stay deliberate.
 */
export const AUDIT_ACTIONS = Object.freeze([
  'role.set',
  'account.suspend',
  'account.unsuspend',
  'account.signout',
  'account.reset-password',
  'account.erase',
  'account.reassign-upline',
  'account.view-as',
'payout.release',
'payout.void',
'withdrawal.decide',
'reservation.decide',
'reservation.delete',
'wallet.credit',
'wallet.deposit.init',
'wallet.deposit.credit',
'wallet.withdraw.request',
'wallet.withdraw.paid',
'wallet.withdraw.refund',
'wallet.admin.credit',
'commission.release',
'commission.void',
'commission.rank.set',
'mentor-bonus.run',
  'campaign.decide',
  'campaign.allocate',
  'campaign.allocation.pause',
  'campaign.allocation.verdict',
  'campaign.allocation.override',
  'campaign.allocation.reverse',
  'campaign.duplicate',
  'order.decide',
  'training.quiz.save',
  'training.media.save',
  'training.media.revert',
  'ticket.decide',
  'moderation.remove',
  'moderation.dismiss',
  'content.restore',
  'broadcast.send',
  'broadcast.campaign.queue',  'broadcast.campaign.cancel',
  'broadcast.campaign.retry',
  'broadcast.delete',
  'lead.import', 'lead.delete', 'lead.status',
  'pagelead.delete', 'pagelead.reassign',
  'partnersurvey.delete',
  'chat.group.create', 'chat.group.delete', 'chat.group.ban',
  'page.reset',
  'subscription.delete', 'subscription.status',
  'billing.plan.update',
  'product.create',
  'product.update',
  'store.update',
  'store.order.update',
  'store.product.update',
  'store.receipt.confirm',
  'admin.store.status',
  'admin.store-order.escrow.release',
  'admin.store-order.refund',
  'admin.store.settings.update',
  'bonus.claim',
  'bonus.campaign.create',
  'bonus.campaign.update',
  'bonus.campaign.delete',
  'tutorial.create',
  'tutorial.update',
  'tutorial.delete',
  'ora.action.execute',
  'ora.action.skip',
]);

const str = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v);
  return s.slice(0, max);
};

/** Pure entry factory — throws on unknown action so typos fail loudly in dev/tests. */
export const createAuditEntry = ({ actorId, actorLabel = null, action, targetType = null, targetId = null, detail = null }) => {
  if (!AUDIT_ACTIONS.includes(action)) throw new Error(`Unknown audit action: ${action}`);
  const entry = {
    actorId: str(actorId, 64),
    action,
    ...(actorLabel ? { actorLabel: str(actorLabel, 120) } : {}),
    ...(targetType ? { targetType: str(targetType, 64) } : {}),
    ...(targetId ? { targetId: str(targetId, 64) } : {}),
    ...(detail && typeof detail === 'object' ? { detail: JSON.parse(JSON.stringify(detail).slice(0, 4000)) } : {}),
  };
  if (!entry.actorId) throw new Error('Audit entry requires actorId');
  return entry;
};
