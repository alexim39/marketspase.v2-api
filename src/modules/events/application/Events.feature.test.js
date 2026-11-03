import test from 'node:test';
import assert from 'node:assert/strict';
import { FeatureEventUseCase } from './Events.usecases.js';

const NOW = new Date('2026-09-18T12:00:00Z');
const future = new Date(NOW.getTime() + 86400000);
const past = new Date(NOW.getTime() - 86400000);

const event = (over = {}) => ({
  _id: 'ev1',
  authorId: 'author1',
  scope: 'global',
  startsAt: future,
  featured: false,
  featuredUntil: null,
  ...over,
});

const fakes = ({ rows = {}, admin = false, featuredCount = 0 } = {}) => {
  const store = new Map(Object.entries(rows));
  return {
    events: {
      findEventById: async (id) => {
        const r = store.get(String(id));
        return r ? { ...r } : null;
      },
      setFeatured: async (id, featured, until = null) => {
        const r = store.get(String(id));
        const next = { ...r, featured, featuredUntil: featured ? until : null };
        store.set(String(id), next);
        return { ...next };
      },
      countFeatured: async () => featuredCount,
    },
    partners: {
      findById: async (id) => (String(id) === 'admin1' || admin ? { role: 'admin' } : { role: 'user' }),
    },
  };
};

test('author can feature upcoming events, expiry defaults to start', async () => {
  const f = fakes({ rows: { ev1: event() } });
  const out = await new FeatureEventUseCase(f).execute({ partnerId: 'author1', eventId: 'ev1', featured: true, now: NOW });
  assert.equal(out.featured, true);
  assert.equal(new Date(out.featuredUntil).getTime(), future.getTime());
});

test('strangers cannot feature; admins override authorship but not past events', async () => {
  const f = fakes({ rows: { ev1: event() } });
  await assert.rejects(
    new FeatureEventUseCase(f).execute({ partnerId: 'stranger', eventId: 'ev1', featured: true, now: NOW }),
    /author or an admin/,
  );
  const g = fakes({ rows: { ev1: event() }, admin: true });
  const out = await new FeatureEventUseCase(g).execute({ partnerId: 'admin1', eventId: 'ev1', featured: true, now: NOW });
  assert.equal(out.featured, true);
  const h = fakes({ rows: { ev1: event({ startsAt: past }) }, admin: true });
  await assert.rejects(
    new FeatureEventUseCase(h).execute({ partnerId: 'admin1', eventId: 'ev1', featured: true, now: NOW }),
    /upcoming/,
  );
});

test('slot cap blocks a second feature; unfeature always allowed', async () => {
  const f = fakes({ rows: { ev1: event() }, featuredCount: 1 });
  await assert.rejects(
    new FeatureEventUseCase(f).execute({ partnerId: 'author1', eventId: 'ev1', featured: true, now: NOW }),
    /already exists/,
  );
  const g = fakes({ rows: { ev1: event({ featured: true }) }, featuredCount: 1 });
  const out = await new FeatureEventUseCase(g).execute({ partnerId: 'author1', eventId: 'ev1', featured: false, now: NOW });
  assert.equal(out.featured, false);
});
