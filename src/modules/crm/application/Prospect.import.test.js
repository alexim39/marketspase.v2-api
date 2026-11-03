import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportContactsUseCase } from './Prospect.import.js';

const fakeCreate = ({ dupes = [], failPhones = [] } = {}) => ({
  execute: async (input) => {
    if (!input.prospectName || String(input.prospectName).trim().length < 2) {
      const e = new Error('Invalid prospectName');
      e.name = 'ValidationException';
      throw e;
    }
    if (!input.prospectPhone || String(input.prospectPhone).replace(/\D/g, '').length < 7) {
      const e = new Error('Invalid prospectPhone');
      e.name = 'ValidationException';
      throw e;
    }
    const phone = String(input.prospectPhone);
    if (dupes.includes(phone) || failPhones.includes(phone)) {
      const e = new Error(`You already have a contact with this phone number: Dup (${phone}).`);
      e.name = 'ConflictException';
      throw e;
    }
    return { id: `new-${phone}` };
  },
});

test('imports valid rows and reports the rest', async () => {
  const uc = new ImportContactsUseCase({ create: fakeCreate({ dupes: ['08030000002'] }) });
  const res = await uc.execute({
    partnerId: 'p1',
    rows: [
      { name: 'Ada', surname: 'T', phone: '08030000001', email: 'ada@x.co' },
      { name: 'Obi', phone: '08030000002' },
      { name: 'X', phone: '1' },
      { name: 'Ada Again', phone: '08030000001' },
    ],
  });
  assert.equal(res.inserted, 1);
  assert.equal(res.total, 4);
  assert.equal(res.skipped.length, 3);
  assert.match(res.skipped[0].reason, /already have a contact/);
  assert.match(res.skipped[1].reason, /Invalid/);
  assert.match(res.skipped[2].reason, /within this file/);
});

test('rejects empty and oversized batches', async () => {
  const uc = new ImportContactsUseCase({ create: fakeCreate() });
  await assert.rejects(uc.execute({ partnerId: 'p1', rows: [] }), /Nothing to import/);
  await assert.rejects(
    uc.execute({ partnerId: 'p1', rows: Array.from({ length: 501 }, (_, i) => ({ name: `N${i}`, phone: `0803000${String(i).padStart(4, '0')}` })) }),
    /At most 500/,
  );
  await assert.rejects(uc.execute({ partnerId: 'p1' }), /array/);
});
