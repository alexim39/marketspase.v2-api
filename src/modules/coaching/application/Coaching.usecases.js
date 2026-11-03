import { createNoteEntity } from '../domain/Coaching.entity.js';
import { isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';

/** GET /v1/coaching/mine — your coach (direct upline), action items and next step. */
export class GetMyCoachUseCase {
  /** @param {{network, progression, training}} deps */
  constructor({ network, progression, training }) {
    Object.assign(this, { network, progression, training });
  }

  async execute({ partnerId }) {
    const node = await this.network.findNode(partnerId);
    const coachId = node?.parentId ? String(node.parentId) : null;
    const [coach, journey] = await Promise.all([
      coachId ? this.network.findNode(coachId).catch(() => null) : null,
      this.loadJourney(partnerId),
    ]);
    const nextAction = journey?.missing?.[0]?.action ?? journey?.remainingActions?.[0] ?? null;
    return {
      coach: coach ? { id: String(coach.id), name: [coach.name, coach.surname].filter(Boolean).join(' ') || coach.username, username: coach.username, profileImage: coach.profileImage ?? null } : null,
      journey: journey ? { levelLabel: journey.levelLabel, nextLabel: journey.nextLabel, percent: journey.percent } : null,
      nextAction,
      missing: journey?.missing ?? [],
    };
  }

  /** Works whether progression is a store (findByPartner) or a use case (mine). */
  async loadJourney(partnerId) {
    if (this.progression?.mine) return this.progression.mine(partnerId).catch(() => null);
    if (this.progression?.findByPartner) {
      const doc = await this.progression.findByPartner(partnerId).catch(() => null);
      if (!doc) return null;
      return {
        levelLabel: doc.levelLabel ?? doc.level ?? 'Partner',
        nextLabel: doc.nextLabel ?? null,
        percent: doc.percent ?? 0,
        missing: doc.missing ?? [],
        remainingActions: doc.remainingActions ?? [],
      };
    }
    return null;
  }
}

export class AddNoteUseCase {
  /** @param {{coaching, network}} deps */
  constructor({ coaching, network }) {
    Object.assign(this, { coaching, network });
  }

  async execute({ coachId, memberId, body }) {
    if (String(coachId) === String(memberId)) throw new (await import('../../../shared/domain/AppError.js')).ValidationException('You cannot coach yourself');
    // Coach must be upline of member (any depth) or the member themself via dashboard — keep the rule tight.
    const isCoach = await isAncestor(this.network, coachId, memberId).catch(() => false);
    const isSelf = String(coachId) === String(memberId);
    if (!isCoach && !isSelf) throw new (await import('../../../shared/domain/AppError.js')).ForbiddenException('Only an upline can coach this member');
    const entity = createNoteEntity({ body });
    return this.coaching.addNote({ memberId, coachId, body: entity.body });
  }
}

export class ListNotesUseCase {
  /** @param {{coaching, network}} deps */
  constructor({ coaching, network }) {
    Object.assign(this, { coaching, network });
  }

  async execute({ requesterId, memberId, limit = 50 }) {
    const target = memberId ?? requesterId;
    if (String(target) !== String(requesterId)) {
      const isCoach = await isAncestor(this.network, requesterId, target).catch(() => false);
      if (!isCoach) throw new (await import('../../../shared/domain/AppError.js')).ForbiddenException('Only an upline can view these notes');
    }
    return this.coaching.listNotes(target, limit);
  }
}
