import { NotFoundException } from '../../../shared/domain/AppError.js';
import { MAX_CHILDREN_PER_NODE, clampDepth } from '../domain/Network.entity.js';

/**
 * Downline tree — iterative BFS, one query per level. Cycle-safe via a
 * visited set (corrupt `partnerOf` loops can't hang the request) and
 * bounded via depth cap + per-node child limit with `truncated` flags.
 */
export class GetDownlineTreeUseCase {
  /** @param {{network}} deps */
  constructor({ network }) {
    this.network = network;
  }

  async execute({ partnerId, depth }) {
    const maxDepth = clampDepth(depth);
    const root = await this.network.findNode(partnerId);
    if (!root) throw new NotFoundException('Partner not found');

    const visited = new Set([root.id]);
    const rootNode = { ...root, children: [], childCount: 0, truncated: false };
    let frontier = [rootNode];
    let total = 1;
    let truncatedAny = false;
    const perLevel = [1];

    for (let level = 0; level < maxDepth && frontier.length > 0; level++) {
      const parentIds = frontier.map((n) => n.id);
      const children = await this.network.findChildren(parentIds, MAX_CHILDREN_PER_NODE + 1);
      const byParent = new Map(parentIds.map((id) => [id, []]));
      for (const child of children) {
        if (visited.has(child.id)) continue; // cycle guard
        visited.add(child.id);
        if (byParent.has(child.parentId)) byParent.get(child.parentId).push(child);
      }
      const next = [];
      for (const node of frontier) {
        const kids = (byParent.get(node.id) ?? []).sort((a, b) =>
          String(a.username).localeCompare(String(b.username)),
        );
        node.childCount = kids.length > MAX_CHILDREN_PER_NODE ? MAX_CHILDREN_PER_NODE : kids.length;
        if (kids.length > MAX_CHILDREN_PER_NODE) {
          node.truncated = true;
          truncatedAny = true;
        }
        node.children = kids.slice(0, MAX_CHILDREN_PER_NODE).map((k) => ({
          ...k,
          children: [],
          childCount: 0,
          truncated: false,
        }));
        total += node.children.length;
        next.push(...node.children);
      }
      perLevel.push(next.length);
      frontier = next;
    }

    if (frontier.length > 0) truncatedAny = true; // depth cap cut deeper levels

    return {
      tree: rootNode,
      meta: { depth: maxDepth, total, perLevel, truncated: truncatedAny },
    };
  }
}

/** Upline chain — walk `partnerOf` to the root, cycle-guarded. */
export class GetUplineChainUseCase {
  /** @param {{network}} deps */
  constructor({ network }) {
    this.network = network;
  }

  async execute({ partnerId }) {
    const start = await this.network.findNode(partnerId);
    if (!start) throw new NotFoundException('Partner not found');
    const chain = [];
    const visited = new Set([start.id]);
    let currentParentId = start.parentId;
    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      const node = await this.network.findNode(currentParentId);
      if (!node) break;
      const { parentId: _up, ...projected } = node;
      chain.push(projected);
      currentParentId = node.parentId;
    }
    return { chain, depth: chain.length };
  }
}

/**
 * Bulk presence — `lastSeenAt` per id for people the requester may see.
 * Visible = self + downline + upline chain (+ everything for admins).
 * Out-of-scope ids resolve null (no existence oracle); capped at 100 ids.
 */
export class GetPresenceUseCase {
  /** @param {{network, partners, isAdmin, downlineIds}} deps
   * (`partners.findPresence(ids) -> [{id, lastSeenAt}]`, `isAdmin(id)`,
   * `downlineIds(id) -> {ids}`) */
  constructor({ network, partners, isAdmin, downlineIds }) {
    Object.assign(this, { network, partners, isAdmin, downlineIds });
  }

  async execute({ requesterId, ids }) {
    const clean = [...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((v) => String(v ?? '').trim())
        .filter((v) => /^[a-fA-F0-9]{24}$/.test(v)),
    )].slice(0, 100);
    if (clean.length === 0) return { presence: {} };
    const admin = this.isAdmin
      ? await this.isAdmin(requesterId).catch(() => false)
      : false;
    let visible = null;
    if (!admin) {
      const [downline, requester] = await Promise.all([
        this.downlineIds ? this.downlineIds(requesterId).catch(() => ({ ids: [] })) : { ids: [] },
        this.network.findNode(requesterId).catch(() => null),
      ]);
      visible = new Set([String(requesterId)]);
      for (const id of downline?.ids ?? []) visible.add(String(id));
      let current = requester?.parentId ? String(requester.parentId) : null;
      const seen = new Set([String(requesterId)]);
      for (let d = 0; d < 12 && current && !seen.has(current); d++) {
        seen.add(current);
        visible.add(current);
        const node = await this.network.findNode(current).catch(() => null);
        current = node?.parentId ? String(node.parentId) : null;
      }
    }
    const wanted = admin ? clean : clean.filter((id) => visible.has(id));
    const rows = wanted.length > 0
      ? await this.partners.findPresence(wanted).catch(() => [])
      : [];
    const byId = new Map((rows ?? []).map((r) => [String(r.id ?? r._id), r.lastSeenAt ?? null]));
    return {
      presence: Object.fromEntries(clean.map((id) => [
        id,
        byId.has(id) ? (byId.get(id) ? new Date(byId.get(id)).toISOString() : null) : null,
      ])),
    };
  }
}
