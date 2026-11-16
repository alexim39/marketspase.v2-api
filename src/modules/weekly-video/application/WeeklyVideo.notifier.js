import { notifyCap } from '../domain/WeeklyVideo.domain.js';
import { resolvePreferences } from '../../notifications/domain/StoredNotifications.js';

/**
 * In-app fan-out for weekly videos.
 *
 * Publish: one keyed notification per recipient (`weekly-video:<videoId>`),
 * so a retry after a partial failure fills gaps without double-notifying.
 *
 * Follow-up: stage 1 lands 24h after publish and stage 2 at 72h, both only to
 * partners who have not reached the verified completion threshold. Keys are
 * per stage, so a re-run never repeats a reminder. Training notifications
 * muted in preferences are skipped (in-app only — no email/SMS campaign).
 */
export class WeeklyVideoNotifier {
  constructor({ repo, notify, prefs = null, prefsFor = null, cap = notifyCap() }) {
    this.repo = repo;
    this.notifyUseCase = notify;
    this.prefs = prefs;
    this.prefsFor = prefsFor;
    this.cap = cap;
  }

  /**
   * One bulk preference read per fan-out page. Tests may pass a per-id
   * `prefs` resolver instead; production wires `prefsFor`.
   */
  async loadPreferences(recipientIds) {
    if (this.prefsFor) {
      return this.prefsFor(recipientIds).catch(() => null);
    }
    if (!this.prefs) return null;
    const map = {};
    for (const recipientId of recipientIds) {
      map[String(recipientId)] = await this.prefs(recipientId).catch(() => null);
    }
    return map;
  }

  async deliverTo(recipientIds, build) {
    let delivered = 0;
    let failed = 0;
    let muted = 0;
    const preferences = await this.loadPreferences(recipientIds);
    for (const recipientId of recipientIds) {
      const prefs = resolvePreferences(preferences?.[String(recipientId)] ?? null);
      if (prefs.channels?.training?.inApp === false) {
        muted += 1;
        continue;
      }
      try {
        await this.notifyUseCase.execute(build(recipientId));
        delivered += 1;
      } catch {
        failed += 1;
      }
    }
    return { delivered, failed, muted };
  }

  async notify(video) {
    if (!video?.id) return { delivered: 0, failed: 0, muted: 0, capped: false, total: 0 };
    const { ids, capped } = await this.repo.notificationRecipients(this.cap);
    const shortTitle = String(video.title ?? 'Video of the Week').slice(0, 90);
    const title = `New Video of the Week: ${shortTitle}`.slice(0, 120);
    const body = `Watch “${shortTitle}” and share what you learned.`;
    const report = await this.deliverTo(ids, (recipientId) => ({
      recipientId,
      category: 'training',
      priority: 'high',
      title,
      body,
      icon: 'smart_display',
      link: '/dashboard/learn/video-of-the-week',
      key: `weekly-video:${video.id}`,
    }));
    return { ...report, capped, total: ids.length };
  }

  /**
   * Follow-up for the current video. `stage` 1 = 24h, 2 = final 72h nudge.
   * Completed watchers are excluded before fan-out.
   */
  async remind({ video, stage = 1 } = {}) {
    if (!video?.id) {
      return { delivered: 0, failed: 0, muted: 0, skippedCompleted: 0, capped: false, total: 0 };
    }
    const stageNumber = stage === 2 ? 2 : 1;
    const { ids, capped } = await this.repo.notificationRecipients(this.cap);
    const completed = new Set(
      (typeof this.repo.completedPartnerIds === 'function'
        ? await this.repo.completedPartnerIds(video.id).catch(() => [])
        : []).map((id) => String(id)),
    );
    const recipients = ids.filter((id) => !completed.has(String(id)));
    const shortTitle = String(video.title ?? 'Video of the Week').slice(0, 90);
    const title = stageNumber === 1
      ? 'Your weekly briefing is waiting'
      : 'Last call for this week’s briefing';
    const body = stageNumber === 1
      ? `Watch “${shortTitle}” and share one lesson to keep this week’s commitment on track.`
      : `You haven’t finished “${shortTitle}”. Watch it before the next briefing lands.`;
    const report = await this.deliverTo(recipients, (recipientId) => ({
      recipientId,
      category: 'training',
      priority: stageNumber === 1 ? 'medium' : 'high',
      title,
      body,
      icon: 'smart_display',
      link: `/dashboard/learn/video-of-the-week/${encodeURIComponent(String(video.id))}`,
      key: `weekly-video:watch-${stageNumber}:${video.id}`,
    }));
    return {
      ...report,
      skippedCompleted: ids.length - recipients.length,
      capped,
      total: recipients.length,
    };
  }
}
