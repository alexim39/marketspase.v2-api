import { ValidationException } from '../../../shared/domain/AppError.js';

const DEFAULT_SUBJECT = 'A quick update from MarketSpase';
const MAX_SUBJECT = 120;
const MAX_BODY = 2000;
const MAX_SMS = 459;

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const parseJson = (text) => {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
    }
    return null;
  }
};

/**
 * Admin-only copywriter. It deliberately does not create partner Ora
 * conversations or consume partner usage limits; the result is a draft the
 * admin reviews before queueing a broadcast.
 */
export class DraftBroadcastUseCase {
  constructor({ client } = {}) {
    this.client = client;
  }

  async execute({
    purpose = 'announcement',
    tone = 'friendly',
    kind = 'marketing',
    audience = {},
    channels = {},
    current = {},
  } = {}) {
    if (!this.client) throw new ValidationException('Ora is not configured for admin drafting');
    const source = audience.source === 'customers' ? 'store customers' : 'platform users';
    const state = audience.accountState === 'member'
      ? 'registered members who have not activated'
      : audience.accountState === 'partner'
        ? 'activated partners'
        : 'members and activated partners';
    const channelList = [
      channels.inApp ? 'in-app inbox' : null,
      channels.email ? 'email' : null,
      channels.sms ? 'SMS' : null,
    ].filter(Boolean).join(', ') || 'email';
    const prompt = [
      `Write a ${purpose} for ${state} (${source}).`,
      `Tone: ${tone}. Campaign type: ${kind}. Channels: ${channelList}.`,
      current.title ? `Working title: ${clean(current.title, MAX_SUBJECT)}` : '',
      current.body ? `Current draft: ${clean(current.body, MAX_BODY)}` : '',
      'Return strict JSON only with keys subject, body and sms.',
      'subject <= 120 characters; body <= 1500 characters; sms <= 300 characters.',
      'Do not mention internal systems, policies, or that you are an AI.',
    ].filter(Boolean).join('\n');

    const reply = await this.client.complete({
      system: 'You are Ora, the MarketSpase admin copywriter. Write concise, honest, action-oriented platform communication. Return valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseJson(reply);
    const body = clean(parsed?.body ?? reply, MAX_BODY);
    if (body.length < 3) throw new ValidationException('Ora returned an empty draft');
    const subject = clean(parsed?.subject ?? current.title ?? DEFAULT_SUBJECT, MAX_SUBJECT);
    const smsBody = clean(parsed?.sms ?? parsed?.smsBody ?? body, MAX_SMS);
    return {
      subject: subject.length >= 3 ? subject : DEFAULT_SUBJECT,
      body,
      smsBody,
      provider: 'ora',
    };
  }
}
