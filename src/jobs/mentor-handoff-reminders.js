import { MongoMentorHandoffRepository } from '../modules/mentor-handoff/infrastructure/MentorHandoff.mongo.repository.js';
import { MentorHandoffReminderUseCase } from '../modules/mentor-handoff/application/MentorHandoff.reminders.js';
import { PartnersModel } from '../modules/identity-access/infrastructure/Auth.models.js';
import { NotificationDeliveryService } from '../modules/notifications/application/NotificationDelivery.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { buildSmsSender } from '../modules/notifications/infrastructure/SmsSender.js';
import { sendEmail } from '../services/emailService.js';
import { env } from '../shared/config/env.js';

const buildUseCase = () => {
  const stored = new MongoStoredNotificationStore();
  const delivery = new NotificationDeliveryService({
    stored,
    notify: new NotifyUseCase({ stored }),
    mail: sendEmail,
    sms: buildSmsSender(env.sms),
  });
  return new MentorHandoffReminderUseCase({
    handoffs: new MongoMentorHandoffRepository(),
    delivery,
    partners: PartnersModel,
  });
};

export async function runMentorHandoffRemindersJob({ usecase = null, now = new Date() } = {}) {
  const started = Date.now();
  try {
    const result = await (usecase ?? buildUseCase()).run(now);
    console.log(`[jobs] mentor-handoff-reminders: ${result.reminders}/${result.checked} reminders, ${result.escalated} escalated, ${result.failed} failed in ${Date.now() - started}ms`);
    return result;
  } catch (error) {
    console.error('[jobs] mentor-handoff-reminders crashed:', error?.message ?? error);
    return { checked: 0, reminders: 0, escalated: 0, skipped: 0, failed: 1 };
  }
}
