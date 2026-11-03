import crypto from 'crypto';
import axios from 'axios';

/**
 * OPay Express Checkout (Cashier) client — deposits only.
 * Raw HTTP behind injectable seams (`post` overndable in tests), so no
 * test ever touches testapi/liveapi. Two different signature schemes
 * (docs-verified, do NOT unify):
 * - API calls (create/status): HMAC-SHA512 hex of the RAW JSON body.
 * - Callback verification: HMAC-SHA3-512 hex of the CANONICAL format
 *   string below, signed with the Private Key.
 */
export const OPAY_TEST_BASE = 'https://testapi.opaycheckout.com';
export const OPAY_LIVE_BASE = 'https://liveapi.opaycheckout.com';

export const hmacSha512Hex = (body, secret) =>
  crypto.createHmac('sha512', String(secret)).update(String(body), 'utf8').digest('hex');

/** Canonical callback format (docs §Callback Signature Validation). */
export const callbackSignContent = (p) => {
  const refunded = p?.refunded === true ? 't' : 'f';
  return `{Amount:"${p?.amount ?? ''}",Currency:"${p?.currency ?? ''}",Reference:"${p?.reference ?? ''}",Refunded:${refunded},Status:"${p?.status ?? ''}",Timestamp:"${p?.timestamp ?? ''}",Token:"${p?.token ?? ''}",TransactionID:"${p?.transactionId ?? ''}"}`;
};

export const verifyCallbackSignature = (payload, sha512, privateKey) => {
  if (!payload || !sha512 || !privateKey) return false;
  const expected = crypto
    .createHmac('sha3-512', String(privateKey))
    .update(callbackSignContent(payload), 'utf8')
    .digest('hex');
  const a = Buffer.from(String(sha512).toLowerCase(), 'utf8');
  const b = Buffer.from(expected.toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export class OpayClient {
  /**
   * @param {{baseUrl, publicKey, privateKey, merchantId, post?}} config
   * (`post` = `(url, body, headers) => Promise<{status, data}>`, axios-shaped.)
   */
  constructor(config = {}) {
    this.config = {
      baseUrl: (config.baseUrl || OPAY_TEST_BASE).replace(/\/+$/, ''),
      publicKey: config.publicKey || '',
      privateKey: config.privateKey || '',
      merchantId: config.merchantId || '',
    };
    this.post = config.post ?? (async (url, body, headers) => {
      const res = await axios.post(url, body, { headers, timeout: 30000 });
      return { status: res.status, data: res.data };
    });
  }

  get enabled() {
    const c = this.config;
    return Boolean(c.publicKey && c.privateKey && c.merchantId);
  }

  /** POST a signed JSON body (HMAC-SHA512 of the exact bytes sent). */
  async signedPost(path, body) {
    const { baseUrl, privateKey, merchantId } = this.config;
    if (!this.enabled) throw new Error('Opay is not configured (keys/merchant id missing)');
    const raw = JSON.stringify(body);
    const { status, data } = await this.post(`${baseUrl}${path}`, JSON.parse(raw), {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hmacSha512Hex(raw, privateKey)}`,
      MerchantId: merchantId,
    });
    return { status, data };
  }

  /**
   * Open a cashier session. Returns `{ reference, orderNo, cashierUrl }`.
   * Auth per docs cashier-create: Bearer PUBLIC key (unsigned call).
   */
  async createCashier({ reference, amountKobo, email, name, phone, userId, callbackUrl, returnUrl, cancelUrl }) {
    const { baseUrl, publicKey, merchantId } = this.config;
    if (!this.enabled) throw new Error('Opay is not configured (keys/merchant id missing)');
    const body = {
      country: 'NG',
      reference,
      amount: { total: amountKobo, currency: 'NGN' },
      returnUrl,
      callbackUrl,
      cancelUrl,
      product: { name: 'Wallet Deposit', description: 'Diamond Project wallet top-up' },
      userInfo: {
        userEmail: email ?? '',
        userId: userId ?? '',
        userMobile: phone ?? '',
        userName: name ?? '',
      },
      customerVisitSource: 'BROWSER',
      expireAt: 30,
    };
    const { data } = await this.post(`${baseUrl}/api/v1/international/cashier/create`, body, {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publicKey}`,
      MerchantId: merchantId,
    });
    if (data?.code !== '00000' || !data?.data?.cashierUrl) {
      throw new Error(`Opay cashier failed: ${data?.code ?? '?'} ${data?.message ?? 'no cashierUrl'}`);
    }
    return {
      reference: data.data.reference ?? reference,
      orderNo: data.data.orderNo ?? null,
      cashierUrl: data.data.cashierUrl,
      status: data.data.status ?? 'INITIAL',
    };
  }

  /** Cross-check a reference (docs recommend before trusting callbacks). */
  async queryStatus(reference) {
    const { data } = await this.signedPost('/api/v1/international/cashier/status', {
      reference,
      country: 'NG',
    });
    if (data?.code !== '00000') {
      throw new Error(`Opay status query failed: ${data?.code ?? '?'} ${data?.message ?? ''}`);
    }
    return data.data;
  }
}
