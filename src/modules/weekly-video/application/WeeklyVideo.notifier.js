import { notifyCap } from '../domain/WeeklyVideo.domain.js';

/**
 * In-app fan-out for a published weekly video.
 *
 * One keyed notification per recipient (`weekly-video:<videoId>`) means a
 * retry after a partial failure fills the gaps without double-notifying.
 * This is deliberately in-app only; the weekly video is a required learning
 * prompt, not an email/SMS campaign.
 */
export class WeeklyVideoNotifier {
  constructor({ repo, notify, cap = notifyCap() }) {
    this.repo = repo;
    this.notifyUseCase = notify;
    this.cap = cap;
  }

  async notify(video) {
    if (!video?.id) return { delivered: 0, failed: 0, capped: false, total: 0 };
    const { ids, capped } = await this.repo.notificationRecipients(this.cap);
    const shortTitle = String(video.title ?? 'Video of the Week').slice(0, 90);
    const title = `New Video of the Week: ${shortTitle}`.slice(0, 120);
    const body = `Watch “${shortTitle}” and share what you learned.`;
    let delivered = 0;
    let failed = 0;

    for (const recipientId of ids) {
      try {
        await this.notifyUseCase.execute({
          recipientId,
          category: 'training',
          priority: 'high',
          title,
          body,
          icon: 'smart_display',
          link: '/dashboard/learn/video-of-the-week',
          key: `weekly-video:${video.id}`,
        });
        delivered += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      delivered,
      failed,
      capped,
      total: ids.length,
    };
  }
}
