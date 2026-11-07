import { lagosDateKey, normalizePlanItems } from '../domain/Ora.plans.js';

/** Today's plan for the current partner (empty shell when not saved yet). */
export class GetOraPlanUseCase {
  constructor({ plans }) {
    this.plans = plans;
  }

  async execute({ partnerId, now = new Date() }) {
    const dateKey = lagosDateKey(now);
    const plan = await this.plans.get(partnerId, dateKey);
    return {
      dateKey,
      items: plan?.items ?? [],
      source: plan?.source ?? null,
      savedAt: plan?.savedAt ?? null,
    };
  }
}

/**
 * Save or edit today's plan. This is an upsert keyed by partner + day, so
 * approving the same proposal twice can never create duplicate plans.
 */
export class SaveOraPlanUseCase {
  constructor({ plans }) {
    this.plans = plans;
  }

  async execute({ partnerId, items, now = new Date(), source = 'partner' }) {
    const normalized = normalizePlanItems(items);
    const dateKey = lagosDateKey(now);
    return this.plans.save(partnerId, {
      dateKey,
      items: normalized,
      source: String(source ?? 'partner').slice(0, 20),
    });
  }
}
