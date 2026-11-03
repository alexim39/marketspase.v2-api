/**
 * Minute worker for scheduled outreach — claims due rows atomically
 * (scheduled → sending) so parallel dynos never double-fire, then runs
 * the shared cores: SMS charges + sends, email sends free. Charge happens
 * at fire time: cancelled rows never touch the wallet; broke-at-fire-time
 * rows fail with the reason instead of retrying forever. Never throws
 * into the scheduler — per-row outcomes carry the errors.
 */
export class RunOutreachDueUseCase {
  /** @param {{schedules, deliver, deliverEmail, smsEnabled, batch?}} deps */
  constructor({ schedules, deliver, deliverEmail, smsEnabled = true, batch = 25 } = {}) {
    Object.assign(this, { schedules, deliver, deliverEmail, smsEnabled, batch });
  }

  async execute({ now = new Date(), maxAgeMs = 24 * 3600000 } = {}) {
    const t = now instanceof Date ? now : new Date(now);
    const result = { checked: 0, sent: 0, failed: [], skipped: 0 };
    const lim = Math.min(Math.max(Number(this.batch) || 25, 1), 100);
    for (let i = 0; i < lim; i++) {
      const claimed = await this.schedules.findOneAndUpdate(
        { status: 'scheduled', sendAt: { $lte: t } },
        { $set: { status: 'sending' }, $inc: { attempts: 1 } },
        { new: true, sort: { sendAt: 1 } },
      ).lean();
      if (!claimed) break;
      result.checked += 1;
      if (t.getTime() - new Date(claimed.sendAt).getTime() > maxAgeMs) {
        await this.schedules.updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', result: { error: 'Send window expired (over 24h overdue)' } } },
        ).catch(() => null);
        result.failed.push({ id: String(claimed._id), error: 'expired' });
        continue;
      }
      if ((claimed.channel ?? 'sms') === 'email') {
        result.sent += await this.fireEmail(claimed, result);
        continue;
      }
      if (!this.smsEnabled) {
        await this.schedules.updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', result: { error: 'SMS sending is not configured' } } },
        ).catch(() => null);
        result.failed.push({ id: String(claimed._id), error: 'sms-not-configured' });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await this.deliver({
          partnerId: claimed.partnerId,
          to: claimed.to ?? [],
          body: claimed.smsBody ?? '',
          campaignId: claimed.campaignId ? String(claimed.campaignId) : null,
        });
        // eslint-disable-next-line no-await-in-loop
        await this.schedules.updateOne(
          { _id: claimed._id },
          { $set: { status: outcome.failed.length > 0 && outcome.sent === 0 ? 'failed' : 'sent', result: outcome } },
        ).catch(() => null);
        result.sent += 1;
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        await this.schedules.updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', result: { error: error?.message ?? String(error) } } },
        ).catch(() => null);
        result.failed.push({ id: String(claimed._id), error: error?.message ?? String(error) });
      }
    }
    return result;
  }

  async fireEmail(claimed, result) {
    try {
      const outcome = await this.deliverEmail({
        partnerId: claimed.partnerId,
        to: claimed.to ?? [],
        subject: claimed.emailSubject ?? '',
        body: claimed.smsBody ?? '',
      });
      await this.schedules.updateOne(
        { _id: claimed._id },
        { $set: { status: outcome.failed.length > 0 && outcome.sent === 0 ? 'failed' : 'sent', result: outcome } },
      ).catch(() => null);
      return 1;
    } catch (error) {
      await this.schedules.updateOne(
        { _id: claimed._id },
        { $set: { status: 'failed', result: { error: error?.message ?? String(error) } } },
      ).catch(() => null);
      result.failed.push({ id: String(claimed._id), error: error?.message ?? String(error) });
      return 0;
    }
  }
}
