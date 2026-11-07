import test from 'node:test';
import assert from 'node:assert/strict';
import { AddNoteUseCase, GetMyCoachUseCase, ListCoachingInboxUseCase } from './Coaching.usecases.js';

const network = (nodes) => ({
  async findNode(id) {
    return nodes[String(id)] ?? null;
  },
  async findChildren(ids) {
    return Object.values(nodes).filter((n) => ids.map(String).includes(String(n.parentId)));
  },
  async findNodesByIds(ids) {
    return ids.map((id) => nodes[String(id)]).filter(Boolean);
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

test('a member note notifies the coach with a link to the member dossier', async () => {
  const sent = [];
  const usecase = new AddNoteUseCase({
    coaching: store(),
    network: network({
      m1: { id: 'm1', name: 'Imenwo', surname: 'Woko', username: 'iwoko', parentId: 'c1' },
      c1: { id: 'c1', name: 'Alex', surname: 'Imenwo', username: 'aimenwo', parentId: null },
    }),
    notify: { async execute(input) { sent.push(input); return input; } },
  });

  await usecase.execute({ coachId: 'm1', memberId: 'm1', body: 'Need help with pricing.' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipientId, 'c1');
  assert.equal(sent[0].category, 'team');
  assert.equal(sent[0].title, 'Imenwo Woko shared a coaching note');
  assert.equal(sent[0].body, 'Need help with pricing.');
  assert.equal(sent[0].link, '/dashboard/mentorship/partners/my-partners/detail/m1');
});

test('a coach note notifies the member and links to My Coach', async () => {
  const sent = [];
  const usecase = new AddNoteUseCase({
    coaching: store(),
    network: network({
      c1: { id: 'c1', name: 'Alex', surname: 'Imenwo', username: 'aimenwo', parentId: null },
      m1: { id: 'm1', name: 'Imenwo', surname: 'Woko', username: 'iwoko', parentId: 'c1' },
    }),
    notify: { async execute(input) { sent.push(input); return input; } },
  });

  await usecase.execute({ coachId: 'c1', memberId: 'm1', body: 'Focus on follow-ups this week.' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipientId, 'm1');
  assert.equal(sent[0].title, 'Alex Imenwo added a coaching note');
  assert.equal(sent[0].link, '/dashboard/training/coach');
});

test('a self note without an upline does not notify anyone', async () => {
  const sent = [];
  const usecase = new AddNoteUseCase({
    coaching: store(),
    network: network({ m2: { id: 'm2', name: 'Solo', surname: 'Partner', parentId: null } }),
    notify: { async execute(input) { sent.push(input); return input; } },
  });

  await usecase.execute({ coachId: 'm2', memberId: 'm2', body: 'First reflection.' });

  assert.equal(sent.length, 0);
});

test('the coaching inbox returns downline notes with author roles', async () => {
  const seen = [];
  const usecase = new ListCoachingInboxUseCase({
    network: network({
      c1: { id: 'c1', name: 'Alex', surname: 'Imenwo', username: 'aimenwo', parentId: null },
      m1: { id: 'm1', name: 'Imenwo', surname: 'Woko', username: 'iwoko', parentId: 'c1' },
      m2: { id: 'm2', name: 'Bola', surname: 'Ade', username: 'bola', parentId: 'm1' },
      outsider: { id: 'outsider', name: 'No', surname: 'Access', parentId: null },
    }),
    coaching: {
      async listNotesForMembers(ids, limit) {
        seen.push({ ids, limit });
        return [
          { id: 'n1', memberId: 'm1', coachId: 'c1', authorId: 'm1', body: 'Member note', createdAt: new Date() },
          { id: 'n2', memberId: 'm2', coachId: 'm1', authorId: 'm1', body: 'Coach note', createdAt: new Date() },
        ];
      },
    },
  });

  const res = await usecase.execute({ partnerId: 'c1', limit: 20 });

  assert.deepEqual(seen[0].ids.sort(), ['m1', 'm2']);
  assert.equal(seen[0].limit, 20);
  assert.equal(res.teamSize, 2);
  assert.equal(res.notes[0].authorRole, 'member');
  assert.equal(res.notes[0].memberName, 'Imenwo Woko');
  assert.equal(res.notes[1].authorRole, 'coach');
  assert.equal(res.notes[1].memberName, 'Bola Ade');
  assert.equal(res.notes[1].authorName, 'Imenwo Woko');
});

test('a partner without a team gets an empty inbox', async () => {
  const usecase = new ListCoachingInboxUseCase({
    network: network({ solo: { id: 'solo', name: 'Solo', surname: 'Partner', parentId: null } }),
    coaching: { async listNotesForMembers() { throw new Error('must not read notes'); } },
  });

  const res = await usecase.execute({ partnerId: 'solo' });

  assert.deepEqual(res, { notes: [], total: 0, teamSize: 0, capped: false });
});
