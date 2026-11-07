import { readinessScore } from '../domain/Training.readiness.js';
import { LEVEL_LABELS, normalizeLevel } from '../../progression/domain/Progression.levels.js';

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
    if (this.progression?.execute) {
      return this.progression.execute({ partnerId, readOnly: true });
    }
    if (this.progression?.mine) return this.progression.mine(partnerId);
    if (this.progression?.findByPartner) {
      const doc = await this.progression.findByPartner(partnerId);
      if (!doc) return { level: 'partner', levelLabel: 'Partner', next: 'builder', nextLabel: 'Builder', percent: 0, missing: [], remainingActions: [] };
      const level = normalizeLevel(doc.level);
      return {
        level,
        levelLabel: LEVEL_LABELS[level],
        next: doc.next ?? null,
        nextLabel: doc.nextLabel ?? null,
        percent: doc.percent ?? 0,
        missing: doc.missing ?? [],
        remainingActions: doc.remainingActions ?? [],
      };
    }
    throw new Error('No progression source available');
  }
}
