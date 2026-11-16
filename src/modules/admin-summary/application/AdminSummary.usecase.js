import { ValidationException } from '../../../shared/domain/AppError.js';
import { AdminSummaryRepository, summaryWindow } from '../infrastructure/AdminSummary.repository.js';

const DOMAINS = ['people', 'finance', 'commerce', 'growth', 'support', 'content', 'communications'];

/**
 * Read-only admin summaries. Each domain returns the same decision-oriented
 * DTO so the admin UI can render KPI cards, trends and distributions without
 * domain-specific page code.
 */
export class GetAdminSummaryUseCase {
  constructor({ repo } = {}) {
    this.repo = repo ?? new AdminSummaryRepository();
  }

  async execute({ domain, days = 30, now = new Date() }) {
    const key = String(domain ?? '').trim().toLowerCase();
    if (!DOMAINS.includes(key)) {
      throw new ValidationException(`Unknown summary domain: ${domain || 'missing'}`);
    }
    const window = summaryWindow(days, now);
    const data = await this.repo[key](window);
    return { ...data, window: { ...data.window, days: window.days } };
  }
}

export { DOMAINS as ADMIN_SUMMARY_DOMAINS };
