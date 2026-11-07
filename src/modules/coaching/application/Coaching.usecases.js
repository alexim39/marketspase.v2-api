import { createNoteEntity } from '../domain/Coaching.entity.js';
import { collectDownlineIds, isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';
import { ForbiddenException } from '../../../shared/domain/AppError.js';

const displayName = (node) => {
  if (!node) return null;
  return [node.name, node.surname].filter(Boolean).join(' ') || node.username || null;
};

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

  /** Works whether progression is a use case (execute) or a raw store. */
  async loadJourney(partnerId) {
    if (this.progression?.execute) {
      return this.progression.execute({ partnerId, readOnly: true }).catch(() => null);
    }
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
  /** @param {{coaching, network, notify?}} deps */
  constructor({ coaching, network, notify = null }) {
    Object.assign(this, { coaching, network, notify });
  }

  async execute({ coachId, memberId, body }) {
    const actorId = String(coachId);
    const targetId = String(memberId);
    let noteCoachId = actorId;

    if (actorId === targetId) {
      // Member writing in their own coaching log. Keep the shared note
      // attached to their coach when an upline exists.
      const node = await this.network?.findNode?.(targetId).catch(() => null);
      noteCoachId = node?.parentId ? String(node.parentId) : actorId;
    } else {
      const isCoach = await isAncestor(this.network, actorId, targetId).catch(() => false);
      if (!isCoach) throw new ForbiddenException('Only an upline can coach this member');
    }

    const entity = createNoteEntity({ body });
    const note = await this.coaching.addNote({
      memberId: targetId,
      coachId: noteCoachId,
      authorId: actorId,
      body: entity.body,
    });
    await this.notifySharedNote({ note, actorId, targetId, noteCoachId });
    return note;
  }

  /**
   * A note is a shared journal entry: whichever side writes it, the other
   * side gets a notification. Best-effort — a notification failure must
   * never lose the note that was already saved.
   */
  async notifySharedNote({ note, actorId, targetId, noteCoachId }) {
    if (!this.notify?.execute) return null;
    const selfNote = actorId === targetId;
    const recipientId = selfNote ? noteCoachId : targetId;
    if (!recipientId || String(recipientId) === actorId) return null;
    try {
      const actor = await this.network?.findNode?.(actorId).catch(() => null);
      const author = displayName(actor) ?? 'Your partner';
      const snippet = String(note.body ?? '').slice(0, 180);
      return await this.notify.execute({
        recipientId,
        category: 'team',
        priority: 'medium',
        title: selfNote ? `${author} shared a coaching note` : `${author} added a coaching note`,
        body: snippet,
        icon: 'menu_book',
        link: selfNote
          ? `/dashboard/mentorship/partners/my-partners/detail/${targetId}`
          : '/dashboard/training/coach',
      });
    } catch {
      return null;
    }
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
      if (!isCoach) throw new ForbiddenException('Only an upline can view these notes');
    }
    return this.coaching.listNotes(target, limit);
  }
}

/**
 * Coach inbox: recent notes written anywhere in the caller's downline.
 * Scoped by the network — a member only ever sees notes from their own team.
 */
export class ListCoachingInboxUseCase {
  /** @param {{coaching, network}} deps */
  constructor({ coaching, network }) {
    Object.assign(this, { coaching, network });
  }

  async execute({ partnerId, limit = 50 }) {
    const { ids, capped } = await collectDownlineIds(this.network, partnerId, {
      maxDepth: 5,
      cap: 1000,
    });
    if (ids.length === 0) return { notes: [], total: 0, teamSize: 0, capped: false };
    const rows = await this.coaching.listNotesForMembers(ids, limit);
    const authorIds = rows.map((r) => String(r.authorId ?? r.coachId));
    const memberIds = rows.map((r) => String(r.memberId));
    const lookup = [...new Set([...memberIds, ...authorIds])];
    const nodes = this.network?.findNodesByIds
      ? await this.network.findNodesByIds(lookup).catch(() => [])
      : [];
    const byId = Object.fromEntries((nodes ?? []).map((n) => [String(n.id), n]));
    const notes = rows.map((row) => {
      const authorId = String(row.authorId ?? row.coachId);
      return {
        ...row,
        memberName: displayName(byId[String(row.memberId)]) ?? 'Team member',
        memberUsername: byId[String(row.memberId)]?.username ?? null,
        authorName: displayName(byId[authorId]) ?? 'Team member',
        authorRole: authorId === String(row.memberId) ? 'member' : 'coach',
      };
    });
    return { notes, total: notes.length, teamSize: ids.length, capped };
  }
}
