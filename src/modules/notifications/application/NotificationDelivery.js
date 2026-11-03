import { resolvePreferences } from '../domain/StoredNotifications.js';
import { resolveChannels as channelsFor } from '../domain/Delivery.js';

/**
 * NotificationDeliveryService — the single choke point for sending.
 * Producers (event subscribers, jobs) describe *what*; this service
 * decides *where* from preferences and records per-channel receipts:
 * - in-app: keyed stored row (muted categories skip the write entirely)
 * - email: caller-supplied HTML via injected mail sender
 * - sms: title+body via injected SMS sender (needs recipient phone)
 * - push: title+body+link to every subscription (gone endpoints pruned)
 * Never throws for channel failures — the report carries them.
 */
export class NotificationDeliveryService {
  /**
   * @param {{stored, notify, mail, sms, push, resolvePrefs?}} deps
   * (`mail` is `(to, subject, html) => Promise`; defaults must be wired
   * by the caller — the service never imports legacy singletons.)
   */
  constructor({ stored, notify, mail, sms, push }) {
    Object.assign(this, { stored, notify, mail, sms, push });
  }

  /**
   * @param {{recipientId, contact, item, email, emailPolicy}} input
   * (`contact` = {email, phone}; `email` = {subject, html} or null.)
   */
  async deliver({ recipientId, contact = {}, item, email = null, emailPolicy = 'always' }) {
    const report = { inApp: 'skipped', email: false, sms: false, push: 0, pruned: 0, errors: [] };
    const prefs = resolvePreferences(await this.stored.getPreferences(recipientId).catch(() => null));
    const channels = channelsFor({ prefs, category: item.category, emailPolicy });

    let rowId = null;
    if (channels.inApp) {
      try {
        const row = await this.notify.execute({ recipientId, ...item });
        rowId = row?.id ?? null;
        report.inApp = row?.deduped === true ? 'deduped' : 'created';
      } catch (error) {
        report.errors.push({ channel: 'inApp', error: error?.message ?? String(error) });
      }
    } else {
      report.inApp = 'muted';
    }

    const stamp = {};
    if (channels.email && email && contact.email && this.mail) {
      try {
        const receipt = await this.mail(contact.email, email.subject, email.html);
        // sendEmail resolves {sent:false} instead of throwing — only an
        // explicit false marks the channel failed (fake senders resolve
        // undefined, which still counts as delivered).
        if (receipt && receipt.sent === false) {
          report.errors.push({ channel: 'email', error: receipt.error ?? 'Send failed' });
        } else {
          report.email = true;
          stamp['channels.email'] = new Date();
        }
      } catch (error) {
        report.errors.push({ channel: 'email', error: error?.message ?? String(error) });
      }
    }
    if (channels.sms && contact.phone && this.sms) {
      try {
        await this.sms.send({ to: contact.phone, title: item.title, body: item.body });
        report.sms = true;
        stamp['channels.sms'] = new Date();
      } catch (error) {
        report.errors.push({ channel: 'sms', error: error?.message ?? String(error) });
      }
    }
    if (channels.push && this.push) {
      try {
        const subs = await this.stored.listSubscriptions(recipientId).catch(() => []);
        for (const sub of subs) {
          try {
            const out = await this.push.send({
              subscription: { endpoint: sub.endpoint, keys: sub.keys },
              title: item.title,
              body: item.body,
              link: item.link,
            });
            if (out?.gone) {
              await this.stored.pruneSubscription(recipientId, sub.endpoint).catch(() => null);
              report.pruned += 1;
            } else {
              report.push += 1;
            }
          } catch (error) {
            report.errors.push({ channel: 'push', error: error?.message ?? String(error) });
          }
        }
        if (report.push > 0) stamp['channels.push'] = new Date();
      } catch (error) {
        report.errors.push({ channel: 'push', error: error?.message ?? String(error) });
      }
    }
    if (rowId && Object.keys(stamp).length > 0) {
      await this.stored.stampChannels(rowId, stamp).catch(() => null);
    }
    return report;
  }
}
