import {
  ConflictException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { createAnnouncementEntity, createDirectEntity, createTeamAnnouncementEntity } from '../domain/Message.entity.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { TeamModel } from '../../../apps/teams/models/teams.model.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';

/** Anyone registered may DM anyone — abuse is rate-limited, not gated. */
async function assertPartnerExists(partners, id) {
  const found = await partners.findById(id).select('_id').lean().catch(() => null);
  if (!found) throw new NotFoundException('Partner not found');
  return found;
}

/** POST /v1/messages — any registered partner may DM any other. */
export class SendDirectUseCase {
  /** @param {{messages, network, partners?}} deps */
  constructor({ messages, network, partners = null }) {
    Object.assign(this, { messages, network, partners: partners ?? PartnersModel });
  }

  async execute({ senderId, to, ...input }) {
    if (String(senderId) === String(to)) throw new ValidationException('You cannot message yourself');
    await assertPartnerExists(this.partners, to);
    return this.messages.create({ ...createDirectEntity(input), senderId, recipientId: to, kind: 'direct' });
  }
}

/** POST /v1/messages/team-announcements — owner or member to the whole team. */
export class SendTeamAnnouncementUseCase {
  /** @param {{messages}} deps */
  constructor({ messages }) {
    this.messages = messages;
  }

  async execute({ senderId, ...input }) {
    const entity = createTeamAnnouncementEntity(input);
    const team = await TeamModel.findById(entity.teamId).select('partnerId members teamName').lean();
    if (!team) throw new NotFoundException('Team not found');
    const me = String(senderId);
    const isOwner = String(team.partnerId) === me;
    const isMember = (team.members ?? []).map(String).includes(me);
    if (!isOwner && !isMember) {
      throw new ForbiddenException('Only team owners and members can announce to the team');
    }
    // Recipients: every member plus the owner (who may not list themselves),
    // minus the sender — they see it under Sent.
    const recipients = [...new Set([
      ...((team.members ?? []).map(String)),
      String(team.partnerId),
    ])].filter((id) => id && id !== me);
    if (recipients.length === 0) throw new ValidationException('No teammates to announce to');
    const { inserted } = await this.messages.createMany(recipients.map((recipientId) => ({
      senderId,
      recipientId,
      kind: 'team',
      teamId: entity.teamId,
      title: entity.title,
      body: entity.body,
    })));
    return { inserted, teamId: entity.teamId };
  }
}

/** POST /v1/messages/announcements — leader to direct team or all downline. */
export class SendAnnouncementUseCase {
  /** @param {{messages, network}} deps */
  constructor({ messages, network }) {
    Object.assign(this, { messages, network });
  }

  async execute({ senderId, ...input }) {
    const entity = createAnnouncementEntity(input);
    const recipients = entity.scope === 'all'
      ? (await collectDownlineIds(this.network, senderId)).ids
      : (await this.network.findChildren([String(senderId)], 500)).map((c) => c.id);
    if (recipients.length === 0) throw new ValidationException('You have no downline to announce to');
    const kind = entity.scope === 'all' ? 'broadcast' : 'announcement';
    const { inserted } = await this.messages.createMany(recipients.map((recipientId) => ({
      senderId,
      recipientId,
      kind,
      title: entity.title,
      body: entity.body,
    })));
    return { inserted, scope: entity.scope };
  }
}

export class ListInboxUseCase {
  /** @param {{messages}} deps */
  constructor({ messages }) {
    this.messages = messages;
  }

  async execute({ partnerId, limit = 50 }) {
    return this.messages.inbox(partnerId, Math.min(Math.max(Number(limit) || 50, 1), 100));
  }
}

export class ListSentUseCase {
  /** @param {{messages}} deps */
  constructor({ messages }) {
    this.messages = messages;
  }

  async execute({ partnerId, limit = 50 }) {
    return this.messages.sent(partnerId, Math.min(Math.max(Number(limit) || 50, 1), 100));
  }
}

export class GetThreadUseCase {
  /** @param {{messages, network?, partners?}} deps */
  constructor({ messages, network = null, partners = null }) {
    Object.assign(this, { messages, partners: partners ?? PartnersModel });
  }

  async execute({ partnerId, counterpartId, limit = 100, before = null }) {
    await assertPartnerExists(this.partners, counterpartId);
    return this.messages.thread(partnerId, counterpartId, Math.min(Math.max(Number(limit) || 100, 1), 200), before ?? null);
  }
}

/** Global people search for starting chats (safe fields only). */
export class SearchPeopleUseCase {
  /** @param {{partners}} deps */
  constructor({ partners = null } = {}) {
    this.partners = partners;
  }

  async execute({ q, excludeId = null, limit = 10 }) {
    const query = String(q ?? '').trim();
    if (query.length < 2) return [];
    const store = this.partners ?? PartnersModel;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const docs = await store.find({
      $or: [{ username: rx }, { name: rx }, { surname: rx }],
    }).select('_id username name surname profileImage').limit(Math.min(Math.max(Number(limit) || 10, 1), 25)).lean().catch(() => []);
    return (docs ?? [])
      .filter((d) => String(d._id) !== String(excludeId))
      .map((d) => ({
        id: String(d._id),
        username: d.username,
        name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
        photo: d.profileImage ?? null,
      }));
  }
}

/** Recipients only; idempotent (re-reading is free). */
export class MarkReadUseCase {
  /** @param {{messages}} deps */
  constructor({ messages }) {
    this.messages = messages;
  }

  async execute({ partnerId, messageId }) {
    const found = await this.messages.findById(messageId);
    if (!found) throw new NotFoundException('Message not found');
    if (String(found.recipientId) !== String(partnerId)) {
      throw new ForbiddenException('Only the recipient can mark this read');
    }
    return this.messages.markRead(messageId);
  }
}

export class UnreadCountUseCase {
  /** @param {{messages}} deps */
  constructor({ messages }) {
    this.messages = messages;
  }

  async execute({ partnerId }) {
    return { unread: await this.messages.unreadCount(partnerId) };
  }
}

/** Everyone you may DM: upline chain + direct downline (safe fields). */
export class ListContactsUseCase {
  /** @param {{network}} deps */
  constructor({ network }) {
    this.network = network;
  }

  async execute({ partnerId }) {
    const uplines = [];
    let current = String(partnerId);
    const seen = new Set([current]);
    for (let d = 0; d < 10 && current; d++) {
      const node = await this.network.findNode(current);
      const parent = node?.parentId ? String(node.parentId) : null;
      if (!parent || seen.has(parent)) break;
      seen.add(parent);
      const p = await this.network.findNode(parent);
      if (!p) break;
      uplines.push({ id: p.id, username: p.username, name: [p.name, p.surname].filter(Boolean).join(' ') || p.username, photo: p.profileImage ?? null, relation: 'upline' });
      current = parent;
    }
    const children = await this.network.findChildren([String(partnerId)], 500);
    return [
      ...uplines,
      ...children.map((c) => ({
        id: c.id,
        username: c.username,
        name: [c.name, c.surname].filter(Boolean).join(' ') || c.username,
        photo: c.profileImage ?? null,
        relation: 'downline',
      })),
    ];
  }
}
