import { domainEvents } from '../../../shared/events/DomainEvents.js';
import {
  campaignCapacity,
  scoreAllocationPair,
} from '../domain/Campaign.allocation.js';

export class CreateGrowthCampaignUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(ownerId, input) {
    return this.repo.createCampaign({ ownerId, input });
  }
}

export class ListMyGrowthCampaignsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(ownerId) {
    return this.repo.listMine(ownerId);
  }
}

export class GetMyGrowthCampaignUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(campaignId, ownerId) {
    return this.repo.getMine(campaignId, ownerId);
  }
}

export class CancelGrowthCampaignUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(campaignId, ownerId, reason) {
    const campaign = await this.repo.cancelCampaign({ campaignId, ownerId, reason });
    await this.events.emit('campaign.cancelled', {
      campaignId: campaign.id,
      ownerId: String(ownerId),
      reason: campaign.refundReason,
    }).catch(() => null);
    return campaign;
  }
}

export class PauseGrowthCampaignUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(campaignId, ownerId = null) {
    return this.repo.pauseCampaign({ campaignId, actorId: ownerId, ownerId });
  }
}

export class ResumeGrowthCampaignUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(campaignId, ownerId = null) {
    return this.repo.resumeCampaign({ campaignId, ownerId });
  }
}

export class ListAdminGrowthCampaignsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query) {
    return this.repo.listAdmin(query);
  }
}

export class ActivateGrowthCampaignUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(campaignId, adminId) {
    const campaign = await this.repo.activateCampaign({ campaignId, adminId });
    await this.events.emit('campaign.activated', {
      campaignId: campaign.id,
      ownerId: campaign.owner?.id ?? null,
      activatedBy: String(adminId),
    }).catch(() => null);
    return campaign;
  }
}

export class RejectGrowthCampaignUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(campaignId, adminId, reason) {
    const campaign = await this.repo.rejectCampaign({ campaignId, adminId, reason });
    await this.events.emit('campaign.rejected', {
      campaignId: campaign.id,
      ownerId: campaign.owner?.id ?? null,
      reason,
    }).catch(() => null);
    return campaign;
  }
}

export class EndGrowthCampaignUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(campaignId, adminId, spentAmount, note) {
    const campaign = await this.repo.endCampaign({ campaignId, adminId, spentAmount, note });
    await this.events.emit('campaign.ended', {
      campaignId: campaign.id,
      ownerId: campaign.owner?.id ?? null,
      spentAmount: campaign.budget?.spent ?? 0,
      refunded: campaign.budget?.refunded ?? 0,
    }).catch(() => null);
    return campaign;
  }
}

export class GetCampaignQueueUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query) {
    return this.repo.queueSnapshot(query);
  }
}

export class GetMyAllocationUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId) {
    return this.repo.myAllocation(partnerId);
  }
}

export class ListMyPlacedPartnersUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(ownerId) {
    return this.repo.listPlacedPartners(ownerId);
  }
}

export class AllocatePartnersUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute({ campaignId = null, limit = 20, actorId = null } = {}) {
    const context = await this.repo.loadAllocationContext({ campaignId });
    const workingCampaigns = context.campaigns.map((entry) => ({
      campaign: {
        ...entry.campaign,
        capacity: { ...entry.campaign.capacity },
      },
      owner: entry.owner,
      weeklyAllocated: entry.weeklyAllocated,
    }));
    const candidates = [...context.candidates];
    const target = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const allocated = [];
    const skipped = { races: 0, failures: 0 };

    while (allocated.length < target) {
      let best = null;
      for (const entry of workingCampaigns) {
        if (campaignCapacity(entry.campaign, entry.weeklyAllocated).remaining <= 0) continue;
        if (campaignCapacity(entry.campaign, entry.weeklyAllocated).weeklyRemaining <= 0) continue;
        for (const candidate of candidates) {
          const scored = scoreAllocationPair({
            campaign: entry.campaign,
            queueEntry: candidate.queueEntry,
            partner: candidate.partner,
            partnerState: candidate.partnerState,
            weeklyAllocated: entry.weeklyAllocated,
            now: context.now,
          });
          if (!scored) continue;
          if (!best
            || scored.total > best.scored.total
            || (scored.total === best.scored.total
              && new Date(candidate.queueEntry.enteredAt) < new Date(best.candidate.queueEntry.enteredAt))
            || (scored.total === best.scored.total
              && new Date(candidate.queueEntry.enteredAt).getTime() === new Date(best.candidate.queueEntry.enteredAt).getTime()
              && new Date(entry.campaign.createdAt) < new Date(best.entry.campaign.createdAt))
          ) {
            best = { entry, candidate, scored };
          }
        }
      }

      if (!best) break;

      try {
        const result = await this.repo.allocatePair({
          campaignId: best.entry.campaign._id,
          ownerId: best.entry.campaign.ownerId,
          queueEntryId: best.candidate.queueEntry._id,
          partnerId: best.candidate.partner._id,
          score: best.scored.score,
          components: best.scored.components,
          explanation: best.scored.explanation,
          weeklyCap: best.entry.campaign.capacity?.maxPerWeek,
          now: context.now,
        });
        allocated.push(result);
        best.entry.campaign.capacity.allocated = Number(best.entry.campaign.capacity.allocated) + 1;
        best.entry.weeklyAllocated += 1;
        const index = candidates.indexOf(best.candidate);
        if (index >= 0) candidates.splice(index, 1);
        await this.events.emit('partner.allocated', {
          partnerId: result.partner.id,
          campaignId: result.campaign.id,
          ownerId: String(best.entry.campaign.ownerId),
          allocatedBy: actorId ? String(actorId) : null,
          score: best.scored.total,
        }).catch(() => null);
      } catch (error) {
        if (error?.code === 'CONFLICT' || error?.code === 11000) {
          skipped.races += 1;
          const message = String(error?.message ?? '');
          if (/capacity/i.test(message)) {
            best.entry.campaign.capacity.total = best.entry.campaign.capacity.allocated;
          } else if (/weekly/i.test(message)) {
            best.entry.weeklyAllocated = best.entry.campaign.capacity.maxPerWeek;
          } else if (/owner.*eligible/i.test(message)) {
            best.entry.campaign.status = 'Paused';
          } else {
            const index = candidates.indexOf(best.candidate);
            if (index >= 0) candidates.splice(index, 1);
          }
          continue;
        }
        skipped.failures += 1;
        throw error;
      }
    }

    return {
      allocated,
      skipped,
      context: {
        campaigns: workingCampaigns.length,
        candidates: context.candidates.length,
        remainingCandidates: candidates.length,
      },
    };
  }
}
