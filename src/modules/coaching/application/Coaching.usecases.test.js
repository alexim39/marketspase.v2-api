import test from 'node:test';
import assert from 'node:assert/strict';
import { AddNoteUseCase, GetMyCoachUseCase } from './Coaching.usecases.js';

const network = (nodes) => ({
  async findNode(id) {
    return nodes[String(id)] ?? null;
  },
});

const store = () => {
  const notes = [];
  return {
    notes,
    async addNote(note) {
      const row = { id: `n${notes.length + 1}`, ...note, createdAt: new Date() };
      notes.push(row);
      return row;
    },
  };
};

test('a member can add a note to their own coaching log', async () => {
  const coaching = store();
  const usecase = new AddNoteUseCase({
    coaching,
    network: network({
      m1: { id: 'm1', parentId: 'c1' },
      c1: { id: 'c1', parentId: null },
    }),
  });

  const note = await usecase.execute({ coachId: 'm1', memberId: 'm1', body: 'Discussed pricing today.' });

  assert.equal(note.memberId, 'm1');
  assert.equal(note.coachId, 'c1');
  assert.equal(note.authorId, 'm1');
  assert.equal(coaching.notes.length, 1);
});

test('a member with no upline can still keep a self note', async () => {
  const coaching = store();
  const usecase = new AddNoteUseCase({
    coaching,
    network: network({ m2: { id: 'm2', parentId: null } }),
  });

  const note = await usecase.execute({ coachId: 'm2', memberId: 'm2', body: 'First coaching reflection.' });

  assert.equal(note.memberId, 'm2');
  assert.equal(note.coachId, 'm2');
  assert.equal(note.authorId, 'm2');
});

test('an upline can add a note to a downline member', async () => {
  const coaching = store();
  const usecase = new AddNoteUseCase({
    coaching,
    network: network({
      c1: { id: 'c1', parentId: null },
      m1: { id: 'm1', parentId: 'c1' },
    }),
  });

  const note = await usecase.execute({ coachId: 'c1', memberId: 'm1', body: 'Great progress this week.' });

  assert.equal(note.memberId, 'm1');
  assert.equal(note.coachId, 'c1');
  assert.equal(note.authorId, 'c1');
});

test('a member cannot add a note to another member', async () => {
  const usecase = new AddNoteUseCase({
    coaching: store(),
    network: network({
      m1: { id: 'm1', parentId: 'c1' },
      m2: { id: 'm2', parentId: 'c2' },
    }),
  });

  await assert.rejects(
    usecase.execute({ coachId: 'm1', memberId: 'm2', body: 'Not allowed.' }),
    /Only an upline can coach this member/,
  );
});

test('the coach payload uses the computed progression journey', async () => {
  const usecase = new GetMyCoachUseCase({
    network: network({
      m1: { id: 'm1', name: 'Imenwo', surname: 'Woko', username: 'iwoko', parentId: 'c1' },
      c1: { id: 'c1', name: 'Alex', surname: 'Imenwo', username: 'aimenwo', parentId: null },
    }),
    progression: {
      async execute({ partnerId, readOnly }) {
        assert.equal(partnerId, 'm1');
        assert.equal(readOnly, true);
        return {
          levelLabel: 'Partner',
          nextLabel: 'Builder',
          percent: 40,
          missing: [{ key: 'ipo', label: 'IPO completed', action: 'Finish the IPO course' }],
          remainingActions: [],
        };
      },
    },
    training: null,
  });

  const data = await usecase.execute({ partnerId: 'm1' });

  assert.equal(data.coach.username, 'aimenwo');
  assert.equal(data.journey.nextLabel, 'Builder');
  assert.equal(data.journey.percent, 40);
  assert.equal(data.nextAction, 'Finish the IPO course');
  assert.equal(data.missing[0].key, 'ipo');
});
