import axios from 'axios';
import { normalizePhone, smsBody } from '../domain/Delivery.js';

/**
 * SMS sender port: `send({to, title, body, extra?})` (`extra` merges over
 * configured static fields — e.g. per-send customer references).
 * Production shape is provider-agnostic on purpose — point
 * SMS_HTTP_URL at any JSON-accepting gateway. Wired + verified for
 * BulkSMSNigeria api/v2 ({from, to, body} + Bearer header, see
 * .env.example); other gateways map via SMS_HTTP_TO_FIELD/MESSAGE_FIELD/EXTRA.
 * `disabled` (default) logs so staging never spends credit.
 */
export class SmsSender {
  async send() { throw new Error('Not implemented'); }
}

export class HttpSmsSender extends SmsSender {
  /** @param {{url, method, headers, toField, messageField, extra, senderId, timeoutMs, post?}} config */
  constructor(config = {}) {
    super();
    this.config = {
      method: 'POST', headers: {}, toField: 'to', messageField: 'message',
      extra: {}, senderId: 'DiamondProj', timeoutMs: 8000, ...config,
    };
    this.post = config.post ?? ((url, data, opts) => axios({ method: this.config.method, url, data, ...opts }));
  }

  async send({ to, title, body, extra = {} }) {
    const phone = normalizePhone(to);
    if (!phone) throw new Error('Invalid recipient phone');
    if (!this.config.url) throw new Error('SMS_HTTP_URL is not configured');
    const payload = {
      [this.config.toField]: phone,
      [this.config.messageField]: smsBody(title, body),
      from: this.config.senderId,
      ...this.config.extra,
      ...extra,
    };
    const res = await this.post(this.config.url, payload, {
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      timeout: this.config.timeoutMs,
    });
    // BulkSMSNigeria nests the id: {data:{message_id}} (prod) / {data:{id}} (sandbox).
    const respBody = res?.data ?? {};
    const nested = respBody?.data ?? {};
    return { providerId: nested.message_id ?? nested.id ?? respBody.message_id ?? respBody.id ?? null };
  }
}

export class LogSmsSender extends SmsSender {
  async send({ to, title }) {
    console.log(`[sms:disabled] to=${normalizePhone(to) ?? to} title=${String(title ?? '').slice(0, 80)}`);
    return { logged: true };
  }
}

/** Factory — HTTP sender only when enabled, logging sender otherwise. */
export const buildSmsSender = (smsEnv = {}) => (
  smsEnv.enabled ? new HttpSmsSender(smsEnv) : new LogSmsSender()
);
