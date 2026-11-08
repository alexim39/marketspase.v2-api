import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RANK_GROUP_EVENTS } from '../../messaging/domain/RankGroups.js';
import { DomainEvents } from '../../../shared/events/DomainEvents.js';
import { RankGroupFanoutUseCase, subscribeRankGroupFanout } from './RankGroupFanout.js';

const payload = {
  partnerId: 'p1',
  rank: 'Builder',
  groupId: 'g-builder',
  groupName: 'Builder Circle',
  fromGroupId: 'g-partner',
  fromRank: 'Partner',
  at: '2026-11-08T10:00:00.000Z',
};

describe('RankGroupFanout', () => {
  it('stores a keyed in-app notice that links to the new group', async () => {
    const rows = [];
    const fanout = new RankGroupFanoutUseCase({
      notify: { async execute(input) { rows.push(input); return { id: 'n1' }; } },
    });

    const result = await fanout.execute(payload);

    assert.equal(result.status, 'notified');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipientId, 'p1');
    assert.equal(rows[0].category, 'progression');
    assert.equal(rows[0].title, 'You moved to Builder Circle');
    assert.match(rows[0].body, /from Partner Circle to Builder Circle/);
    assert.equal(rows[0].link, '/dashboard/messages?group=g-builder');
    assert.equal(rows[0].key, 'rank-group:g-builder:2026-11-08T10:00:00.000Z');
  });

  it('welcomes a first-time member without naming a previous group', async () => {
    const rows = [];
    const fanout = new RankGroupFanoutUseCase({
      notify: { async execute(input) { rows.push(input); return { id: 'n2' }; } },
    });

    await fanout.execute({ ...payload, fromGroupId: null, fromRank: null });

    assert.equal(rows[0].title, 'Welcome to Builder Circle');
    assert.match(rows[0].body, /now a member of Builder Circle/);
  });

  it('is idempotent and never throws into the event bus', async () => {
    const fanout = new RankGroupFanoutUseCase({
      notify: { async execute() { return { id: 'n1', deduped: true }; } },
    });
    assert.equal((await fanout.execute(payload)).status, 'deduped');

    const failing = new RankGroupFanoutUseCase({
      notify: { async execute() { throw new Error('db down'); } },
    });
    const result = await failing.execute(payload);
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'db down');
  });

  it('subscribes to the shared rank-group change event', async () => {
    const events = new DomainEvents();
    const rows = [];
    subscribeRankGroupFanout({
      events,
      notify: { async execute(input) { rows.push(input); return { id: 'n3' }; } },
    });

    await events.emit(RANK_GROUP_EVENTS.CHANGED, payload);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipientId, 'p1');
  });
});
