import { ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { computeProgress, createGoalEntity } from '../domain/Goal.entity.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

const samePartner = (docPartnerId, requesterId) => String(docPartnerId) === String(requesterId);
const assertOwner = (doc, requesterId, what = 'Goal') => {
  if (!doc) throw new NotFoundException(`${what} not found`);
  if (!samePartner(doc.partnerId, requesterId)) throw new ForbiddenException('Not your goal');
  return doc;
};

/** Count training stamps confirmed inside the goal window. */
async function confirmedTraining(progress, partnerIds, start, end) {
  if (!progress?.listConfirmationStats) return 0;
  try {
    const rows = await progress.listConfirmationStats(partnerIds, ['ipo', 'qsg', 'smo']);
    let total = 0;
    for (const row of rows ?? []) {
      for (const key of ['ipo', 'qsg', 'smo']) {
        const at = row?.[key]?.confirmedAt;
        if (!at) continue;
        const when = new Date(at).getTime();
        if (when >= start.getTime() && when <= end.getTime()) total += 1;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** Resolve the live numerator for a goal kind (no cached counters). */
async function currentValue(kind, partnerId, start, end, { orders, prospects, network, progress }) {
  switch (kind) {
    case 'sales':
      return (await orders.volumeBetween(partnerId, start, end)).total;
    case 'sales_orders':
      return (await orders.volumeBetween(partnerId, start, end)).orders;
    case 'recruitment':
      return orders.recruitsBetween(partnerId, start, end);
    case 'conversion':
      return prospects.countConverted(partnerId, start, end);
    case 'new_prospects':
      return prospects.countCreated(partnerId, start, end);
    case 'follow_ups':
      return prospects.countTouchedBetween(partnerId, start, end);
    case 'training':
      return confirmedTraining(progress, [partnerId], start, end);
    case 'team_volume': {
      const { ids } = await collectDownlineIds(network, partnerId);
      return (await orders.volumeForBetween(ids, start, end)).total;
    }
    case 'team_orders': {
      const { ids } = await collectDownlineIds(network, partnerId);
      return (await orders.volumeForBetween(ids, start, end)).orders;
    }
    case 'active_team': {
      const { ids } = await collectDownlineIds(network, partnerId);
      return orders.activeMemberCount(ids, start, end);
    }
    case 'team_recruitment': {
      const { ids } = await collectDownlineIds(network, partnerId);
      return orders.recruitsForBetween(ids, start, end);
    }
    default:
      return 0;
  }
}

export class CreateGoalUseCase {
  /** @param {{goals}} deps */
  constructor({ goals }) {
    this.goals = goals;
  }

  async execute({ partnerId, ...input }) {
    return this.goals.create({ ...createGoalEntity(input), partnerId });
  }
}

export class ListGoalsUseCase {
  /** @param {{goals, orders, prospects, network, progress?}} deps */
  constructor({ goals, orders, prospects, network, progress = null }) {
    Object.assign(this, { goals, orders, prospects, network, progress });
  }

  async execute({ partnerId, now = new Date() }) {
    const goals = await this.goals.listByPartner(partnerId);
    return Promise.all(goals.map(async (g) => {
      const start = new Date(g.startDate);
      const end = new Date(g.endDate);
      const current = await currentValue(g.kind, partnerId, start, end, this);
      return { ...g, progress: computeProgress(current, g.target, start, end, now) };
    }));
  }
}

export class UpdateGoalUseCase {
  /** @param {{goals}} deps */
  constructor({ goals }) {
    this.goals = goals;
  }

  async execute({ requesterId, goalId, ...patch }) {
    const existing = assertOwner(await this.goals.findById(goalId), requesterId);
    const merged = { ...existing, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const entity = createGoalEntity(merged); // re-validate whole definition
    return this.goals.updateById(goalId, entity);
  }
}

export class DeleteGoalUseCase {
  /** @param {{goals}} deps */
  constructor({ goals }) {
    this.goals = goals;
  }

  async execute({ requesterId, goalId }) {
    assertOwner(await this.goals.findById(goalId), requesterId);
    await this.goals.deleteById(goalId);
    return { deleted: true };
  }
}

export class CelebrateGoalUseCase {
  /** @param {{goals, orders, prospects, network, community, recognition, progress?}} deps */
  constructor({ goals, orders, prospects, network, community, recognition, progress = null }) {
    Object.assign(this, { goals, orders, prospects, network, community, recognition, progress });
  }

  async execute({ requesterId, goalId, now = new Date() }) {
    const doc = assertOwner(await this.goals.findById(goalId), requesterId);
    const start = new Date(doc.startDate);
    const end = new Date(doc.endDate);
    const current = await currentValue(doc.kind, doc.partnerId, start, end, this);
    const progress = computeProgress(current, doc.target, start, end, now);
    if (!progress.complete) throw new ValidationException('Goal not complete yet — keep pushing');
    // Idempotent: one celebration post per goal (refType/refId dedupe).
    const existing = await this.community?.findAutoPost?.('goal', goalId).catch(() => null);
    if (existing) return { post: existing, duplicate: true };
    let name = 'A partner';
    try {
      const node = await this.network?.findNode?.(doc.partnerId);
      if (node) name = [node.name, node.surname].filter(Boolean).join(' ') || node.username || name;
    } catch { /* name falls back */ }
    const post = await this.recognition.goal(doc.partnerId, goalId, doc.title || doc.kind, name);
    return { post, duplicate: false };
  }
}

export class GetTrendsUseCase {
  /** @param {{orders}} deps */
  constructor({ orders }) {
    this.orders = orders;
  }

  async execute({ partnerId, months = 6 }) {
    const m = Math.min(Math.max(Number(months) || 6, 2), 12);
    return { buckets: await this.orders.volumeByMonth(partnerId, m) };
  }
}
