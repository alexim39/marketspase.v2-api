import { NotFoundException } from '../../../shared/domain/AppError.js';
import { MAX_SAVED_PAYOUT_ACCOUNTS } from '../domain/SavedPayoutAccount.js';

/**
 * GET /v1/billing/withdrawal-account — the most recent saved destination.
 * Kept for older clients; the multi-account UI uses the list endpoint.
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

/** GET /v1/billing/withdrawal-accounts — all saved destinations, max five. */
export class ListSavedPayoutAccountsUseCase {
  constructor({ savedAccounts }) {
    this.savedAccounts = savedAccounts;
  }

  async execute({ partnerId }) {
    const accounts = await this.savedAccounts.listByPartner(partnerId).catch(() => []);
    return { accounts, max: MAX_SAVED_PAYOUT_ACCOUNTS };
  }
}

/** DELETE /v1/billing/withdrawal-accounts/:accountId — owner-scoped removal. */
export class DeleteSavedPayoutAccountUseCase {
  constructor({ savedAccounts }) {
    this.savedAccounts = savedAccounts;
  }

  async execute({ partnerId, accountId }) {
    const result = await this.savedAccounts.remove(partnerId, accountId);
    if (!result?.removed) {
      throw new NotFoundException('Saved payout account not found');
    }
    return { removed: true };
  }
}
