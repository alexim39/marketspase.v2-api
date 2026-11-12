import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MENTOR_CONTACT_PREFERENCES,
  MENTOR_HANDOFF_TEMPLATES,
  findMentorHandoffTemplate,
  renderMentorHandoffTemplate,
} from '../domain/MentorHandoff.domain.js';
import {
  ListMentorHandoffTemplatesUseCase,
  MarkMentorHandoffContactedUseCase,
  SendMentorHandoffIntroUseCase,
  UpdateMentorContactPreferenceUseCase,
} from './MentorHandoff.usecases.js';

const mentorId = 'a'.repeat(24);
const memberId = 'b'.repeat(24);
const handoffId = 'c'.repeat(24);

const mentor = {
  _id: mentorId,
  name: 'Ada',
  surname: 'Obi',
  username: 'ada',
  email: 'ada@example.com',
  phone: '08030000001',
};

const member = {
  _id: memberId,
  name: 'Bola',
  surname: 'Ade',
  username: 'bola',
  email: 'bola@example.com',
  phone: '08030000002',
};

const task = {
  id: handoffId,
  partnerId: memberId,
  mentorId,
  preference: 'in_app',
  member: { id: memberId, name: 'Bola Ade' },
  contact: {},
  canContact: true,
};

const makePartners = (rows = [mentor, member]) => {
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return { findById: async (id) => byId.get(String(id)) ?? null };
};

const makeSend = ({ taskOverrides = {}, partners = makePartners() } = {}) => {
  const calls = { messages: [], mail: [], sms: [], recorded: [] };
  const updated = { ...task, ...taskOverrides, status: 'contacted', sentAt: new Date() };
  const useCase = new SendMentorHandoffIntroUseCase({
    handoffs: {
      findForMentor: async (id, ownerId) => (
        String(id) === handoffId && String(ownerId) === mentorId ? { ...task, ...taskOverrides } : null
      ),
      recordSent: async (id, ownerId, input) => {
        calls.recorded.push({ id, ownerId, input });
        return { ...updated, channels: input.channels, templateKey: input.templateKey };
      },
    },
    partners,
    messages: {
      create: async (input) => {
        calls.messages.push(input);
        return { id: 'message-1' };
      },
    },
    mail: async (to, subject, html) => {
      calls.mail.push({ to, subject, html });
      return { sent: true };
    },
    sms: {
      send: async (input) => {
        calls.sms.push(input);
        return { providerId: 'sms-1' };
      },
    },
  });
  return { useCase, calls };
};

describe('mentor handoff playbook', () => {
  it('ships exactly five approved welcome messages', () => {
    assert.equal(MENTOR_HANDOFF_TEMPLATES.length, 5);
    assert.deepEqual(
      MENTOR_HANDOFF_TEMPLATES.map((template) => template.key),
      ['welcome_first_step', 'quick_checkin', 'activation_help', 'first_week_plan', 'no_pressure_call'],
    );
    assert.equal(findMentorHandoffTemplate('quick_checkin')?.key, 'quick_checkin');
    assert.equal(findMentorHandoffTemplate('free_form'), null);
  });

  it('renders member and mentor names without leaving placeholders', () => {
    const template = findMentorHandoffTemplate('welcome_first_step');
    const text = renderMentorHandoffTemplate(template, {
      memberName: 'Bola Ade',
      mentorName: 'Ada Obi',
    });
    assert.match(text, /Bola Ade/);
    assert.match(text, /Ada Obi/);
    assert.doesNotMatch(text, /\{\{\w+\}\}/);
  });

  it('lists templates with their full approved copy', () => {
    const rows = new ListMentorHandoffTemplatesUseCase().execute();
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.body && row.subject && row.label));
  });

  it('sends one approved intro by Chat, email and SMS', async () => {
    const { useCase, calls } = makeSend();

    const result = await useCase.execute({
      mentorId,
      handoffId,
      templateKey: 'welcome_first_step',
    });

    assert.equal(calls.messages.length, 1);
    assert.equal(calls.messages[0].senderId, mentorId);
    assert.equal(calls.messages[0].recipientId, memberId);
    assert.equal(calls.messages[0].kind, 'direct');
    assert.match(calls.messages[0].body, /Bola Ade/);
    assert.match(calls.messages[0].body, /\/dashboard\/messages\?chat=/);

    assert.equal(calls.mail.length, 1);
    assert.equal(calls.mail[0].to, 'bola@example.com');
    assert.match(calls.mail[0].subject, /Welcome to the team/);
    assert.match(calls.mail[0].html, /Reply in MarketSpase Chat/);

    assert.equal(calls.sms.length, 1);
    assert.equal(calls.sms[0].to, '08030000002');
    assert.match(calls.sms[0].body, /Bola Ade/);

    assert.deepEqual(result.channels, { chat: true, email: true, sms: true });
    assert.equal(calls.recorded.length, 1);
    assert.equal(calls.recorded[0].input.templateKey, 'welcome_first_step');
    assert.equal(result.handoff.status, 'contacted');
  });

  it('never sends to a member who chose prefer_not_now', async () => {
    const { useCase, calls } = makeSend({ taskOverrides: { preference: 'prefer_not_now' } });

    await assert.rejects(
      () => useCase.execute({ mentorId, handoffId, templateKey: 'quick_checkin' }),
      (error) => error.statusCode === 403 && /not to be contacted/.test(error.message),
    );
    assert.equal(calls.messages.length, 0);
    assert.equal(calls.mail.length, 0);
    assert.equal(calls.sms.length, 0);
    assert.equal(calls.recorded.length, 0);
  });

  it('rejects free-form messages and unknown tasks', async () => {
    const { useCase } = makeSend();

    await assert.rejects(
      () => useCase.execute({ mentorId, handoffId, templateKey: 'my_own_words' }),
      (error) => error.statusCode === 400 && /approved messages/.test(error.message),
    );
    await assert.rejects(
      () => useCase.execute({ mentorId, handoffId: 'not-an-id', templateKey: 'quick_checkin' }),
      (error) => error.statusCode === 400 && /Invalid handoff/.test(error.message),
    );

    const useCaseWithoutTask = makeSend().useCase;
    await assert.rejects(
      () => useCaseWithoutTask.execute({ mentorId: 'd'.repeat(24), handoffId, templateKey: 'quick_checkin' }),
      (error) => error.statusCode === 404,
    );
  });

  it('records channel receipts even when email or SMS fails', async () => {
    const { calls } = makeSend();
    const useCase = new SendMentorHandoffIntroUseCase({
      handoffs: {
        findForMentor: async () => ({ ...task }),
        recordSent: async (id, ownerId, input) => {
          calls.recorded.push({ id, ownerId, input });
          return { ...task, ...input };
        },
      },
      partners: makePartners(),
      messages: { create: async () => ({ id: 'message-1' }) },
      mail: async () => { throw new Error('smtp down'); },
      sms: { send: async () => { throw new Error('sms down'); } },
    });

    const result = await useCase.execute({ mentorId, handoffId, templateKey: 'quick_checkin' });

    assert.deepEqual(result.channels, { chat: true, email: false, sms: false });
    assert.equal(calls.recorded[0].input.channels.email, false);
    assert.equal(calls.recorded[0].input.channels.sms, false);
  });

  it('does not claim SMS delivery when the provider is disabled', async () => {
    const { calls } = makeSend();
    const useCase = new SendMentorHandoffIntroUseCase({
      handoffs: {
        findForMentor: async () => ({ ...task }),
        recordSent: async (id, ownerId, input) => {
          calls.recorded.push({ id, ownerId, input });
          return { ...task, ...input };
        },
      },
      partners: makePartners(),
      messages: { create: async () => ({ id: 'message-1' }) },
      mail: async () => ({ sent: true }),
      sms: { send: async () => ({ logged: true }) },
    });

    const result = await useCase.execute({ mentorId, handoffId, templateKey: 'quick_checkin' });

    assert.deepEqual(result.channels, { chat: true, email: true, sms: false });
  });

  it('marks a task contacted only for its own mentor', async () => {
    const useCase = new MarkMentorHandoffContactedUseCase({
      handoffs: {
        markContacted: async (id, ownerId, note) => (
          String(ownerId) === mentorId ? { ...task, status: 'contacted', note } : null
        ),
      },
    });

    const updated = await useCase.execute({ mentorId, handoffId, note: 'Called after work' });
    assert.equal(updated.status, 'contacted');
    assert.equal(updated.note, 'Called after work');

    await assert.rejects(
      () => useCase.execute({ mentorId: 'd'.repeat(24), handoffId }),
      (error) => error.statusCode === 404,
    );
  });
});

describe('mentor contact preference', () => {
  const makePreference = (partner = member) => {
    const calls = [];
    const useCase = new UpdateMentorContactPreferenceUseCase({
      handoffs: {
        updateMemberPreference: async (partnerId, preference, consentAt) => {
          calls.push({ partnerId, preference, consentAt });
          return { preference, consentAt };
        },
      },
      partners: makePartners([partner]),
    });
    return { useCase, calls };
  };

  it('accepts every supported preference', () => {
    assert.deepEqual(MENTOR_CONTACT_PREFERENCES, [
      'in_app', 'email', 'whatsapp', 'phone', 'prefer_not_now',
    ]);
  });

  it('requires consent before sharing an off-platform channel', async () => {
    const { useCase, calls } = makePreference();

    await assert.rejects(
      () => useCase.execute({ partnerId: memberId, preference: 'whatsapp', consent: false }),
      (error) => error.statusCode === 400 && /Agree to share/.test(error.message),
    );
    assert.equal(calls.length, 0);

    const saved = await useCase.execute({ partnerId: memberId, preference: 'whatsapp', consent: true });
    assert.equal(saved.preference, 'whatsapp');
    assert.ok(calls[0].consentAt instanceof Date);
  });

  it('records no consent timestamp for in-app or prefer-not-now', async () => {
    const { useCase, calls } = makePreference();

    await useCase.execute({ partnerId: memberId, preference: 'in_app' });
    await useCase.execute({ partnerId: memberId, preference: 'prefer_not_now' });

    assert.equal(calls[0].consentAt, null);
    assert.equal(calls[1].consentAt, null);
  });

  it('refuses a channel the member cannot receive', async () => {
    const noPhone = makePreference({ ...member, phone: '' });
    await assert.rejects(
      () => noPhone.useCase.execute({ partnerId: memberId, preference: 'phone', consent: true }),
      (error) => error.statusCode === 400 && /phone number/.test(error.message),
    );

    const noEmail = makePreference({ ...member, email: '' });
    await assert.rejects(
      () => noEmail.useCase.execute({ partnerId: memberId, preference: 'email', consent: true }),
      (error) => error.statusCode === 400 && /email address/.test(error.message),
    );
  });

  it('rejects an unknown preference and an unknown partner', async () => {
    const { useCase } = makePreference();
    await assert.rejects(
      () => useCase.execute({ partnerId: memberId, preference: 'fax' }),
      (error) => error.statusCode === 400,
    );

    const missing = new UpdateMentorContactPreferenceUseCase({
      handoffs: { updateMemberPreference: async () => null },
      partners: { findById: async () => null },
    });
    await assert.rejects(
      () => missing.execute({ partnerId: memberId, preference: 'in_app' }),
      (error) => error.statusCode === 404,
    );
  });
});
