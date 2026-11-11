/**
 * GET /v1/billing/withdrawal-account — the signed-in partner's saved payout
 * destination. Never accepts a partner id from the client.
 */
export class GetSavedPayoutAccountUseCase {
  constructor({ savedAccounts }) {
    this.savedAccounts = savedAccounts;
  }

  async execute({ partnerId }) {
    const account = await this.savedAccounts.findByPartner(partnerId).catch(() => null);
    return account
      ? { saved: true, account }
      : { saved: false, account: null };
  }
}
