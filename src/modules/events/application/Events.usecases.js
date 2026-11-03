import { ConflictException, ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { LEADERSHIP_LEVELS, assertRsvpStatus, createEventEntity } from '../domain/Event.entity.js';
import { lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';
import { TeamModel } from '../../../apps/teams/models/teams.model.js';

const pageOf = (limit, max = 50) => Math.min(Math.max(Number(limit) || 20, 1), max);

async function viewerLevel(progress, viewerId) {
  if (!progress?.levelsFor) return null;
  const map = await progress.levelsFor([String(viewerId)]);
  return map[String(viewerId)] ?? null;
}

async function visible(event, viewerId, viewerIsLeader, { network }) {
  if (String(event.authorId) === String(viewerId)) return true;
  if (event.scope === 'global') return true;
  if (event.scope === 'team') return isAncestor(network, event.authorId, viewerId);
  if (event.scope === 'leadership') return viewerIsLeader;
  if (event.scope === 'members') return isTeamMember(event.teamId, viewerId);
  return false;
}

/** Purpose-team visibility: author, owner or listed member. */
async function isTeamMember(teamId, viewerId) {
  if (!teamId || !viewerId) return false;
  const team = await TeamModel.findById(teamId).select('partnerId members').lean().catch(() => null);
  if (!team) return false;
  const me = String(viewerId);
  return String(team.partnerId) === me || (team.members ?? []).map(String).includes(me);
}

async function enrich(events, viewerId, store) {
  const ids = events.map((e) => e.id);
  const [counts, mine, authors, commentCounts] = await Promise.all([
    store.rsvpCounts(ids),
    store.myRsvps(ids, viewerId),
    store.authorLabels(events.map((e) => e.authorId)),
    typeof store.commentCounts === 'function' ? store.commentCounts(ids) : {},
  ]);
  return events.map((e) => ({
    ...e,
    author: authors[e.authorId] ?? null,
    rsvps: counts[e.id] ?? { going: 0, interested: 0, declined: 0, total: 0 },
    myRsvp: mine[e.id] ?? null,
    commentCount: commentCounts[String(e.id)] ?? 0,
  }));
}

export class CreateEventUseCase {
  /** @param {{events}} deps */
  constructor({ events }) {
    this.events = events;
  }

  async execute({ authorId, ...input }) {
    const entity = createEventEntity(input);
    // Team events are writable by owners and members alike.
    if (entity.scope === 'members' && !(await isTeamMember(entity.teamId, authorId))) {
      throw new ForbiddenException('Only team owners and members can create team events');
    }
    return this.events.createEvent({ ...entity, authorId });
  }
}

export class ListUpcomingUseCase {
  /** @param {{events, network, progress}} deps */
  constructor({ events, network, progress }) {
    Object.assign(this, { events, network, progress });
  }

  async execute({ viewerId, limit = 20, now = new Date() }) {
    const lim = pageOf(limit);
    const level = await viewerLevel(this.progress, viewerId);
    const viewerIsLeader = LEADERSHIP_LEVELS.includes(level);
    // Over-fetch, then visibility-filter (team checks walk the chain).
    const candidates = await this.events.upcomingCandidates(now, lim * 3 + 10);
    const t = new Date(now).getTime();
    // Expired featured flags drop back into date order (in-memory; the
    // writer clears them on next feature/unfeature, no sweep job needed).
    for (const e of candidates) {
      if (e.featured && e.featuredUntil && new Date(e.featuredUntil).getTime() <= t) e.featured = false;
    }
    const seen = [];
    for (const event of candidates) {
      if (seen.length >= lim) break;
      // eslint-disable-next-line no-await-in-loop
      if (await visible(event, viewerId, viewerIsLeader, this)) seen.push(event);
    }
    return { items: await enrich(seen, viewerId, this.events), viewerLevel: level };
  }
}

export class ListMyEventsUseCase {
  /** @param {{events}} deps */
  constructor({ events }) {
    this.events = events;
  }

  async execute({ authorId, limit = 50 }) {
    const rows = await this.events.listByAuthor(authorId, pageOf(limit, 200));
    return { items: await enrich(rows, authorId, this.events), total: rows.length };
  }
}

export class GetEventUseCase {
  /** @param {{events, network, progress}} deps (visibility-checked) */
  constructor({ events, network, progress }) {
    Object.assign(this, { events, network, progress });
  }

  async execute({ partnerId, eventId }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(event, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot view this event');
    }
    const [enriched] = await enrich([event], partnerId, this.events);
    return enriched;
  }
}

export class RsvpUseCase {
  /** @param {{events, network, progress}} deps (visibility-checked) */
  constructor({ events, network, progress }) {
    Object.assign(this, { events, network, progress });
  }

  async execute({ partnerId, eventId, status }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(event, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot RSVP to this event');
    }
    const rsvp = await this.events.upsertRsvp(eventId, partnerId, assertRsvpStatus(status));
    const counts = await this.events.rsvpCounts([eventId]);
    return { rsvp, counts: counts[eventId] ?? counts[String(eventId)] ?? { going: 0, interested: 0, declined: 0, total: 0 } };
  }
}

/** Authors edit their own events (full entity re-validated, RSVPs kept). */
export class UpdateEventUseCase {
  /** @param {{events}} deps */
  constructor({ events }) {
    this.events = events;
  }

  async execute({ partnerId, eventId, ...input }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (String(event.authorId) !== String(partnerId)) {
      throw new ForbiddenException('Only the author can edit');
    }
    const entity = createEventEntity(input);
    if (entity.scope === 'members' && !(await isTeamMember(entity.teamId, partnerId))) {
      throw new ForbiddenException('Only team owners and members can keep team events');
    }
    return this.events.updateEvent(eventId, entity);
  }
}

/** Authors cancel their own events (RSVPs cascade in the store). */
export class CancelEventUseCase {
  /** @param {{events}} deps */  constructor({ events }) {
    this.events = events;
  }

  async execute({ partnerId, eventId }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (String(event.authorId) !== String(partnerId)) {
      throw new ForbiddenException('Only the author can cancel');
    }
    return this.events.deleteEvent(eventId);
  }
}

/**
 * Event discussion — comments + one-level replies. No likes by design:
 * RSVP (going/interested/declined) is the engagement signal on events.
 * Visibility matches the event itself; authors see directory-safe labels.
 */
export class ListEventCommentsUseCase {
  /** @param {{events, network, progress}} deps (visibility-checked) */
  constructor({ events, network, progress }) {
    Object.assign(this, { events, network, progress });
  }

  async execute({ partnerId, eventId, limit = 100 }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(event, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot view this event');
    }
    const rows = await this.events.listComments(eventId, limit);
    const authors = await this.events.authorLabels(rows.map((r) => r.authorId));
    return rows.map((r) => ({ ...r, author: authors[r.authorId] ?? null }));
  }
}

export class AddEventCommentUseCase {
  /** @param {{events, network, progress}} deps (visibility-checked) */
  constructor({ events, network, progress }) {
    Object.assign(this, { events, network, progress });
  }

  async execute({ partnerId, eventId, body, parentId = null }) {
    const text = String(body ?? '').trim();
    if (!text) throw new ValidationException('Comment cannot be empty');
    if (text.length > 1000) throw new ValidationException('Comment is too long (max 1000 characters)');
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(event, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot comment on this event');
    }
    let parent = null;
    if (parentId) {
      parent = await this.events.findComment(eventId, parentId);
      if (!parent) throw new NotFoundException('Reply target not found in this event');
      if (parent.parentId) throw new ValidationException('Replies nest one level deep — reply to the top comment');
    }
    const row = await this.events.addComment({
      eventId, authorId: partnerId, body: text, parentId: parent ? String(parent.id ?? parent._id) : null,
    });
    const authors = await this.events.authorLabels([String(partnerId)]);
    return { ...row, author: authors[String(partnerId)] ?? null };
  }
}

export class DeleteEventCommentUseCase {
  /** @param {{events}} deps (comment author or event author may delete) */
  constructor({ events }) {
    this.events = events;
  }

  async execute({ partnerId, eventId, commentId }) {
    const [comment, event] = await Promise.all([
      this.events.findComment(eventId, commentId),
      this.events.findEventById(eventId),
    ]);
    if (!comment) throw new NotFoundException('Comment not found');
    const mine = String(comment.authorId) === String(partnerId);
    const eventMine = event && String(event.authorId) === String(partnerId);
    if (!mine && !eventMine) throw new ForbiddenException('Only the author or event host can delete');
    return this.events.deleteComment(eventId, commentId);
  }
}

/**
 * Featured slot — one highlighted event atop the page per scope.
 * Author or admin; past events can't feature; expiry defaults to the
 * event start (no stale highlights). Cancelling the event frees the slot
 * (the row is gone).
 */
export class FeatureEventUseCase {
  /** @param {{events, partners?}} deps (partners resolves admin override) */
  constructor({ events, partners = null }) {
    Object.assign(this, { events, partners });
  }

  async execute({ partnerId, eventId, featured, featuredUntil = null, now = new Date() }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const want = featured === true;
    const mine = String(event.authorId) === String(partnerId);
    if (!mine && !(await this.isAdmin(partnerId))) {
      throw new ForbiddenException('Only the author or an admin can feature');
    }
    if (!want) return this.events.setFeatured(eventId, false);
    if (new Date(event.startsAt).getTime() <= new Date(now).getTime()) {
      throw new ValidationException('Only upcoming events can be featured');
    }
    let until = event.startsAt;
    if (featuredUntil !== null && featuredUntil !== undefined && String(featuredUntil).trim() !== '') {
      until = new Date(featuredUntil);
      if (Number.isNaN(until.getTime())) throw new ValidationException('Invalid feature expiry');
      if (until.getTime() <= new Date(now).getTime()) throw new ValidationException('Feature expiry must be in the future');
    }
    const taken = await this.events.countFeatured(event.scope, eventId, now).catch(() => 0);
    if (taken >= 1) throw new ConflictException('A featured event already exists — unfeature it first');
    return this.events.setFeatured(eventId, true, until);
  }

  async isAdmin(partnerId) {
    if (!this.partners?.findById) return false;
    try {
      const me = await this.partners.findById(partnerId).catch(() => null);
      const row = me && typeof me.lean === 'function' ? await me.lean().catch(() => me) : me;
      return lenientRole(row?.role) === 'admin';
    } catch {
      return false;
    }
  }
}

/**
 * Organizer attendee list — going/interested rows with contact fields for
 * reminders, the checklist and no-show nudges. Author or admin: attendee
 * phones are PII and never ride the public counts.
 */
export class ListAttendeesUseCase {
  /** @param {{events, partners?}} deps (partners resolves admin override) */
  constructor({ events, partners = null }) {
    Object.assign(this, { events, partners });
  }

  async execute({ partnerId, eventId, limit = 200 }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const mine = String(event.authorId) === String(partnerId);
    if (!mine && !(await this.isAdmin(partnerId))) {
      throw new ForbiddenException('Only the organizer or an admin can view attendees');
    }
    const attendees = await this.events.attendees(eventId, limit);
    return { event: { id: String(event.id ?? eventId), title: event.title, startsAt: event.startsAt }, attendees, total: attendees.length };
  }

  async isAdmin(partnerId) {
    if (!this.partners?.findById) return false;
    try {
      const me = await this.partners.findById(partnerId).catch(() => null);
      const row = me && typeof me.lean === 'function' ? await me.lean().catch(() => me) : me;
      return lenientRole(row?.role) === 'admin';
    } catch {
      return false;
    }
  }
}

/**
 * Organizer marks turnout on an existing RSVP (walk-ins RSVP first —
 * one tap in the same UI). Author or admin.
 */
export class MarkAttendanceUseCase {
  /** @param {{events, partners?}} deps (partners resolves admin override) */
  constructor({ events, partners = null }) {
    Object.assign(this, { events, partners });
  }

  async execute({ partnerId, eventId, attendeeId, attended }) {
    const event = await this.events.findEventById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const mine = String(event.authorId) === String(partnerId);
    if (!mine && !(await this.isAdmin(partnerId))) {
      throw new ForbiddenException('Only the organizer or an admin can mark attendance');
    }
    const row = await this.events.markAttendance(eventId, attendeeId, attended === true);
    if (!row) throw new NotFoundException('RSVP not found — they should RSVP first');
    return row;
  }

  async isAdmin(partnerId) {
    if (!this.partners?.findById) return false;
    try {
      const me = await this.partners.findById(partnerId).catch(() => null);
      const row = me && typeof me.lean === 'function' ? await me.lean().catch(() => me) : me;
      return lenientRole(row?.role) === 'admin';
    } catch {
      return false;
    }
  }
}
