import { exportBasename, isoDate } from '../domain/Export.csv.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { stuckAnalysis } from '../../crm/domain/Prospect.stuck.js';

/**
 * Export use cases return render-neutral datasets
 * ({name, columns, rows, count}) — the interface layer renders CSV/XLSX.
 */

const clampLimit = (limit, def = 1000, max = 5000) =>
  Math.min(Math.max(Number(limit) || def, 1), max);

const displayName = (p) =>
  [p.prospectName, p.prospectSurname].filter(Boolean).join(' ').trim();

const lastContact = (p) => {
  const dates = (p.communications ?? [])
    .map((c) => new Date(c.date ?? c.createdAt ?? 0).getTime())
    .filter((t) => t > 0);
  return dates.length > 0 ? new Date(Math.max(...dates)) : null;
};

/** Full downline roster (directory-safe fields only). */
export class ExportTeamUseCase {
  /** @param {{network}} deps */
  constructor({ network }) {
    this.network = network;
  }

  async execute({ partnerId }) {
    const [{ ids }] = await Promise.all([collectDownlineIds(this.network, partnerId)]);
    const [nodes, direct] = await Promise.all([
      this.network.findNodesByIds(ids),
      this.network.findChildren([String(partnerId)], 500),
    ]);
    const directIds = new Set(direct.map((d) => d.id));
    const columns = [
      { key: 'username', header: 'Username' },
      { header: 'Name', format: (r) => [r.name, r.surname].filter(Boolean).join(' ') },
      { header: 'Direct', format: (r) => (directIds.has(r.id) ? 'Yes' : 'No') },
      { header: 'Plan', format: (r) => r.plan ?? '' },
      { header: 'Joined', format: (r) => isoDate(r.joinedAt) },
    ];
    return { name: exportBasename('team'), columns, rows: nodes, count: nodes.length };
  }
}

/** Own prospect pipeline with engagement signals. */
export class ExportPipelineUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) {
    this.prospects = prospects;
  }

  async execute({ partnerId, limit = 1000 }) {
    const { items } = await this.prospects.findByPartnerId(partnerId, {
      limit: clampLimit(limit), skip: 0,
    });
    const stuckDays = new Map(stuckAnalysis(items).map((s) => [s.prospectId, s.daysInStage]));
    const columns = [
      { header: 'Name', format: displayName },
      { header: 'Phone', format: (p) => p.prospectPhone ?? '' },
      { header: 'Email', format: (p) => p.prospectEmail ?? '' },
      { header: 'Source', format: (p) => p.prospectSource ?? '' },
      { header: 'Stage', format: (p) => p.status?.stage ?? '' },
      { header: 'Status', format: (p) => p.status?.status ?? '' },
      { header: 'Days in stage', format: (p) => stuckDays.get(String(p.id ?? p._id)) ?? '' },
      { header: 'Touches', format: (p) => (p.communications ?? []).length },
      { header: 'Last contact', format: (p) => { const d = lastContact(p); return d ? isoDate(d) : ''; } },
      { header: 'Created', format: (p) => isoDate(p.createdAt) },
    ];
    return { name: exportBasename('pipeline'), columns, rows: items, count: items.length };
  }
}

/** Own commission ledger entries (audit trail shape). */
export class ExportCommissionsUseCase {
  /** @param {{ledger}} deps */
  constructor({ ledger }) {
    this.ledger = ledger;
  }

  async execute({ partnerId, limit = 5000 }) {
    const { items } = await this.ledger.findByEarner(partnerId, { limit: clampLimit(limit, 5000), skip: 0 });
    const columns = [
      { header: 'Entry', format: (e) => e.id ?? '' },
      { header: 'Amount', format: (e) => e.amount ?? '' },
      { header: 'Status', format: (e) => e.status ?? '' },
      { header: 'Cart', format: (e) => (e.cartId ? String(e.cartId) : '') },
      { header: 'Released', format: (e) => isoDate(e.releasedAt) },
      { header: 'Recorded', format: (e) => isoDate(e.createdAt) },
    ];
    return { name: exportBasename('commissions'), columns, rows: items, count: items.length };
  }
}

/** Community engagement digest — summary, posts by kind, top contributors. */
export class ExportCommunityUseCase {
  /** @param {{analytics}} deps (community analytics use case) */
  constructor({ analytics }) {
    this.analytics = analytics;
  }

  async execute({ days = 7 } = {}) {
    const data = await this.analytics.execute({ days });
    const rows = [
      { metric: 'Window (days)', value: data.days },
      { metric: 'Total posts', value: data.posts },
      { metric: 'Total likes', value: data.likes },
      { metric: 'Total comments', value: data.comments },
      { metric: '— Posts by kind —', value: '' },
      ...Object.entries(data.byKind ?? {}).map(([kind, count]) => ({ metric: `  ${kind}`, value: count })),
      { metric: '— Top contributors —', value: '' },
      ...(data.topContributors ?? []).map((c) => ({
        metric: `  ${c.name || c.username || c.id}`,
        value: c.posts,
      })),
    ];
    return {
      name: exportBasename('community'),
      columns: [
        { key: 'metric', header: 'Metric' },
        { key: 'value', header: 'Value' },
      ],
      rows,
      count: rows.length,
    };
  }
}

/** Period reports — own submissions or the direct-downline feed. */
export class ExportReportsUseCase {
  /** @param {{reports, network}} deps */
  constructor({ reports, network }) {
    Object.assign(this, { reports, network });
  }

  async execute({ partnerId, scope = 'mine' }) {
    const rows = scope === 'team'
      ? await this.reports.listByAuthors(
        (await this.network.findChildren([String(partnerId)], 500)).map((c) => c.id), 500,
      )
      : await this.reports.listByAuthor(partnerId, 500);
    const columns = [
      { header: 'Author', format: (r) => r.author?.name ?? '' },
      { key: 'title', header: 'Title' },
      { header: 'Period start', format: (r) => isoDate(r.periodStart) },
      { header: 'Period end', format: (r) => isoDate(r.periodEnd) },
      { key: 'highlights', header: 'Highlights' },
      { key: 'blockers', header: 'Blockers' },
      { key: 'plans', header: 'Plans' },
      { header: 'Submitted', format: (r) => isoDate(r.createdAt) },
    ];
    return { name: exportBasename(`reports-${scope}`), columns, rows, count: rows.length };
  }
}
