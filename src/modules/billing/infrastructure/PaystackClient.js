import crypto from 'crypto';
import axios from 'axios';

const BASE = 'https://api.paystack.co';

const providerMessage = (error, fallback) =>
  String(error?.response?.data?.message ?? error?.response?.data?.error ?? error?.message ?? '').trim() || fallback;

/**
 * Paystack server client — deposits, bank lookup and account resolution.
 * The secret key never leaves the API process. Tests inject `http` so no
 * real network call is made.
 */
export class PaystackClient {
  constructor({ secretKey = process.env.PAYSTACKTOKEN, baseUrl = process.env.PAYSTACK_BASE_URL || BASE, http = axios } = {}) {
    this.secretKey = String(secretKey ?? '').trim();
    this.baseUrl = String(baseUrl ?? BASE).replace(/\/+$/, '');
    this.http = http;
  }

  get enabled() {
    return this.secretKey.length > 0;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** Create a hosted checkout. Returns the redirect URL and access code. */
  async initialize({ reference, amountKobo, email, callbackUrl, metadata = {} }) {
    if (!this.enabled) throw new Error('Paystack is not configured');
    let response;
    try {
      response = await this.http.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: Math.round(Number(amountKobo)),
          reference,
          ...(callbackUrl ? { callback_url: callbackUrl } : {}),
          metadata,
        },
        { headers: this.headers(), timeout: 30000 },
      );
    } catch (error) {
      throw new Error(providerMessage(error, 'Paystack could not open a checkout'));
    }
    const data = response?.data?.data ?? response?.data;
    if (!data?.authorization_url) throw new Error('Paystack did not return a checkout URL');
    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code ?? null,
      reference: data.reference ?? reference,
      status: data.status ?? 'pending',
    };
  }

  /** Server-side verification — the source of truth for a successful charge. */
  async verify(reference) {
    if (!this.enabled) throw new Error('Paystack is not configured');
    const ref = encodeURIComponent(String(reference ?? '').trim());
    const response = await this.http.get(`${this.baseUrl}/transaction/verify/${ref}`, {
      headers: this.headers(),
      timeout: 30000,
    });
    const data = response?.data?.data ?? response?.data;
    if (!data) throw new Error('Paystack returned no transaction');
    return data;
  }

  /** NUBAN account-name lookup. */
  async resolveAccount(accountNumber, bankCode) {
    if (!this.enabled) throw new Error('Paystack is not configured');
    let response;
    try {
      response = await this.http.get(`${this.baseUrl}/bank/resolve`, {
        params: { account_number: String(accountNumber ?? '').trim(), bank_code: String(bankCode ?? '').trim() },
        headers: this.headers(),
        timeout: 30000,
      });
    } catch {
      // Paystack's raw text ("check parameters") is not user-facing copy.
      throw new Error('We could not verify that account — check the number and bank, then try again.');
    }
    const data = response?.data?.data ?? response?.data;
    if (!data?.account_name) throw new Error('We could not verify that account — check the number and bank, then try again.');
    return { accountName: data.account_name, accountNumber: data.account_number ?? String(accountNumber) };
  }

  /** Bank directory for the withdrawal form (cached briefly). */
  async listBanks() {
    if (!this.enabled) throw new Error('Paystack is not configured');
    const now = Date.now();
    if (Array.isArray(this._banks) && this._banksAt && now - this._banksAt < 10 * 60 * 1000) {
      return this._banks;
    }
    const response = await this.http.get(`${this.baseUrl}/bank`, {
      params: { currency: 'NGN', perPage: 100 },
      headers: this.headers(),
      timeout: 30000,
    });
    const data = response?.data?.data ?? response?.data;
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const list = [];
    for (const bank of data) {
      const name = String(bank?.name ?? '').trim();
      const code = String(bank?.code ?? '').trim();
      if (!name || !code || seen.has(code)) continue;
      seen.add(code);
      list.push({ name, code });
    }
    this._banks = list;
    this._banksAt = now;
    return list;
  }

  /** Create a NUBAN transfer recipient for an automatic payout. */
  async createTransferRecipient({ name, accountNumber, bankCode, currency = 'NGN', description }) {
    if (!this.enabled) throw new Error('Paystack is not configured');
    let response;
    try {
      response = await this.http.post(
        `${this.baseUrl}/transferrecipient`,
        {
          type: 'nuban',
          name: String(name ?? '').trim(),
          account_number: String(accountNumber ?? '').trim(),
          bank_code: String(bankCode ?? '').trim(),
          currency,
          ...(description ? { description: String(description).slice(0, 100) } : {}),
        },
        { headers: this.headers(), timeout: 30000 },
      );
    } catch (error) {
      throw new Error(providerMessage(error, 'We could not set up this payout account — try again.'));
    }
    const data = response?.data?.data ?? response?.data;
    if (!data?.recipient_code) throw new Error('Paystack did not return a transfer recipient');
    return { recipientCode: data.recipient_code, details: data.details ?? null };
  }

  /** Start a transfer from the Paystack balance. */
  async initiateTransfer({ recipientCode, amountKobo, reference, reason, currency = 'NGN' }) {
    if (!this.enabled) throw new Error('Paystack is not configured');
    let response;
    try {
      response = await this.http.post(
        `${this.baseUrl}/transfer`,
        {
          source: 'balance',
          amount: Math.round(Number(amountKobo)),
          recipient: String(recipientCode ?? '').trim(),
          reference: String(reference ?? '').trim(),
          reason: String(reason ?? 'Wallet withdrawal').slice(0, 100),
          currency,
        },
        { headers: this.headers(), timeout: 30000 },
      );
    } catch (error) {
      const message = providerMessage(error, 'Paystack could not start the payout');
      throw new Error(/insufficient/i.test(message) ? 'Payouts are temporarily unavailable — try again later.' : message);
    }
    const data = response?.data?.data ?? response?.data;
    if (!data?.transfer_code) throw new Error('Paystack did not return a transfer');
    return {
      transferCode: data.transfer_code,
      status: String(data.status ?? 'pending').toLowerCase(),
      reference: data.reference ?? reference,
      amountKobo: Number(data.amount ?? amountKobo),
      raw: data,
    };
  }

  /** Verify a transfer by our withdrawal reference. */
  async verifyTransfer(reference) {
    if (!this.enabled) throw new Error('Paystack is not configured');
    const ref = encodeURIComponent(String(reference ?? '').trim());
    let response;
    try {
      response = await this.http.get(`${this.baseUrl}/transfer/verify/${ref}`, {
        headers: this.headers(),
        timeout: 30000,
      });
    } catch (error) {
      if (error?.response?.status === 404) {
        const notFound = new Error('Transfer not found');
        notFound.code = 'TRANSFER_NOT_FOUND';
        throw notFound;
      }
      throw new Error(providerMessage(error, 'Paystack could not verify the payout'));
    }
    const data = response?.data?.data ?? response?.data;
    if (!data) throw new Error('Paystack returned no transfer');
    return data;
  }

  /** Available NGN balance in kobo (null when the provider cannot answer). */
  async availableBalanceKobo(currency = 'NGN') {
    if (!this.enabled) throw new Error('Paystack is not configured');
    try {
      const response = await this.http.get(`${this.baseUrl}/balance`, {
        headers: this.headers(),
        timeout: 30000,
      });
      const data = response?.data?.data ?? response?.data;
      if (!Array.isArray(data)) return null;
      const row = data.find(
        (entry) => String(entry?.currency ?? '').toUpperCase() === String(currency).toUpperCase(),
      );
      return row ? Number(row.balance) : null;
    } catch {
      return null;
    }
  }
}

/** Verify the `x-paystack-signature` HMAC-SHA512 against the raw request body. */
export const verifyPaystackSignature = (rawBody, signature, secretKey = process.env.PAYSTACKTOKEN) => {
  if (!rawBody || !signature || !secretKey) return false;
  const expected = crypto.createHmac('sha512', String(secretKey)).update(rawBody).digest('hex');
  const a = Buffer.from(String(signature).toLowerCase(), 'utf8');
  const b = Buffer.from(expected.toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
