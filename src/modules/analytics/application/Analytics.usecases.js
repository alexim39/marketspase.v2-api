import { buildFunnel, deltaPct, forecastNext, scoreHealth, windows } from '../domain/Analytics.engine.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';

const clampDays = (days) => Math.min(Math.max(Number(days) || 30, 7), 365);

export class GetFunnelUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) {
    this.prospects = prospects;
  }

  async execute({ partnerId, days = 30, now = new Date() }) {
    const d = clampDays(days);
    const { start, end } = windows(now, d);
    const distribution = await this.prospects.stageDistribution(partnerId, start, end);
    return { days: d, ...buildFunnel(distribution, distribution.Closed ?? 0) };
  }
}

export class GetTeamUseCase {
  /** @param {{orders, network, prospects, goalProgress, snapshots}} deps */
  constructor({ orders, network, prospects, goalProgress, snapshots }) {
    Object.assign(this, { orders, network, prospects, goalProgress, snapshots });
  }

  async execute({ partnerId, days = 30, now = new Date() }) {
    const d = clampDays(days);
    // Nightly snapshot fast path (30-day window only, fresh only).
    if (d === 30 && this.snapshots) {
      const snap = await this.snapshots.findFresh(partnerId, 30);
      if (snap) return this.assemble({ ...snap, source: 'snapshot' }, partnerId, d, now);
    }

    const { start, end, prevStart, prevEnd } = windows(now, d);
    const [{ ids: downline }] = await Promise.all([collectDownlineIds(this.network, partnerId)]);

    const [personal, team, recruits, prevRecruits, prevTeam, active, conversions] = await Promise.all([
      this.orders.volumeBetween(partnerId, start, end),
      this.orders.volumeForBetween(downline, start, end),
      this.orders.recruitsBetween(partnerId, start, end),
      this.orders.recruitsBetween(partnerId, prevStart, prevEnd),
      this.orders.volumeForBetween(downline, prevStart, prevEnd),
      this.orders.activeMemberCount(downline, start, end),
      this.prospects.countConverted(partnerId, start, end),
    ]);

    return this.assemble({
      downlineTotal: downline.length,
      active,
      recruits,
      prevRecruits,
      teamVolume: team.total,
      prevTeamVolume: prevTeam.total,
      personalVolume: personal.total,
      personalOrders: personal.orders,
      conversions,
      source: 'live',
    }, partnerId, d, now);
  }

  /** Shared assembly — goals + funnel stay live (cheap, single-partner). */
  async assemble(m, partnerId, d, now) {
    const { start, end } = windows(now, d);
    const [goals, funnel] = await Promise.all([
      this.goalProgress(partnerId),
      buildFunnel(await this.prospects.stageDistribution(partnerId, start, end)),
    ]);
    const activationRate = m.downlineTotal > 0 ? m.active / m.downlineTotal : null;
    const complete = goals.filter((g) => g.progress?.complete).length;
    const goalRate = goals.length > 0 ? complete / goals.length : null;
    const recruitDelta = deltaPct(m.recruits, m.prevRecruits);
    const teamDelta = deltaPct(m.teamVolume, m.prevTeamVolume);

    const health = scoreHealth({
      activationRate,
      goalRate,
      funnelRate: funnel.overallRate,
      recruitDeltaPct: recruitDelta,
    });

    return {
      days: d,
      source: m.source,
      recruits: { current: m.recruits, previous: m.prevRecruits, deltaPct: recruitDelta },
      teamVolume: { current: m.teamVolume, previous: m.prevTeamVolume, deltaPct: teamDelta },
      personalVolume: { total: m.personalVolume, orders: m.personalOrders },
      downline: {
        total: m.downlineTotal,
        active: m.active,
        inactive: Math.max(0, m.downlineTotal - m.active),
        activationRate,
      },
      conversions: m.conversions,
      goals: { total: goals.length, complete, rate: goalRate },
      health,
      forecast: {
        basis: `at current pace (last ${d}d vs prior ${d}d)`,
        recruitsNext: forecastNext(m.recruits, m.prevRecruits),
        teamVolumeNext: forecastNext(m.teamVolume, m.prevTeamVolume),
      },
    };
  }
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/**
 * Daily Action Center: "what should I do today?" — urgent notifications
 * first, then behind-pace goals, stuck pipeline, ready-to-close prospects,
 * upcoming gatherings, journey milestones, then the rest.
 */
export class GetActionsUseCase {
  /** @param {{feed, goals, prospects, stuck, progression, events, poolCount, reminders}} deps (stuck/progression/events/poolCount/reminders optional) */
  constructor({ feed, goals, prospects, stuck, progression, events, poolCount = null, reminders = null }) {
    Object.assign(this, { feed, goals, prospects, stuck, progression, events, poolCount, reminders });
  }

  async execute({ partnerId, now = new Date(), limit = 15 }) {
    const [feed, goals, hot, stuck, journey, gatherings, poolAvailable, due] = await Promise.all([
      this.feed.execute({ partnerId, now, limit: 50 }),
      this.goals.execute({ partnerId, now }),
      this.prospects.findReadyToConvert(partnerId, 5),
      this.stuck ? this.stuck.execute({ partnerId, now }) : [],
      this.progression ? this.progression.summarize({ partnerId, now }) : null,
      this.events ? this.events.upcomingRsvps(partnerId, now) : [],
      this.poolCount ? this.poolCount(partnerId).catch(() => null) : null,
      this.reminders ? this.reminders.execute({ partnerId, now }).catch(() => null) : null,
    ]);

    const actions = [];
    for (const item of feed.items.filter((i) => i.urgency)) {
      actions.push({
        id: `action:${item.id}`,
        priority: 'high',
        category: item.kind === 'inactive' ? 're-engage' : 'follow-up',
        title: item.title,
        detail: item.body,
        link: item.link,
      });
    }
    for (const g of goals.filter((g) => !g.progress.complete && !g.progress.onTrack)) {
      actions.push({
        id: `action:goal:${g.id}`,
        priority: 'high',
        category: 'goal',
        title: `"${g.title}" is behind pace`,
        detail: `${g.progress.current} of ${g.target} with ${g.progress.daysLeft} days left`,
        link: '/dashboard/goals',
      });
    }
    for (const p of hot) {
      actions.push({
        id: `action:close:${p.id}`,
        priority: 'medium',
        category: 'conversion',
        title: `${p.prospectName ?? 'Prospect'} ${p.prospectSurname ?? ''}`.trim(),
        detail: 'In negotiation — close the loop',
        link: `/dashboard/prospects/detail/${p.id}`,
      });
    }
    for (const s of (stuck ?? []).slice(0, 5)) {
      actions.push({
        id: `action:stuck:${s.prospectId}`,
        priority: s.overBy >= s.limit ? 'high' : 'medium',
        category: 'stuck',
        title: `${s.name} stuck in ${s.stage} (${s.daysInStage}d)`,
        detail: `No movement for ${s.daysInStage} days — threshold is ${s.limit}`,
        link: `/dashboard/prospects/detail/${s.prospectId}`,
      });
    }
    for (const r of (due?.overdue ?? []).slice(0, 5)) {
      actions.push({
        id: `action:reminder:${r.prospectId}`,
        priority: 'high',
        category: 'follow-up',
        title: `Call back ${r.name} — ${r.daysOverdue}d overdue`,
        detail: 'You promised a follow-up — keep the promise',
        link: `/dashboard/prospects/detail/${r.prospectId}`,
      });
    }
    for (const r of (due?.today ?? []).slice(0, 5)) {
      actions.push({
        id: `action:reminder:${r.prospectId}`,
        priority: 'high',
        category: 'follow-up',
        title: `Call back ${r.name} today`,
        detail: 'Follow-up promised for today',
        link: `/dashboard/prospects/detail/${r.prospectId}`,
      });
    }
    for (const g of (gatherings ?? []).slice(0, 3)) {
      const hours = (new Date(g.startsAt).getTime() - new Date(now).getTime()) / 3600000;
      const when = hours < 24 ? 'today' : hours < 48 ? 'tomorrow' : `in ${Math.ceil(hours / 24)} days`;
      actions.push({
        id: `action:event:${g.id}`,
        priority: hours <= 48 ? 'high' : 'medium',
        category: 'event',
        title: `${g.title} — ${when}`,
        detail: `${g.myRsvp === 'going' ? 'You’re going' : 'You’re interested'}${g.location ? ` · ${g.location}` : ''}`,
        link: '/dashboard/community/events',
      });
    }
    for (const item of feed.items.filter((i) => !i.urgency).slice(0, 5)) {
      actions.push({
        id: `action:${item.id}`,
        priority: 'low',
        category: item.kind,
        title: item.title,
        detail: item.body,
        link: item.link,
      });
    }
    if (journey?.promoted) {
      actions.push({
        id: `action:promoted:${journey.promoted.to}`,
        priority: 'high',
        category: 'growth',
        title: `Promoted to ${journey.promoted.to.replace(/_/g, ' ')}`,
        detail: 'Your journey advanced — see what unlocked next',
        link: '/dashboard/progress',
      });
    }
    for (const m of (journey?.missing ?? []).slice(0, 2)) {
      const isTraining = ['ipo', 'qsg', 'smo'].includes(m.key);
      actions.push({
        id: `action:journey:${m.key}`,
        priority: isTraining ? 'high' : 'medium',
        category: isTraining ? 'training-due' : 'growth',
        title: isTraining ? `${m.label} overdue` : m.label,
        detail: isTraining ? `${m.action} — upline confirms` : m.action,
        link: isTraining ? '/dashboard/training' : '/dashboard/progress',
      });
    }
    if (poolAvailable !== null && poolAvailable !== undefined && Number(poolAvailable) > 0) {
      actions.push({
        id: `action:pool:${poolAvailable}`,
        priority: 'medium',
        category: 'recruitment-opportunity',
        title: `${poolAvailable} fresh leads near you`,
        detail: 'Buy Prospect pool has new leads in your state — claim first',
        link: '/dashboard/prospects/general-list',
      });
    }

    actions.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    const lim = Math.min(Math.max(Number(limit) || 15, 1), 50);
    return { actions: actions.slice(0, lim), total: actions.length };
  }
}

const ACTIVATION_WINDOW_DAYS = 7;
const filled = (v) => String(v ?? '').trim().length > 0;
/**
 * Onboarding activation: share of the trailing signup cohort that completed
 * profile + first prospect + IPO within 7 days. Distinct from the team-health
 * `activationRate` (share of downline currently active) — this one measures
 * the signup funnel, per member, with timestamps. Profile completion is
 * current-state (we don't track when it happened) — documented, not hidden.
 */
export class GetActivationUseCase {
  /** @param {{partners, prospects, progress, network}} deps */
  constructor({ partners, prospects, progress, network }) {
    Object.assign(this, { partners, prospects, progress, network });
  }

  async execute({ partnerId, days = 90, now = new Date() }) {
    const d = Math.min(Math.max(Number(days) || 90, 7), 365);
    const t = new Date(now).getTime();
    const since = new Date(t - d * 86400000);
    const { ids } = await collectDownlineIds(this.network, partnerId);
    const bounded = ids.slice(0, 2000);
    const [cohort, firstDates, ipoDates] = await Promise.all([
      this.partners.activationCohort(bounded, since),
      this.prospects.firstProspectDates(bounded),
      this.progress.trainingDates(bounded),
    ]);
    const deadline = (signedUp) => signedUp + ACTIVATION_WINDOW_DAYS * 86400000;
    let activated = 0;
    const legs = { profile: 0, prospect: 0, ipo: 0 };
    const perMember = cohort.rows.map((m) => {
      const signedUp = new Date(m.createdAt).getTime();
      const profileDone = filled(m.phone)
        && filled(m.address?.street) && filled(m.address?.city) && filled(m.address?.state);
      const firstAt = firstDates[m.id] ?? null;
      const prospectAdded = firstAt !== null && firstAt <= deadline(signedUp);
      const ipoAt = ipoDates[m.id] ?? null;
      const ipoDone = ipoAt !== null && ipoAt <= deadline(signedUp);
      if (profileDone) legs.profile += 1;
      if (prospectAdded) legs.prospect += 1;
      if (ipoDone) legs.ipo += 1;
      const done = profileDone && prospectAdded && ipoDone;
      if (done) activated += 1;
      const lastDated = Math.max(firstAt ?? 0, ipoAt ?? 0);
      return {
        partnerId: m.id,
        member: { name: m.name, username: m.username },
        signedUpAt: m.createdAt,
        profileDone,
        prospectAdded,
        ipoDone,
        activated: done,
        daysToActivate: done && lastDated > 0 ? Math.max(0, Math.round((lastDated - signedUp) / 86400000)) : null,
      };
    });
    return {
      days: d,
      cohort: cohort.total,
      capped: cohort.capped,
      activated,
      rate: cohort.total > 0 ? Math.round((activated / cohort.total) * 1000) / 10 : null,
      legs,
      perMember,
    };
  }
}

/**
 * Leadership bench — who is ready for the next rank?
 * Distribution from stored levels + pending confirmation/nomination
 * backlogs as bench pressure. Per-member promotion readiness stays in
 * My Journey (single-member signals); this is the org-wide bench view.
 */
export class GetBenchUseCase {
  /** @param {{progress, network}} deps */
  constructor({ progress, network }) {
    Object.assign(this, { progress, network });
  }

  async execute({ partnerId }) {
    const { ids } = await collectDownlineIds(this.network, partnerId);
    const bounded = ids.slice(0, 2000);
    const [levels, pendingConfirmations, pendingNominations] = await Promise.all([
      this.progress.levelsFor ? this.progress.levelsFor(bounded).catch(() => ({})) : {},
      this.progress.listPendingConfirmations
        ? this.progress.listPendingConfirmations(bounded, ['ipo', 'qsg', 'smo'], 200).catch(() => [])
        : [],
      this.progress.listPendingNominations
        ? this.progress.listPendingNominations(bounded, 100).catch(() => [])
        : [],
    ]);
    const dist = {};
    for (const lvl of Object.values(levels ?? {})) dist[lvl] = (dist[lvl] ?? 0) + 1;
    return {
      total: bounded.length,
      capped: ids.length > bounded.length,
      distribution: dist,
      pendingConfirmations: (pendingConfirmations ?? []).length,
      pendingNominations: (pendingNominations ?? []).length,
      leaders: (dist.ecl ?? 0) + (dist.cell_leader ?? 0) + (dist.g_leader ?? 0) + (dist.g8 ?? 0),
    };
  }
}

/**
 * Org-wide funnel (admin console): all prospects created in-window
 * grouped by current stage, with the same funnel math as member views.
 */
export class GetOrgFunnelUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) {
    this.prospects = prospects;
  }

  async execute({ days = 30, now = new Date() } = {}) {
    const d = clampDays(days);
    const { start, end } = windows(now, d);
    const distribution = await this.prospects.orgStageDistribution(start, end);
    return { days: d, ...buildFunnel(distribution, distribution.Closed ?? 0) };
  }
}

/**
 * Signup-cohort rank retention (admin console): trailing calendar months,
 * each cohort's current stored-level distribution. Bounded per cohort —
 * `capped` flags truncated months. Reads, never writes.
 */
export class GetRetentionUseCase {
  /** @param {{partners, progress}} deps */
  constructor({ partners, progress }) {
    Object.assign(this, { partners, progress });
  }

  async execute({ months = 6, now = new Date() } = {}) {
    const cohorts = await this.partners.signupCohorts(months, 2000, now);
    const out = [];
    for (const cohort of cohorts) {
      const levels = cohort.ids.length > 0 && this.progress?.levelsFor
        ? await this.progress.levelsFor(cohort.ids).catch(() => ({}))
        : {};
      const distribution = {};
      let ranked = 0;
      for (const id of cohort.ids) {
        const lvl = levels[String(id)];
        if (lvl === undefined) continue;
        ranked += 1;
        distribution[lvl] = (distribution[lvl] ?? 0) + 1;
      }
      const advanced = Object.entries(distribution)
        .filter(([lvl]) => !['prospect', 'partner'].includes(lvl))
        .reduce((s, [, n]) => s + n, 0);
      out.push({
        month: cohort.month,
        cohort: cohort.ids.length,
        ranked,
        advanced,
        advancedRate: ranked > 0 ? Math.round((advanced / ranked) * 1000) / 10 : null,
        distribution,
        capped: cohort.capped,
      });
    }
    return { months: out.length, cohorts: out };
  }
}
