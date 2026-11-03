import { readinessScore } from '../domain/Training.readiness.js';

/** GET /v1/training/readiness — promotion readiness for the next rank. */
export class ReadinessUseCase {
  /** @param {{progression}} deps */
  constructor({ progression }) {
    this.progression = progression;
  }

  async execute({ partnerId }) {
    const journey = await this.loadJourney(partnerId);
    const r = readinessScore(journey);
    return {
      level: journey.level,
      levelLabel: journey.levelLabel,
      next: journey.next,
      nextLabel: journey.nextLabel,
      percent: journey.percent,
      score: r.score,
      label: r.label,
      done: r.done,
      total: r.total,
      missing: r.missing,
      remainingActions: journey.remainingActions ?? [],
    };
  }

  async loadJourney(partnerId) {
    if (this.progression?.mine) return this.progression.mine(partnerId);
    if (this.progression?.findByPartner) {
      const doc = await this.progression.findByPartner(partnerId);
      if (!doc) return { level: 'partner', levelLabel: 'Partner', next: 'emerging_active', nextLabel: 'Emerging Active Partner', percent: 0, missing: [], remainingActions: [] };
      return {
        level: doc.level ?? doc.levelLabel ?? 'partner',
        levelLabel: doc.levelLabel ?? doc.level ?? 'Partner',
        next: doc.next ?? doc.nextLabel ?? null,
        nextLabel: doc.nextLabel ?? null,
        percent: doc.percent ?? 0,
        missing: doc.missing ?? [],
        remainingActions: doc.remainingActions ?? [],
      };
    }
    throw new Error('No progression source available');
  }
}
