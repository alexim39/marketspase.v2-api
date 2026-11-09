import { AppError, ValidationException } from '../../../shared/domain/AppError.js';

/** Paystack bank directory — proxied so the secret never reaches the client. */
export class ListBanksUseCase {
  /** @param {{http}} deps (axios-compatible; stubbed in tests) */
  constructor({ http }) {
    this.http = http;
  }

  async execute() {
    const secret = process.env.PAYSTACKTOKEN;
    if (!secret) throw new AppError('Payment provider not configured', 500, 'CONFIG_ERROR');
    let data;
    try {
      const response = await this.http.get('https://api.paystack.co/bank', {
        params: { currency: 'NGN', perPage: 100 },
        headers: { Authorization: `Bearer ${secret}` },
      });
      data = response?.data?.data ?? response?.data;
    } catch {
      throw new AppError('Could not load the bank list', 502, 'PROVIDER_ERROR');
    }
    if (!Array.isArray(data)) return [];
    // Paystack's live directory can contain two names for one bank code.
    // Keep one row per code so selects/autocomplete have unique keys.
    const seen = new Set();
    const list = [];
    for (const bank of data) {
      const name = String(bank?.name ?? '').trim();
      const code = String(bank?.code ?? '').trim();
      if (!name || !code || seen.has(code)) continue;
      seen.add(code);
      list.push({ name, code });
    }
    return list;
  }
}

/**
 * Resolve a bank account holder via Paystack — the secret lives server-side
 * (PAYSTACKTOKEN); the client must never call api.paystack.co directly.
 */
export class ResolveAccountUseCase {
  /** @param {{http}} deps (axios-compatible; stubbed in tests) */
  constructor({ http }) {
    this.http = http;
  }

  async execute({ accountNumber, bankCode }) {
    const acct = String(accountNumber ?? '').trim();
    const bank = String(bankCode ?? '').trim();
    if (!/^\d{10}$/.test(acct)) throw new ValidationException('Invalid account number');
    if (!bank) throw new ValidationException('Invalid bank code');
    const secret = process.env.PAYSTACKTOKEN;
    if (!secret) throw new AppError('Payment provider not configured', 500, 'CONFIG_ERROR');
    let data;
    try {
      const response = await this.http.get('https://api.paystack.co/bank/resolve', {
        params: { account_number: acct, bank_code: bank },
        headers: { Authorization: `Bearer ${secret}` },
      });
      data = response?.data?.data ?? response?.data;
    } catch {
      throw new ValidationException(
        'We could not verify that account — check the number and bank, then try again.',
      );
    }
    if (!data?.account_name) {
      throw new ValidationException('We could not verify that account — check the number and bank, then try again.');
    }
    return { accountName: data.account_name, accountNumber: data.account_number ?? acct };
  }
}
