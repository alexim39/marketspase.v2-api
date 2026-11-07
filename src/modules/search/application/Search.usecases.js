import mongoose from 'mongoose';
import { ValidationException } from '../../../shared/domain/AppError.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { COURSES } from '../../training/domain/Training.catalog.js';
import { SearchMissModel } from '../infrastructure/SearchMiss.mongo.model.js';

const distance = (a, b) => {
  const s = String(a ?? '').toLowerCase();
  const t = String(b ?? '').toLowerCase();
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const temp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return row[t.length];
};

const fuzzyCourses = (query, limit = 3) => {
  const needle = String(query ?? '').toLowerCase();
  return COURSES
    .map((course) => ({
      course,
      score: Math.min(
        distance(needle, course.title),
        distance(needle, course.tagline ?? ''),
      ),
    }))
    .filter(({ score }) => score <= Math.max(2, Math.floor(needle.length / 4)))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ course }) => ({ id: course.id, title: course.title, tagline: course.tagline }));
};

/**
 * Global search — one query across members, prospects, courses, posts.
 * Visibility is enforced per group, never widened for search:
 * - members: public username directory (backs public pages already);
 * - prospects: the requester's own pipeline only;
 * - courses: static catalog (same for everyone);
 * - posts: global scope + own + bounded-downline team posts.
 *
 * Exact/substring first, then a dropped-word retry, then a small fuzzy
 * course fallback. Zero-result queries are logged for content planning.
 */
export class GetGlobalSearchUseCase {
  /** @param {{network, prospects, community}} deps */
  constructor({ network, prospects, community }) {
    Object.assign(this, { network, prospects, community });
  }

  async execute({ partnerId, q }) {
    const query = String(q ?? '').trim().slice(0, 80);
    if (query.length < 2) throw new ValidationException('Type at least 2 characters to search');
    const safe = (promise, fallback) => Promise.resolve(promise).then((v) => v ?? fallback, () => fallback);
    const [{ ids: downline }] = await Promise.all([
      collectDownlineIds(this.network, partnerId).catch(() => ({ ids: [] })),
    ]);
    const authors = [String(partnerId), ...downline.slice(0, 2000).map(String)];

    const run = async (needle) => {
      const [members, prospects, posts] = await Promise.all([
        safe(this.community?.searchDirectory?.(needle, 5), []),
        safe(this.prospects?.findByPartnerId?.(partnerId, { limit: 5, q: needle }).then((r) => r?.items ?? []), []),
        safe(this.community?.searchPosts?.({ authorIds: authors, q: needle, limit: 5 }), []),
      ]);
      const courses = COURSES.filter(
        (c) => c.title.toLowerCase().includes(needle.toLowerCase())
          || (c.tagline ?? '').toLowerCase().includes(needle.toLowerCase()),
      )
        .slice(0, 5)
        .map((c) => ({ id: c.id, title: c.title, tagline: c.tagline }));
      return { members, prospects, posts, courses };
    };

    let result = await run(query);
    let fallback = 'none';
    const total = () => result.members.length + result.prospects.length + result.posts.length + result.courses.length;

    if (total() === 0 && query.split(/\s+/).length > 1) {
      const shorter = query.split(/\s+/).slice(0, -1).join(' ');
      if (shorter.length >= 2) {
        result = await run(shorter);
        fallback = 'dropped_word';
      }
    }

    if (total() === 0) {
      const courses = fuzzyCourses(query);
      if (courses.length > 0) {
        result = { ...result, courses };
        fallback = 'course_fuzzy';
      }
    }

    if (total() === 0) {
      fallback = 'none';
      if (mongoose.connection?.readyState === 1) {
        void SearchMissModel.create({
          q: query,
          partnerId: partnerId ? String(partnerId) : null,
          groups: { members: 0, prospects: 0, posts: 0, courses: 0 },
        }).catch(() => null);
      }
    }

    return {
      q: query,
      members: (result.members ?? []).map((m) => ({ username: m.username, name: m.name })),
      prospects: (result.prospects ?? []).map((p) => ({
        id: String(p.id ?? p._id ?? ''),
        name: [p.prospectName, p.prospectSurname].filter(Boolean).join(' ') || 'Unnamed',
        stage: p?.status?.stage ?? 'New',
      })),
      courses: result.courses,
      posts: (result.posts ?? []).map((p) => ({
        id: String(p.id ?? p._id ?? ''),
        title: p.title || String(p.body ?? '').slice(0, 80),
        kind: p.kind ?? 'standard',
      })),
      meta: {
        count: total(),
        fallback,
        reason: total() === 0 ? 'no_matches' : 'ok',
        next_action: total() === 0 ? 'try_shorter_query_or_browse_categories' : null,
      },
    };
  }
}
