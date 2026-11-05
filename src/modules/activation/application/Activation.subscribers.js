import { ACTIVATION_EVENTS } from '../domain/ActivationEvents.js';
import { buildWelcome } from '../../notifications/infrastructure/LifecycleMailer.js';

/**
 * Activation fan-out — closes the onboarding loop after open signup.
 * The only leg is the new-member welcome: in-app + email with their first
 * steps. Best-effort with per-recipient isolation; a failure never affects
 * the signup, which is already committed.
 */
export const welcomeKey = (partnerId) => `welcome:${partnerId}`;

const displayNameOf = (doc, fallback = 'there') => {
  if (!doc) return fallback;
  return [doc.name, doc.surname].filter(Boolean).join(' ') || doc.username || fallback;
};

export const buildActivationHandlers = ({ stored, notify, delivery = null, partners = null }) => ({
  async welcomeMember({ partnerId, memberName }) {
    const key = welcomeKey(partnerId);
    try {
      if (await stored.findByKey(partnerId, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const member = await partners?.findById(partnerId).catch(() => null);
      const item = {
        category: 'system',
        priority: 'high',
        title: `Welcome to MarketSpase, ${memberName}!`,
        body: 'Complete your profile, take the IPO course, add your first prospect and set your first goal — your Daily Action Center guides you daily.',
        icon: 'celebration',
        link: '/dashboard',
        key,
      };
      if (!delivery) {
        await notify.execute({ recipientId: partnerId, ...item });
        return { status: 'welcomed', emailed: false };
      }
      const report = await delivery.deliver({
        recipientId: partnerId,
        contact: { email: member?.email ?? null, phone: member?.phone ?? null },
        item,
        email: buildWelcome({ memberName }),
        emailPolicy: 'force',
      });
      const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
      return reached
        ? { status: 'welcomed', emailed: report.email === true }
        : { status: 'skipped', reason: 'no-channel' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  },
});

/**
 * @param {{events, stored, notify, delivery?, partners?}} deps
 * @returns unsubscribe function
 */
export const subscribeActivation = ({ events, stored, notify, delivery = null, partners = null }) => {
  const handlers = buildActivationHandlers({ stored, notify, delivery, partners });
  return events.on(ACTIVATION_EVENTS.MEMBER_SIGNED_UP, async (payload) => {
    const welcome = await handlers.welcomeMember(payload);
    return { welcome };
  });
};
