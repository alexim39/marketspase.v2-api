import {
  ConflictException, ForbiddenException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { LEVELS, LEVEL_LABELS, RANK, STALE_CONFIRM_MS, TRAINING_CONFIRM_KEYS, CONFIRMABLE_KEYS, confirmed, forecastJourney, medianOf, normalizeLevel, resolveProgression } from '../domain/Progression.levels.js';
import { PROGRESSION_EVENTS, promotedPayload } from '../domain/ProgressionEvents.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

const DAY = 86400000;

/**
 * Live signals from source aggregates (never stored).
 * Bounded: downline BFS is depth- + cap-limited like everywhere else.
 * Leadership legs (`prospects`, `community`, `events`, `reports`) are
 * optional — absent deps degrade to zero (skills gate unmet, never a
 * crash), so old constructions and unit fakes keep working.
 */
export async function assembleSignals(
  partnerId,
  { network, orders, progress, prospects, community, eventStore, reports },
  now = new Date(),
) {
  const end = new Date(now);
  const start30 = new Date(end.getTime() - 30 * DAY);
  const start60 = new Date(end.getTime() - 60 * DAY);
  const start90 = new Date(end.getTime() - 90 * DAY);
  const safe = (promise, fallback) => Promise.resolve(promise).then((v) => v ?? fallback, () => fallback);
  const [{ ids: downline }] = await Promise.all([collectDownlineIds(network, partnerId)]);
  const [recruits, cur, prev, active, levels, touched, posts, rsvps, authored, decisions, pendingRows] = await Promise.all([
    network.countChildren(partnerId),
    orders.volumeBetween(partnerId, start30, end),
    orders.volumeBetween(partnerId, start60, start30),
    orders.activeMemberCount(downline, start30, end),
    progress.levelsFor(downline.slice(0, 2000)),
    safe(prospects?.countTouchedSince?.(partnerId, start30), 0),
    safe(community?.countPostsByAuthorSince?.(partnerId, start30), 0),
    safe(eventStore?.countRsvpsSince?.(partnerId, start90), 0),
    safe(reports?.listByAuthor?.(partnerId, 50), []),
    safe(progress.decisionsByApprover?.(partnerId, start90), []),
    safe(progress.listPendingConfirmations?.(downline.slice(0, 2000), CONFIRMABLE_KEYS, 200), []),
  ]);
  const counts = {};
  for (const lvl of Object.values(levels ?? {})) {
    const key = normalizeLevel(lvl);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const reportsSubmitted = (authored ?? []).filter((r) => {
    const t = new Date(r.createdAt ?? 0).getTime();
    return !Number.isNaN(t) && t >= end.getTime() - 60 * DAY;
  }).length;
  // Responsiveness: own decision latencies plus stale backlog among direct
  // reports only (parentId match — deeper uplines own deeper members).
  const decisionLatencies = (decisions ?? [])
    .map((d) => new Date(d.confirmedAt).getTime() - new Date(d.at).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  let directStale = 0;
  if ((pendingRows ?? []).length > 0 && network?.findNodesByIds) {
    try {
      const nodes = await network.findNodesByIds(pendingRows.map((r) => r.partnerId));
      const parents = Object.fromEntries(nodes.map((nd) => [String(nd.id), nd.parentId ? String(nd.parentId) : null]));
      for (const r of pendingRows) {
        if (parents[String(r.partnerId)] !== String(partnerId)) continue;
        for (const k of CONFIRMABLE_KEYS) {
          const s = r[k];
          if (s?.done === true && !s.confirmedAt && end.getTime() - new Date(s.at ?? end).getTime() > STALE_CONFIRM_MS) {
            directStale += 1;
          }
        }
      }
    } catch { /* responsiveness degrades to observed decisions only */ }
  }
  const responsiveMedian = medianOf(decisionLatencies);
  return {
    recruits,
    activeDownline: active,
    downlineTotal: downline.length,
    maintenanceOk: cur.total > 0 && prev.total > 0,
    downlineLeaders: (counts.leader ?? 0) + (counts.ambassador ?? 0),
    downlineBuilders: counts.builder ?? 0,
    touchedProspects: touched,
    communityPosts: posts,
    eventRsvps: rsvps,
    reportsSubmitted,
    responsive: { medianMs: responsiveMedian, decided: decisionLatencies.length, directStale },
  };
}

const STAMPS = ['ipo', 'qsg', 'smo', 'fullTime', 'office', 'onboardingSession', 'qualifiedConfirmed', 'appointment', 'maintenance'];

const toMilestones = (doc = {}) => {
  const m = {};
  for (const k of STAMPS) if (doc[k] !== undefined) m[k] = doc[k];
  if (doc.accounts !== undefined) m.accounts = doc.accounts;
  if (doc.maintenance !== undefined && m.maintenance === undefined) m.maintenance = doc.maintenance;
  if (doc.officeAddress !== undefined) m.officeAddress = doc.officeAddress;
  if (doc.appointedBy !== undefined) m.appointedBy = doc.appointedBy;
  return m;
};

/** Parse + validate a milestone patch (keys outside the whitelist are dropped). */
export const buildMilestonePatch = (input = {}) => {
  const patch = {};
  for (const k of STAMPS) {
    // maintenance carries evidence (ref/month) — handled in the dedicated
    // block below with dotted $sets, never a whole-object overwrite.
    if (k === 'maintenance') continue;
    if (input[k] === undefined) continue;
    const done = input[k]?.done ?? input[k];
    if (typeof done !== 'boolean') throw new ValidationException(`Invalid ${k}`);
    patch[k] = { done, at: done ? new Date() : null };
  }
  if (input.accounts !== undefined) {
    const raw = typeof input.accounts === 'object' && input.accounts !== null ? input.accounts : { count: input.accounts };
    const count = Number(raw.count ?? 0);
    if (!Number.isInteger(count) || count < 0 || count > 1000) throw new ValidationException('Invalid accounts');
    const refs = Array.isArray(raw.refs)
      ? raw.refs.map((r) => String(r ?? '').trim().slice(0, 100)).filter(Boolean).slice(0, 10)
      : [];
    const maintenanceRef = String(raw.maintenanceRef ?? '').trim().slice(0, 100);
    const maintenanceMonth = String(raw.maintenanceMonth ?? '').trim().slice(0, 7);
    if (maintenanceMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(maintenanceMonth)) throw new ValidationException('Invalid maintenance month (YYYY-MM)');
    if (count >= 1 && refs.length === 0) throw new ValidationException('At least one DTC account reference is required as evidence');
    patch['accounts.count'] = count;
    patch['accounts.refs'] = refs;
    patch['accounts.maintenanceRef'] = maintenanceRef;
    patch['accounts.maintenanceMonth'] = maintenanceMonth;
    // Submitting evidence (re)opens the confirmation — upline must verify.
    patch['accounts.done'] = count >= 1;
    patch['accounts.at'] = count >= 1 ? new Date() : null;
    patch['accounts.confirmedBy'] = null;
    patch['accounts.confirmedAt'] = null;
  }
  if (input.maintenance !== undefined) {
    const raw = typeof input.maintenance === 'object' && input.maintenance !== null ? input.maintenance : { done: input.maintenance };
    const done = raw.done ?? (raw.ref ? true : false);
    if (typeof done !== 'boolean') throw new ValidationException('Invalid maintenance');
    const ref = String(raw.ref ?? '').trim().slice(0, 100);
    const month = String(raw.month ?? '').trim().slice(0, 7);
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationException('Invalid maintenance month (YYYY-MM)');
    if (done === true && !ref) throw new ValidationException('DTC receipt / order reference is required as evidence');
    patch['maintenance.done'] = done;
    patch['maintenance.at'] = done ? new Date() : null;
    patch['maintenance.ref'] = done ? ref : '';
    patch['maintenance.month'] = done ? month : '';
    patch['maintenance.confirmedBy'] = null;
    patch['maintenance.confirmedAt'] = null;
  }
  if (input.officeAddress !== undefined) {
    const addr = String(input.officeAddress ?? '').trim().slice(0, 200);
    patch.officeAddress = addr;
  }
  // Office without an address is incomplete — the upline needs somewhere
  // to verify. Enforced here so the gate never sees a bare self-tap.
  if (patch.office?.done === true) {
    const addr = String(input.officeAddress ?? input.office?.address ?? '').trim();
    if (!addr) throw new ValidationException('Office address is required to register an office');
    patch.officeAddress = addr.slice(0, 200);
  }
  if (Object.keys(patch).length === 0) throw new ValidationException('Nothing to update');
  return patch;
};

/** My journey: derived level, next gate, promotion detection (recognition hook). */
export class GetMyProgressionUseCase {
  /** @param {{progress, network, orders, recognition, events?, prospects?, community?, eventStore?, reports?}} deps (recognition optional - auto-posts promotions; events optional - promotion fan-out) */
  constructor({
    progress, network, orders, recognition, events = null,
    prospects = null, community = null, eventStore = null, reports = null,
  }) {
    Object.assign(this, {
      progress, network, orders, recognition, events,
      prospects, community, eventStore, reports,
    });
  }

  async execute({ partnerId, now = new Date(), readOnly = false }) {
    const doc = await this.progress.ensure(partnerId);
    const signals = await assembleSignals(partnerId, this, now);
    const resolved = resolveProgression(signals, toMilestones(doc), doc.level ?? 'partner');
    let promoted = null;
    // Read-only coaching reads (upline/admin viewing a member) never
    // mutate the ladder, post recognition, or fan out events.
    const currentLevel = normalizeLevel(doc.level ?? 'partner');
    if (!readOnly && RANK(resolved.level) > RANK(currentLevel)) {
      const from = currentLevel;
      await this.progress.setLevel(partnerId, resolved.level);
      promoted = { from, to: resolved.level };
      // Community recognition — best-effort, never fails the read.
      if (this.recognition) {
        try {
          const node = await this.network.findNode(partnerId);
          const name = node
            ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
            : 'A partner';
          await this.recognition.promotion(partnerId, from, resolved.level, name);
        } catch { /* recognition is celebratory, not critical */ }
      }
      // Promotion fan-out (member + upline notified) — best-effort, never fails the read.
      if (this.events) {
        try {
          const node = await this.network?.findNode?.(partnerId).catch(() => null);
          const name = node
            ? [node.name, node.surname].filter(Boolean).join(' ') || node.username
            : null;
          await this.events.emit(
            PROGRESSION_EVENTS.PROMOTED,
            promotedPayload({
              partnerId,
              from,
              to: resolved.level,
              toLabel: LEVEL_LABELS[resolved.level] ?? resolved.level,
              memberName: name,
              uplineId: node?.parentId ?? null,
            }),
          ).catch(() => null);
        } catch { /* fan-out is celebratory, not critical */ }
      }
    }
    // Journey forecast — 30d recruit pace, best-effort, never fails the read.
    let forecast = null;
    try {
      const end = new Date(now);
      const start30 = new Date(end.getTime() - 30 * DAY);
      const pace = typeof this.orders?.recruitsBetween === 'function'
        ? await this.orders.recruitsBetween(partnerId, start30, end).catch(() => null)
        : null;
      forecast = forecastJourney(signals, resolved.missing, pace, now);
    } catch { forecast = null; }
    return {
      level: resolved.level,
      levelLabel: LEVEL_LABELS[resolved.level],
      next: resolved.next,
      nextLabel: resolved.next ? LEVEL_LABELS[resolved.next] : null,
      percent: resolved.percent,
      completed: resolved.completed,
      missing: resolved.missing,
      remainingActions: resolved.remainingActions,
      milestones: toMilestones(doc),
      signals: { recruits: signals.recruits, activeDownline: signals.activeDownline, maintenanceOk: signals.maintenanceOk },
      promoted,
      forecast,
    };
  }

  /** Slim summary for the Action Center (no extra queries beyond GetMine). */
  async summarize({ partnerId, now = new Date() }) {
    const full = await this.execute({ partnerId, now });
    return {
      level: full.level, next: full.next, missing: full.missing.slice(0, 2),
      promoted: full.promoted, forecast: full.forecast ?? null,
    };
  }
}

export class UpdateMilestonesUseCase {
  /** @param {{progress}} deps */
  constructor({ progress }) {
    this.progress = progress;
  }

  async execute({ partnerId, patch }) {
    const built = buildMilestonePatch(patch);
    const keys = Object.keys(built).map((k) => k.split('.')[0]);
    // IPO/QSG/SMO are verified by the course certificate itself. Record them
    // as confirmed in the same write so no upline action is required.
    const now = new Date();
    for (const key of TRAINING_CONFIRM_KEYS) {
      if (built[key]?.done === true) {
        built[key] = { ...built[key], confirmedAt: now, confirmedBy: null };
      }
    }
    const doc = await this.progress.upsertMilestones(partnerId, built, {
      at: now,
      by: partnerId,
      key: keys.join(','),
    });
    return { milestones: toMilestones(doc) };
  }
}

/** Leadership pipeline: stored levels across the bounded downline. */
export class TeamDistributionUseCase {
  /** @param {{progress, network}} deps */
  constructor({ progress, network }) {
    Object.assign(this, { progress, network });
  }

  async execute({ partnerId }) {
    const { ids } = await collectDownlineIds(this.network, partnerId);
    const bounded = ids.slice(0, 2000);
    const levels = await this.progress.levelsFor(bounded);
    const dist = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    const byId = levels ?? {};
    let counted = 0;
    for (const id of bounded) {
      const lvl = byId[String(id)];
      if (lvl !== undefined) {
        counted += 1;
        dist[normalizeLevel(lvl)] += 1;
      }
    }
    // Members with no progression row yet are brand-new Partners (the
    // stored default) — previously they vanished while `total` counted
    // them, so the bars never summed to the headline.
    dist.partner += bounded.length - counted;
    return {
      total: bounded.length,
      capped: ids.length > bounded.length,
      distribution: dist,
      leaders: (dist.leader ?? 0) + (dist.ambassador ?? 0),
    };
  }
}
