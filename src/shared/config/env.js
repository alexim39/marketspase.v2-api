/**
 * Central env access for NEW code.
 * Never throws for missing optional values so legacy boot
 * (`server.js` reading process.env directly) keeps working.
 * Add Zod strict validation here once all required vars are confirmed.
 */
export const env = {
  get port() {
    return Number(process.env.PORT || 8080);
  },
  get jwtSecret() {
    return process.env.JWTTOKENSECRET || '';
  },
  /** Comma-separated owner inboxes for support notifications. */
  get supportOwnerEmails() {
    const raw = process.env.SUPPORT_OWNER_EMAILS || 'ago.fnc@gmail.com';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get mongodb() {
    return {
      username: process.env.MONGODB_USERNAME || '',
      password: process.env.MONGODB_PASSWORD || '',
      database: process.env.MONGODB_DATABASE || '',
    };
  },
  /**
   * Growth campaign activation. Partner-created campaigns go live as soon as
   * funding clears unless CAMPAIGN_AUTO_ACTIVATE is explicitly disabled.
   */
  get campaigns() {
    return {
      autoActivate: !['false', '0', 'no'].includes(
        String(process.env.CAMPAIGN_AUTO_ACTIVATE ?? 'true').toLowerCase(),
      ),
    };
  },
  /**
   * Ora AI assistant (DeepSeek, OpenAI-compatible). The key lives ONLY in
   * env — never in code, logs or the frontend. Empty key = chat endpoints
   * answer 503 with a clear message instead of failing obscurely.
   */
  get ora() {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 800),
      timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 30000),
      dailyLimit: Number(process.env.ORA_DAILY_LIMIT || 25),
    };
  },
  /**
   * Web-push (VAPID). Empty until production keys land in env —
   * the sender factory falls back to a logging sender meanwhile.
   * Generate once: npx web-push generate-vapid-keys
   */
  get push() {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY || '',
      privateKey: process.env.VAPID_PRIVATE_KEY || '',
      subject: process.env.VAPID_SUBJECT || 'mailto:noreply@c21fg.online',
      enabled: Boolean(process.env.VAPID_PUBLIC_KEY) && Boolean(process.env.VAPID_PRIVATE_KEY),
    };
  },
  /** Absolute base URL for push-click targets (fallback: relative path). */
  get appBaseUrl() {
    return (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  },
  /**
   * Cloudinary (profile photos). Server-side ONLY — the secret never
   * leaves this process. Accepts the standard CLOUDINARY_URL
   * (`cloudinary://key:secret@cloud`) or individual vars. Empty =
   * the upload endpoint answers 503 instead of failing obscurely.
   */
  get cloudinary() {
    const fromUrl = /cloudinary:\/\/([^:]+):([^@]+)@(.+)/.exec(process.env.CLOUDINARY_URL || '');
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || (fromUrl ? fromUrl[3] : '');
    const apiKey = process.env.CLOUDINARY_API_KEY || (fromUrl ? fromUrl[1] : '');
    const apiSecret = process.env.CLOUDINARY_API_SECRET || (fromUrl ? fromUrl[2] : '');
    return {
      cloudName,
      apiKey,
      apiSecret,
      folder: process.env.CLOUDINARY_FOLDER || 'diamond-projects',
      enabled: Boolean(cloudName && apiKey && apiSecret),
    };
  },
  /**
   * Outbound mail (SMTP). All platform email flows through
   * `src/services/emailService.js`, which reads these vars directly.
   * Missing host/user = sends resolve `{ sent: false }`, never throw.
   */
  get mail() {
    const secureRaw = String(process.env.EMAIL_SECURE ?? 'true').trim().toLowerCase();
    return {
      host: process.env.EMAIL_HOST || '',
      port: Number(process.env.EMAIL_PORT || 465),
      secure: ['true', '1', 'yes'].includes(secureRaw),
      user: process.env.EMAIL_USER || '',
      configured: Boolean(process.env.EMAIL_HOST) && Boolean(process.env.EMAIL_USER),
    };
  },
  /**
   * SMS through BulkSMSNigeria or any generic JSON HTTP provider.
   * BulkSMS can be configured with BULKSMS_API_TOKEN/BULKSMS_SENDER_ID alone;
   * the explicit SMS_HTTP_* variables remain for other gateways.
   */
  get sms() {
    const bulkToken = process.env.BULKSMS_API_TOKEN || '';
    let headers = {};
    let extra = {};
    if (process.env.SMS_HTTP_HEADERS) {
      try { headers = JSON.parse(process.env.SMS_HTTP_HEADERS); } catch { headers = {}; }
    }
    if (Object.keys(headers).length === 0 && bulkToken) {
      headers = { Authorization: `Bearer ${bulkToken}`, Accept: 'application/json' };
    }
    try { extra = JSON.parse(process.env.SMS_HTTP_EXTRA || '{}'); } catch { extra = {}; }
    const url = process.env.SMS_HTTP_URL
      || (bulkToken ? 'https://www.bulksmsnigeria.com/api/v2/sms' : '');
    const provider = process.env.SMS_PROVIDER || (bulkToken ? 'bulksmsnigeria' : 'disabled');
    return {
      provider,
      url,
      method: (process.env.SMS_HTTP_METHOD || 'POST').toUpperCase(),
      headers,
      toField: process.env.SMS_HTTP_TO_FIELD || 'to',
      messageField: process.env.SMS_HTTP_MESSAGE_FIELD || 'body',
      extra,
      senderId: process.env.BULKSMS_SENDER_ID || process.env.SMS_SENDER_ID || 'marketspase',
      timeoutMs: Number(process.env.SMS_HTTP_TIMEOUT_MS || 15000),
      enabled: provider !== 'disabled' && Boolean(url),
    };
  },
};
