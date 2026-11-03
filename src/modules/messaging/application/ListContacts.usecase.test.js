import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListContactsUseCase } from './Messaging.usecases.js';

const node = (over = {}) => ({
  id: 'node-1',
  username: 'teammate1',
  name: 'Tea',
  surname: 'Mate',
  profileImage: null,
  parentId: null,
  ...over,
});

describe('ListContactsUseCase', () => {
  it('passes profile photos through for avatars', async () => {
    const uc = new ListContactsUseCase({
      network: {
        async findNode(id) {
          if (id === 'me') return node({ id: 'me', username: 'me' });
          return null;
        },
        async findChildren() {
          return [node({ profileImage: 'uploads/pic.png' })];
        },
      },
    });
    const rows = await uc.execute({ partnerId: 'me' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].photo, 'uploads/pic.png');
  });

  it('falls back to null when a node has no photo', async () => {
    const uc = new ListContactsUseCase({
      network: {
        async findNode(id) {
          if (id === 'me') return node({ id: 'me', username: 'me' });
          if (id === 'up') return node({ id: 'up', username: 'coach' });
          return null;
        },
        async findChildren() { return []; },
      },
    });
    // upline chain: me -> up (parent), up has no parent
    const network = {
      async findNode(id) {
        if (id === 'me') return { ...node({ id: 'me' }), parentId: 'up' };
        if (id === 'up') return { ...node({ id: 'up', username: 'coach' }), parentId: null };
        return null;
      },
      async findChildren() { return []; },
    };
    const rows = await new ListContactsUseCase({ network }).execute({ partnerId: 'me' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relation, 'upline');
    assert.equal(rows[0].photo, null);
  });
});
