import { ValidationException } from '../../../shared/domain/AppError.js';
import { MAX_LEVELS } from '../domain/CommissionPlan.js';

/**
 * Commission-plan administration. Rates apply to FUTURE accrues only —
 * settled entries keep the plan they were computed under (history rows
 * are never rewritten). A change deactivates the current plan and
 * activates a new row, so disputes can always time-travel.
 */
export const validateRates = (rates) => {
  if (!Array.isArray(rates) || rates.length < 1 || rates.length > MAX_LEVELS) {
    throw new ValidationException(`Rates must be 1–${MAX_LEVELS} level values`);
  }
  const clean = rates.map((r) => Number(r));
  if (clean.some((r) => !Number.isFinite(r) || r <= 0 || r > 1)) {
    throw new ValidationException('Each rate must be greater than 0 and at most 1');
  }
  const sum = clean.reduce((s, r) => s + r, 0);
  if (sum > 1) throw new ValidationException('Rates must sum to at most 1 (100% of purchase)');
  return clean.map((r) => Math.round(r * 10000) / 10000);
};

export class GetPlanUseCase {
  /** @param {{ledger}} deps */
  constructor({ ledger }) {
    this.ledger = ledger;
  }

  async execute() {
    const plan = await this.ledger.getActivePlan();
    return {
      id: String(plan._id ?? plan.id),
      name: plan.name ?? 'Default Unilevel',
      rates: [...(plan.rates ?? [])],
      updatedAt: plan.updatedAt ?? null,
    };
  }
}

export class UpdatePlanUseCase {
  /** @param {{ledger}} deps */
  constructor({ ledger }) {
    this.ledger = ledger;
  }

  async execute({ rates, name = null, updatedBy = null }) {
    const clean = validateRates(rates);
    const plan = await this.ledger.rotatePlan({
      name: name && String(name).trim() !== '' ? String(name).trim().slice(0, 120) : 'Custom Unilevel',
      rates: clean,
      updatedBy,
    });
    return {
      id: String(plan._id ?? plan.id),
      name: plan.name,
      rates: [...plan.rates],
      updatedAt: plan.updatedAt ?? null,
    };
  }
}
