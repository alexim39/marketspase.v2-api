// Strangler note: reuse the legacy compiled Partner model — same
// collection, projected read-model only (no writes in this slice).
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { toNetworkNode } from '../domain/Network.entity.js';

const project = (doc) => {
  if (!doc) return null;
  const node = toNetworkNode(doc);
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  node.parentId = raw.partnerOf ? String(raw.partnerOf) : null;
  return node;
};

/** Mongo implementation of the network read contracts. All reads `.lean()`. */
export class MongoNetworkRepository {  async findNode(id) {
    return project(await PartnersModel.findById(id).lean());
  }

  async findChildren(parentIds, limit) {
    if (parentIds.length === 0) return [];
    const docs = await PartnersModel.find({ partnerOf: { $in: parentIds } })
      .sort({ username: 1 })
      .limit(Math.max(0, limit * parentIds.length))
      .lean();
    return docs.map(project);
  }

  /** Bulk directory-safe fetch for rosters/exports (capped). */
  async findNodesByIds(ids, limit = 5000) {
    if (ids.length === 0) return [];
    const docs = await PartnersModel.find({ _id: { $in: ids } })
      .sort({ username: 1 })
      .limit(Math.min(Math.max(Number(limit) || 5000, 1), 5000))
      .lean();
    return docs.map(project);
  }

  /** Everyone with ≥1 direct recruit — the snapshot job's work list. */
  async findLeaderIds(limit = 2000) {
    const ids = await PartnersModel.distinct('partnerOf');
    return ids.map(String).filter(Boolean).slice(0, Math.min(Math.max(Number(limit) || 2000, 1), 5000));
  }

  /** Direct-recruit count (progression signals). */
  async countChildren(partnerId) {
    return PartnersModel.countDocuments({ partnerOf: String(partnerId) });
  }

  /** Newest direct recruits for the referral card (bounded). */
  async recentChildren(partnerId, limit = 5) {
    const lim = Math.min(Math.max(Number(limit) || 5, 1), 25);
    const docs = await PartnersModel.find({ partnerOf: String(partnerId) })
      .select('name surname username createdAt')
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();
    return docs.map(project);
  }
}

/**
 * Shared bounded downline-id collection (BFS, depth + cap, cycle-safe).
 * Used by billing performance, goals progress and analytics team health —
 * one implementation, not three copies.
 * @returns {{ids: string[], total: number, capped: boolean, depths: Record<string, number>}}
 * (`depths` maps each id to its distance from the root: 1 = direct recruit.
 * Additive — existing `{ids}` destructuring keeps working.)
 */
export async function collectDownlineIds(networkRepo, rootId, { maxDepth = 10, cap = 5000 } = {}) {  const visited = new Set([String(rootId)]);
  const ids = [];
  const depths = {};
  let capped = false;
  let frontier = [String(rootId)];
  for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
    const children = await networkRepo.findChildren(frontier, 500);
    const fresh = [];
    for (const c of children) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      if (ids.length >= cap) { capped = true; break; }
      ids.push(c.id);
      depths[c.id] = d + 1;
      fresh.push(c.id);
    }
    if (capped) break;
    frontier = fresh;
  }
  return { ids, total: ids.length, capped, depths };
}

/**
 * Ancestor check by walking parent links (bounded, cycle-safe).
 * Authorizes upline-scoped reads: requests, team reports, downline overview.
 */
export async function isAncestor(networkRepo, ancestorId, descendantId, maxDepth = 10) {
  const target = String(ancestorId);
  let current = String(descendantId);
  const seen = new Set([current]);
  for (let d = 0; d < maxDepth && current; d++) {
    const node = await networkRepo.findNode(current);
    const parent = node?.parentId ? String(node.parentId) : null;
    if (!parent) return false;
    if (parent === target) return true;
    if (seen.has(parent)) return false;
    seen.add(parent);
    current = parent;
  }
  return false;
}
