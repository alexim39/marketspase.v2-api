import { ValidationException } from '../../../shared/domain/AppError.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { COURSES } from '../../training/domain/Training.catalog.js';

/**
 * Global search — one query across members, prospects, courses, posts.
 * Visibility is enforced per group, never widened for search:
 * - members: public username directory (backs public pages already);
 * - prospects: the requester's own pipeline only;
 * - courses: static catalog (same for everyone);
 * - posts: global scope + own + bounded-downline team posts.
 * Five per group, newest/error-tolerant (a failing group degrades to
 * empty, never fails the whole search).
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
    const [members, prospects, posts] = await Promise.all([
      safe(this.community?.searchDirectory?.(query, 5), []),
      safe(this.prospects?.findByPartnerId?.(partnerId, { limit: 5, q: query }).then((r) => r?.items ?? []), []),
      safe(this.community?.searchPosts?.({ authorIds: authors, q: query, limit: 5 }), []),
    ]);
    const needle = query.toLowerCase();
    const courses = COURSES.filter(
      (c) => c.title.toLowerCase().includes(needle) || c.tagline.toLowerCase().includes(needle),
    )
      .slice(0, 5)
      .map((c) => ({ id: c.id, title: c.title, tagline: c.tagline }));
    return {
      q: query,
      members: (members ?? []).map((m) => ({ username: m.username, name: m.name })),
      prospects: (prospects ?? []).map((p) => ({
        id: String(p.id ?? p._id ?? ''),
        name: [p.prospectName, p.prospectSurname].filter(Boolean).join(' ') || 'Unnamed',
        stage: p?.status?.stage ?? 'New',
      })),
      courses,
      posts: (posts ?? []).map((p) => ({
        id: String(p.id ?? p._id ?? ''),
        title: p.title || String(p.body ?? '').slice(0, 80),
        kind: p.kind ?? 'standard',
      })),
    };
  }
}
