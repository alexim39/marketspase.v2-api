import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListAttendeesUseCase, MarkAttendanceUseCase } from './Events.usecases.js';

const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ADMIN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const STRANGER = 'cccccccccccccccccccccccc';
const EVENT = 'dddddddddddddddddddddddd';

const fakeEvents = (event = null, attendees = []) => ({
  async findEventById(id) {
    if (!event || String(event._id ?? event.id) !== String(id)) return null;
    return { ...event };
  },
  async attendees() {
    return attendees.map((a) => ({ ...a }));
  },
  async markAttendance(_eventId, partnerId, attended) {
    const hit = attendees.find((a) => String(a.partnerId) === String(partnerId));
    if (!hit) return null;
    hit.attended = attended === true;
    return { ...hit };
  },
});

const fakePartners = () => ({
  async findById(id) {
    if (String(id) === ADMIN) return { _id: ADMIN, role: 'admin' };
    return { _id: String(id), role: 'user' };
  },
});

const ev = (over = {}) => ({ _id: EVENT, authorId: OWNER, title: 'Saturday Session', ...over });
const row = (over = {}) => ({
  partnerId: 'p1', status: 'going', attended: null, name: 'Ama K',
  username: 'amak', phone: '08030000001', email: 'a@x.test', ...over,
});

describe('ListAttendeesUseCase', () => {
  it('serves the organizer and admins, never strangers', async () => {
    const deps = { events: fakeEvents(ev(), [row()]), partners: fakePartners() };
    const owner = await new ListAttendeesUseCase(deps).execute({ partnerId: OWNER, eventId: EVENT });
    assert.equal(owner.total, 1);
    assert.equal(owner.attendees[0].phone, '08030000001');
    const admin = await new ListAttendeesUseCase(deps).execute({ partnerId: ADMIN, eventId: EVENT });
    assert.equal(admin.total, 1);
    await assert.rejects(
      new ListAttendeesUseCase(deps).execute({ partnerId: STRANGER, eventId: EVENT }),
      /Only the organizer or an admin/,
    );
  });

  it('404s unknown events', async () => {
    await assert.rejects(
      new ListAttendeesUseCase({ events: fakeEvents(null), partners: fakePartners() })
        .execute({ partnerId: OWNER, eventId: EVENT }),
      /not found/i,
    );
  });
});

describe('MarkAttendanceUseCase', () => {
  it('marks turnout on existing RSVPs for organizer and admin', async () => {
    const deps = { events: fakeEvents(ev(), [row()]), partners: fakePartners() };
    const marked = await new MarkAttendanceUseCase(deps)
      .execute({ partnerId: OWNER, eventId: EVENT, attendeeId: 'p1', attended: true });
    assert.equal(marked.attended, true);
    const undone = await new MarkAttendanceUseCase(deps)
      .execute({ partnerId: ADMIN, eventId: EVENT, attendeeId: 'p1', attended: false });
    assert.equal(undone.attended, false);
  });

  it('refuses strangers and walk-ins without an RSVP', async () => {
    const deps = { events: fakeEvents(ev(), [row()]), partners: fakePartners() };
    await assert.rejects(
      new MarkAttendanceUseCase(deps).execute({ partnerId: STRANGER, eventId: EVENT, attendeeId: 'p1', attended: true }),
      /Only the organizer or an admin/,
    );
    await assert.rejects(
      new MarkAttendanceUseCase(deps).execute({ partnerId: OWNER, eventId: EVENT, attendeeId: 'ghost', attended: true }),
      /RSVP first/,
    );
  });
});
