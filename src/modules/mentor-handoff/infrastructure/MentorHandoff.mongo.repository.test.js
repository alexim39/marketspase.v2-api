import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { MentorHandoffModel } from './MentorHandoff.models.js';
import { MongoMentorHandoffRepository } from './MentorHandoff.mongo.repository.js';

const mentorId = 'a'.repeat(24);
const handoffId = 'b'.repeat(24);
const partnerId = 'c'.repeat(24);

const restore = [];
const patch = (target, key, value) => {
  restore.push([target, key, target[key]]);
  target[key] = value;
};

const tree = (rows) => ({
  sort() { return this; },
  limit() { return this; },
  select() { return this; },
  async lean() { return rows; },
});

afterEach(() => {
  while (restore.length > 0) {
    const [target, key, value] = restore.pop();
    target[key] = value;
  }
});

describe('MongoMentorHandoffRepository atomic updates', () => {
  it('preserves the first-contact timestamp and treats notes literally', async () => {
    let captured = null;
    patch(MentorHandoffModel, 'findOneAndUpdate', (filter, update, options) => {
      captured = { filter, update, options };
      return { lean: async () => ({ _id: handoffId, note: '$100 deposit' }) };
    });

    const repo = new MongoMentorHandoffRepository();
    const result = await repo.markContacted(handoffId, mentorId, '$100 deposit');

    assert.deepEqual(captured.filter, { _id: handoffId, mentorId });
    assert.equal(captured.options.new, true);
    assert.ok(Array.isArray(captured.update));
    const set = captured.update[0].$set;
    assert.equal(set.status, 'contacted');
    assert.deepEqual(set.firstContactAt, { $ifNull: ['$firstContactAt', set.lastContactAt] });
    assert.deepEqual(set.note, { $literal: '$100 deposit' });
    assert.equal(result.note, '$100 deposit');
  });

  it('records every channel in a pipeline update and keeps first contact', async () => {
    let captured = null;
    patch(MentorHandoffModel, 'findOneAndUpdate', (filter, update, options) => {
      captured = { filter, update, options };
      return { lean: async () => ({ _id: handoffId }) };
    });

    const repo = new MongoMentorHandoffRepository();
    await repo.recordSent(handoffId, mentorId, {
      templateKey: 'welcome_first_step',
      channels: { chat: true, email: false, sms: true },
    });

    const set = captured.update[0].$set;
    assert.deepEqual(set.channels, { chat: true, email: false, sms: true });
    assert.equal(set.templateKey.$literal, 'welcome_first_step');
    assert.deepEqual(set.firstContactAt, { $ifNull: ['$firstContactAt', set.lastContactAt] });
    assert.equal(set.status, 'contacted');
  });

  it('only queues tasks that still need the day-7 check', async () => {
    let captured = null;
    patch(MentorHandoffModel, 'find', (filter) => {
      captured = filter;
      return tree([]);
    });

    const repo = new MongoMentorHandoffRepository();
    const now = new Date('2026-11-12T12:00:00Z');
    await repo.listReminderCandidates(now);

    assert.equal(captured.day7At, null);
    assert.equal(captured.preference.$ne, 'prefer_not_now');
    assert.deepEqual(captured.status.$in, ['pending', 'contacted']);
    assert.deepEqual(captured.joinedAt.$lte, new Date(now.getTime() - (24 * 60 * 60 * 1000)));
  });

  it('updates the partner preference and every matching task together', async () => {
    let partnerUpdate = null;
    let taskUpdate = null;
    patch(PartnersModel, 'updateOne', async (filter, update) => {
      partnerUpdate = { filter, update };
    });
    patch(MentorHandoffModel, 'updateMany', async (filter, update) => {
      taskUpdate = { filter, update };
    });

    const repo = new MongoMentorHandoffRepository();
    const consentAt = new Date('2026-11-12T10:00:00Z');
    await repo.updateMemberPreference(partnerId, 'phone', consentAt);

    assert.deepEqual(partnerUpdate.filter, { _id: partnerId });
    assert.equal(partnerUpdate.update.$set.mentorContactPreference, 'phone');
    assert.deepEqual(partnerUpdate.update.$set.mentorContactConsentAt, consentAt);
    assert.ok(partnerUpdate.update.$set.mentorContactPreferenceUpdatedAt instanceof Date);
    assert.deepEqual(taskUpdate.filter, { partnerId });
    assert.deepEqual(taskUpdate.update.$set, { preference: 'phone', consentAt });
  });

  it('never exposes an email or phone for in-app-only members', async () => {
    const task = {
      _id: handoffId,
      partnerId,
      mentorId,
      source: 'referral',
      status: 'pending',
      preference: 'in_app',
      joinedAt: new Date(),
      channels: { chat: false, email: false, sms: false },
    };
    const member = {
      _id: partnerId,
      name: 'Bola',
      surname: 'Ade',
      username: 'bola',
      email: 'bola@example.com',
      phone: '08030000002',
      accountState: 'member',
    };
    patch(MentorHandoffModel, 'findOne', () => ({ lean: async () => task }));
    patch(PartnersModel, 'findById', () => ({
      select() { return this; },
      async lean() { return member; },
    }));

    const repo = new MongoMentorHandoffRepository();
    const shaped = await repo.findForMentor(handoffId, mentorId);

    assert.equal(shaped.contact.email, undefined);
    assert.equal(shaped.contact.phone, undefined);
    assert.equal(shaped.member.email, undefined);
    assert.equal(shaped.member.phone, undefined);
    assert.equal(shaped.canContact, true);
  });

  it('exposes only the channel the member consented to', async () => {
    const task = {
      _id: handoffId,
      partnerId,
      mentorId,
      source: 'referral',
      status: 'pending',
      preference: 'email',
      joinedAt: new Date(),
      channels: { chat: false, email: false, sms: false },
    };
    const member = {
      _id: partnerId,
      name: 'Bola',
      username: 'bola',
      email: 'bola@example.com',
      phone: '08030000002',
      accountState: 'member',
    };
    patch(MentorHandoffModel, 'findOne', () => ({ lean: async () => task }));
    patch(PartnersModel, 'findById', () => ({
      select() { return this; },
      async lean() { return member; },
    }));

    const repo = new MongoMentorHandoffRepository();
    const shaped = await repo.findForMentor(handoffId, mentorId);

    assert.deepEqual(shaped.contact, { email: 'bola@example.com' });
    assert.equal(shaped.contact.phone, undefined);
  });
});
