import { createRequire } from 'node:module';
import { pushPayload } from '../domain/Delivery.js';

/**
 * Web-push sender port: `send({subscription, title, body, link})`.
 * `web-push` is lazy-required so the slice boots without it; without
 * VAPID keys in env the factory returns the logging sender and push
 * stays dormant until production credentials land.
 */

const loadWebPush = () => {
  try {
    return createRequire(import.meta.url)('web-push');
  } catch {
    return null;
  }
};

export class PushSender {
  async send() { throw new Error('Not implemented'); }
}

export class WebPushSender extends PushSender {
  /** @param {{publicKey, privateKey, subject, appBaseUrl, webpush?}} config */
  constructor(config = {}) {
    super();
    this.config = config;
    this.lib = config.webpush ?? loadWebPush();
    if (this.lib?.setVapidDetails && config.publicKey && config.privateKey) {
      this.lib.setVapidDetails(config.subject ?? 'mailto:noreply@c21fg.online', config.publicKey, config.privateKey);
    }
  }

  get ready() {
    return Boolean(this.lib?.sendNotification && this.config.publicKey && this.config.privateKey);
  }

  async send({ subscription, title, body, link }) {
    if (!this.ready) throw new Error('Push not configured (VAPID keys or web-push missing)');
    const payload = JSON.stringify(pushPayload({ title, body, link }, this.config.appBaseUrl ?? ''));
    try {
      await this.lib.sendNotification(subscription, payload);
      return { delivered: true };
    } catch (error) {
      // 404/410 = subscription gone — the caller prunes it, not an error.
      if (error?.statusCode === 404 || error?.statusCode === 410) return { gone: true };
      throw error;
    }
  }
}

export class LogPushSender extends PushSender {
  async send({ subscription, title }) {
    console.log(`[push:disabled] endpoint=${String(subscription?.endpoint ?? '').slice(0, 60)} title=${String(title ?? '').slice(0, 80)}`);
    return { logged: true };
  }
}

/** Factory — real sender only when VAPID keys exist, logging sender otherwise. */
export const buildPushSender = (pushEnv = {}, appBaseUrl = '') => (
  pushEnv.enabled ? new WebPushSender({ ...pushEnv, appBaseUrl }) : new LogPushSender()
);
