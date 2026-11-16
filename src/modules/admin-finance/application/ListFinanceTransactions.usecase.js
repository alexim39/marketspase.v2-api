import { AdminFinanceRepository } from '../infrastructure/AdminFinance.repository.js';

export class ListFinanceTransactionsUseCase {
  constructor({ repo } = {}) {
    this.repo = repo ?? new AdminFinanceRepository();
  }

  async execute({ type = 'all', status = '', q = '', from = null, to = null, limit = 50, skip = 0 } = {}) {
    return this.repo.transactions({
      type,
      status: String(status ?? '').trim(),
      q: String(q ?? '').trim(),
      from: from || null,
      to: to || null,
      limit,
      skip,
    });
  }
}

export default ListFinanceTransactionsUseCase;
