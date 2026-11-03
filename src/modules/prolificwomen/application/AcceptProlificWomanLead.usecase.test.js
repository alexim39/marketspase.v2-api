import test from 'node:test';
import assert from 'node:assert/strict';
import { AcceptProlificWomanLeadUseCase } from './AcceptProlificWomanLead.usecase.js';

const lead = {
  id: '6ae2e014c931006d58bdebf4',
  name: 'Amaka Okafor',
  phone: '+2348031234567',
  location: 'Ikeja, Lagos',
  readyToBeMentored: 'yes',
  headOfficeInvite: 'no',
  availability: 'weekends',
  acceptedAt: null,
};

const fakeLeads = (overrides = {}) => ({
  released: false,
  linkedProspectId: null,
  async findById() {
    return { ...lead, ...overrides };
  },
  async claimForAccept() {
    return { ...lead, acceptedAt: new Date() };
  },
  async setProspectId(_id, prospectId) {
    this.linkedProspectId = prospectId;
  },
  async releaseClaim() {
    this.released = true;
  },
});

test('accepts a lead into the caller pipeline with source metadata', async () => {
  const leads = fakeLeads();
  let saved = null;
  const prospects = {
    findOne() {
      return { lean: async () => null };
    },
    async create(payload) {
      saved = payload;
      return { _id: 'prospect-1' };
    },
  };

  const result = await new AcceptProlificWomanLeadUseCase({ leads, prospects }).execute({
    partnerId: 'partner-1',
    leadId: lead.id,
  });

  assert.equal(result.prospectId, 'prospect-1');
  assert.equal(saved.prospectSource, 'Prolific Women');
  assert.equal(saved.prospectPhone, '08031234567');
  assert.equal(saved.partnerId, 'partner-1');
  assert.equal(saved.consentToContact, true);
  assert.match(saved.notes, /Availability: Weekends/);
  assert.equal(leads.linkedProspectId, 'prospect-1');
});

test('rejects a lead already in this caller pipeline', async () => {
  const leads = fakeLeads();
  const prospects = {
    findOne() {
      return { lean: async () => ({ _id: 'existing-prospect' }) };
    },
    async create() {
      throw new Error('should not create');
    },
  };

  await assert.rejects(
    new AcceptProlificWomanLeadUseCase({ leads, prospects }).execute({
      partnerId: 'partner-1',
      leadId: lead.id,
    }),
    /already in your pipeline/,
  );
});

test('rejects a lead already accepted by another user', async () => {
  const leads = fakeLeads({ acceptedAt: new Date('2026-10-29T00:00:00.000Z') });
  const prospects = {
    findOne() {
      return { lean: async () => null };
    },
  };

  await assert.rejects(
    new AcceptProlificWomanLeadUseCase({ leads, prospects }).execute({
      partnerId: 'partner-2',
      leadId: lead.id,
    }),
    /already been accepted/,
  );
});
