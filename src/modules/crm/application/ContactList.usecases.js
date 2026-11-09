import { LEVEL_LABELS } from '../../progression/domain/Progression.levels.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

/**
 * GET /v1/prospects/activation-board — per-member onboarding board.
 *
 * One light row per downline member: level, confirmed IPO/QSG/SMO stamps and
 * the single next training action. Contact-list submission/workbench was
 * retired, so this board no longer reads or reports warm-list data.
 */
export class ListActivationBoardUseCase {
  /** @param {{network, progress?}} deps */
  constructor({ network, progress = null }) {
    Object.assign(this, { network, progress });
  }

  async execute({ requesterId, limit = 200 }) {
    const { ids, depths } = await collectDownlineIds(this.network, requesterId);
    const bounded = ids.slice(0, 2000);
    if (bounded.length === 0) return { items: [], total: 0 };

    const [nodes, training, levels] = await Promise.all([
      this.network.findNodesByIds(bounded).catch(() => []),
      this.progress?.listConfirmationStats?.(bounded, ['ipo', 'qsg', 'smo']).catch(() => []) ?? [],
      this.progress?.levelsFor?.(bounded).catch(() => ({})) ?? {},
    ]);

    const stamps = new Map();
    for (const t of training ?? []) {
      const k = String(t.partnerId ?? t.id ?? '');
      if (k) stamps.set(k, t);
    }
    const labels = Object.fromEntries((nodes ?? []).map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
    }]));

    const items = bounded.map((id) => {
      const pid = String(id);
      const stamp = stamps.get(pid) ?? {};
      // Gates count confirmed training only (done + upline confirmation).
      const ipoDone = stamp.ipo?.done === true && stamp.ipo?.confirmedAt != null;
      const qsgDone = stamp.qsg?.done === true && stamp.qsg?.confirmedAt != null;
      const smoDone = stamp.smo?.done === true && stamp.smo?.confirmedAt != null;
      const level = levels?.[pid] ?? 'partner';
      const depth = depths?.[pid] ?? 1;

      let nextAction = 'Training complete — support first sale';
      let nextTone = 'ok';
      if (!ipoDone) { nextAction = 'Complete IPO'; nextTone = 'warn'; }
      else if (!qsgDone) { nextAction = 'Complete QSG'; nextTone = 'warn'; }
      else if (!smoDone) { nextAction = 'Complete SMO'; nextTone = 'warn'; }

      return {
        partnerId: pid,
        member: labels[pid] ?? null,
        level,
        levelLabel: LEVEL_LABELS[level] ?? 'Partner',
        depth,
        relation: depth <= 1 ? 'Direct' : `Level ${depth}`,
        ipoDone,
        qsgDone,
        smoDone,
        nextAction,
        nextTone,
      };
    });

    // Needs-training first, then direct/older? Keep a stable, useful order:
    // incomplete IPO first, then QSG, SMO, then complete.
    const rank = (m) => (!m.ipoDone ? 0 : !m.qsgDone ? 1 : !m.smoDone ? 2 : 3);
    items.sort((a, b) => rank(a) - rank(b) || a.depth - b.depth);
    const capped = items.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 500));
    return { items: capped, total: items.length };
  }
}
