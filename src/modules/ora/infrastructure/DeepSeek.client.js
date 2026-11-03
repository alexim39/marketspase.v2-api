import axios from 'axios';

/**
 * DeepSeek chat client (OpenAI-compatible `/chat/completions`).
 * Server-side only — the key never leaves this process: it travels in
 * the Authorization header of this call and is never logged, stored or
 * echoed. Timeouts + error mapping keep provider outages a clean 503
 * instead of a hung request. Inject `post` in tests.
 */
export class DeepSeekClient {
  /**
   * @param {{apiKey, baseUrl, model, maxTokens, temperature, timeoutMs, post?}} config
   */
  constructor(config = {}) {
    this.config = {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      maxTokens: 800,
      temperature: 0.4,
      timeoutMs: 30000,
      ...config,
    };
    this.post = config.post ?? ((url, body, opts) => axios.post(url, body, opts));
  }

  get enabled() {
    return Boolean(this.config.apiKey);
  }

  /**
   * @param {{system, messages}} input (messages: [{role, content}] oldest-first)
   * @returns assistant reply text (trimmed, non-empty)
   */
  async complete({ system, messages = [] }) {
    if (!this.enabled) {
      const error = new Error('Ora is not configured yet (missing API key)');
      error.statusCode = 503;
      error.code = 'ORA_NOT_CONFIGURED';
      throw error;
    }
    const url = `${String(this.config.baseUrl).replace(/\/+$/, '')}/chat/completions`;
    let res;
    try {
      res = await this.post(
        url,
        {
          model: this.config.model,
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        },
        {
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          timeout: this.config.timeoutMs,
        },
      );
    } catch (error) {
      const mapped = new Error('Ora is temporarily unavailable — please try again shortly');
      mapped.statusCode = 503;
      mapped.code = 'ORA_PROVIDER_ERROR';
      mapped.details = error?.response?.status ?? error?.code ?? undefined;
      throw mapped;
    }
    const text = String(res?.data?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) {
      const error = new Error('Ora returned an empty response — please try again');
      error.statusCode = 503;
      error.code = 'ORA_EMPTY_RESPONSE';
      throw error;
    }
    return text;
  }
}
