import { MongoOutbox } from '../shared/outbox/Outbox.mongo.model.js';
import { sendEmail } from '../services/emailService.js';
import { buildSmsSender } from '../modules/notifications/infrastructure/SmsSender.js';
import { buildPushSender } from '../modules/notifications/infrastructure/PushSender.js';
import { env } from '../shared/config/env.js';
import { StoredNotificationModel } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';

const defaultSenders = () => ({
  email: (payload) => sendEmail(payload.to, payload.subject, payload.html),
  sms: (() => {
    const sender = buildSmsSender(env.sms);
    return (payload) => sender.send({ to: payload.to, title: payload.title ?? '', body: payload.body });
  })(),
  push: (() => {
    const sender = buildPushSender(env.push, env.appBaseUrl);
    return (payload) => sender.send({
      subscription: payload.subscription,
      title: payload.title,
      body: payload.body,
      link: payload.link,
    });
  })(),
});

/**
 * Drain the side-effect outbox. Atomic claim means multiple API replicas can
 * run this safely; each row is handled by one worker.
 */
export const runOutboxDueJob = async ({ outbox, senders, limit = 20 } = {}) => {
  const started = Date.now();
  const store = outbox ?? new MongoOutbox();
  const routes = senders ?? defaultSenders();
  const due = await store.claimDue({ limit });
  let delivered = 0;
  let failed = 0;

  for (const job of due) {
    const send = routes[job.channel];
    if (!send) {
      await store.retry(job._id, new Error(`No sender for ${job.channel}`));
      failed += 1;
      continue;
    }
    try {
      const receipt = await send(job.payload ?? {});
      if (receipt && receipt.sent === false) {
        throw new Error(receipt.error ?? `${job.channel} send failed`);
      }
      await store.complete(job._id);
      if (job.payload?.rowId && ['email', 'sms', 'push'].includes(job.channel)) {
        await StoredNotificationModel.updateOne(
          { _id: job.payload.rowId },
          { $set: { [`channels.${job.channel}`]: new Date() } },
        ).catch(() => null);
      }
      delivered += 1;
    } catch (error) {
      const outcome = await store.retry(job._id, error);
      if (outcome.failed) failed += 1;
    }
  }

  return {
    checked: due.length,
    delivered,
    failed,
    durationMs: Date.now() - started,
  };
};

export default runOutboxDueJob;
