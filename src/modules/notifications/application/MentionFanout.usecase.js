import { resolvePreferences } from '../domain/StoredNotifications.js';

const excerptOf = (text, max = 140) => {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * @mention fan-out: subscriber of `community.mention.created`.
 * Best-effort by design — a mention must never fail the post/comment
 * that carries it (same convention as promotion recognition).
 *
 * Rules: unknown handles and self-mentions are skipped; delivery runs
 * through NotificationDeliveryService (keyed `mention:<type>:<id>:<handle>`
 * in-app rows, reruns no-op via `findByKey`); email goes out only when
 * the recipient opted into community email AND their digest is
 * `immediate` (daily/weekly/off keep the in-app item for the digest
 * sender, N5). SMS/push follow the same preference matrix.
 */
export class FanoutMentionsUseCase {
  /** @param {{community, stored, delivery, mailer}} deps */
  constructor({ community, stored, delivery, mailer }) {
    Object.assign(this, { community, stored, delivery, mailer });
  }

  /**
   * @param {{authorId, sourceType, sourceId, handles, text}} input
   * (`handles` are the stored mentions — one parser, `extractMentions`.)
   * @returns {{notified, emailed, sms, push, skipped, failed}}
   */
  async execute({ authorId, sourceType, sourceId, handles = [], text = '' }) {
    const result = { notified: 0, emailed: 0, sms: 0, push: 0, skipped: 0, failed: [] };
    try {
      const clean = [...new Set((handles ?? []).map((h) => String(h ?? '').toLowerCase()))].filter(Boolean);
      if (clean.length === 0) return result;
      const [authorHandle, labels, recipients] = await Promise.all([
        this.community.findUsername(authorId).catch(() => null),
        this.community.authorLabels([authorId]).catch(() => ({})),
        this.community.findPartnersByUsernames(clean).catch(() => []),
      ]);
      const authorName = labels[String(authorId)]?.name ?? 'Someone';
      const excerpt = excerptOf(text);
      for (const r of recipients) {
        if (String(r.partnerId) === String(authorId) || r.username === authorHandle) {
          result.skipped += 1;
          continue;
        }
        try {
          const key = `mention:${sourceType}:${sourceId}:${r.username}`;
          if (await this.stored.findByKey(r.partnerId, key).catch(() => null)) {
            result.skipped += 1;
            continue;
          }
          const report = await this.delivery.deliver({
            recipientId: r.partnerId,
            contact: { email: r.email ?? null, phone: r.phone ?? null },
            item: {
              category: 'community',
              priority: 'medium',
              title: `${authorName} mentioned you`,
              body: excerpt || 'You were mentioned in Community.',
              icon: 'alternate_email',
              link: '/dashboard/community',
              key,
            },
            email: this.mailer.buildMention({ authorName, excerpt, sourceType }),
            emailPolicy: 'immediate-only',
          });
          if (report.inApp === 'created' || report.inApp === 'deduped') result.notified += 1;
          else result.skipped += 1;
          if (report.email) result.emailed += 1;
          if (report.sms) result.sms += 1;
          result.push += report.push;
          for (const e of report.errors) result.failed.push({ partner: String(r.partnerId), ...e });
        } catch (error) {
          result.failed.push({ partner: String(r.partnerId), error: error?.message ?? String(error) });
        }
      }
    } catch (error) {
      result.failed.push({ error: error?.message ?? String(error) });
    }
    return result;
  }
}
