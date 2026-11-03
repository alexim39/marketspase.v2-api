import { domainEvents } from '../../../shared/events/DomainEvents.js';

export class RecordActivationCompensationUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(payload) {
    return this.repo.recordActivation(payload);
  }
}

export class RecordAllocationCompensationUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(payload) {
    const results = await this.repo.handleAllocation(payload);
    for (const result of results) {
      await this.events.emit('commission.accrued', result).catch(() => null);
    }
    return results;
  }
}

export class CancelActivationCompensationUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(payload) {
    const result = await this.repo.cancelActivation(payload);
    await this.events.emit('commission.reversed', {
      partnerId: payload.partnerId ?? null,
      orderId: payload.orderId ?? null,
      ...result,
    }).catch(() => null);
    return result;
  }
}

export class GetMyCompensationUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId) {
    return this.repo.listMine(partnerId);
  }
}

export class ListAdminCommissionEntriesUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query) {
    return this.repo.listAdminEntries(query);
  }
}

export class ReleaseCommissionUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(entryId, adminId) {
    return this.repo.releaseEntry(entryId, adminId);
  }
}

export class VoidCommissionUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(entryId, adminId, reason) {
    return this.repo.voidEntry(entryId, adminId, reason);
  }
}

export class ListAdminMentorBonusesUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query) {
    return this.repo.listAdminBonuses(query);
  }
}

export class RunMentorBonusesUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(now = new Date()) {
    return this.repo.runMentorBonuses(now);
  }
}

export class SetCommissionRankUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(identifier, rank) {
    return this.repo.setRank(identifier, rank);
  }
}
