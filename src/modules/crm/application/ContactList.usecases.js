import { LEVEL_LABELS } from '../../progression/domain/Progression.levels.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { MentorCheckinRepository } from '../infrastructure/MentorCheckin.model.js';
import { MentorBonusModel } from '../../compensation/infrastructure/Compensation.models.js';

const hasText = (value) => String(value ?? '').trim().length > 0;

const dayDiff = (from, now) => {
  const start = new Date(from ?? now).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((new Date(now).getTime() - start) / 86400000));
};

/**
 * GET /v1/prospects/activation-board — per-member onboarding board with the
 * mentor playbook: first-7-days tasks, check-in cadence, at-risk flag and
 * mentor-bonus readiness. Visibility stays downline-only.
 */
export class ListActivationBoardUseCase {
  /** @param {{network, progress?, partners?, checkins?, bonuses?}} deps */
  constructor({
    network,
    progress = null,
    partners = new MongoPartnerRepository(),
    checkins = new MentorCheckinRepository(),
    bonuses = MentorBonusModel,
  }) {
    Object.assign(this, { network, progress, partners, checkins, bonuses });
  }

  async execute({ requesterId, limit = 200 }) {
    const { ids, depths } = await collectDownlineIds(this.network, requesterId);
    const bounded = ids.slice(0, 2000);
    if (bounded.length === 0) return { items: [], total: 0 };

    const [nodes, training, levels, snapshots, checkinRows] = await Promise.all([
      this.network.findNodesByIds(bounded).catch(() => []),
      this.progress?.listConfirmationStats?.(bounded, ['ipo', 'qsg', 'smo']).catch(() => []) ?? [],
      this.progress?.levelsFor?.(bounded).catch(() => ({})) ?? {},
      this.partners?.findPlaybookSnapshots?.(bounded).catch(() => []) ?? [],
      this.checkins?.listForMentor?.(requesterId, bounded).catch(() => []) ?? [],
    ]);

    const bonusRows = this.bonuses?.find
      ? await this.bonuses.find({ activationPartnerId: { $in: bounded }, mentorId: requesterId })
        .select('activationPartnerId amount status dueAt')
        .lean()
        .catch(() => [])
      : [];

    const stamps = new Map();
    for (const t of training ?? []) {
      const k = String(t.partnerId ?? t.id ?? '');
      if (k) stamps.set(k, t);
    }
    const labels = Object.fromEntries((nodes ?? []).map((nd) => [String(nd.id), {
      username: nd.username,
      name: [nd.name, nd.surname].filter(Boolean).join(' ') || nd.username,
      joinedAt: nd.joinedAt ?? null,
    }]));
    const snapshotMap = new Map((snapshots ?? []).map((s) => [String(s.id), s]));
    const checkinsByMember = new Map();
    for (const row of checkinRows ?? []) {
      const key = String(row.memberId);
      if (!checkinsByMember.has(key)) checkinsByMember.set(key, []);
      checkinsByMember.get(key).push(row);
    }
    const bonusByMember = new Map((bonusRows ?? []).map((row) => [String(row.activationPartnerId), row]));
    const now = new Date();

    const items = bounded.map((id) => {
      const pid = String(id);
      const stamp = stamps.get(pid) ?? {};
      // Gates count confirmed training only (done + upline confirmation).
      const ipoDone = stamp.ipo?.done === true && stamp.ipo?.confirmedAt != null;
      const qsgDone = stamp.qsg?.done === true && stamp.qsg?.confirmedAt != null;
      const smoDone = stamp.smo?.done === true && stamp.smo?.confirmedAt != null;
      const level = levels?.[pid] ?? 'partner';
      const depth = depths?.[pid] ?? 1;
      const snapshot = snapshotMap.get(pid) ?? {};
      const joinedAt = labels[pid]?.joinedAt ?? snapshot.createdAt ?? null;
      const daysSinceJoin = dayDiff(joinedAt, now);
      const profileDone = hasText(snapshot.phone)
        && hasText(snapshot.address?.street)
        && hasText(snapshot.address?.city)
        && hasText(snapshot.address?.state);
      const memberCheckins = checkinsByMember.get(pid) ?? [];
      const checkinKinds = new Set(memberCheckins.map((row) => row.kind));
      const lastCheckInAt = memberCheckins.length > 0
        ? memberCheckins[memberCheckins.length - 1].createdAt
        : null;

      let nextAction = 'Training complete — support first sale';
      let nextTone = 'ok';
      if (!ipoDone) { nextAction = 'Complete IPO'; nextTone = 'warn'; }
      else if (!qsgDone) { nextAction = 'Complete QSG'; nextTone = 'warn'; }
      else if (!smoDone) { nextAction = 'Complete SMO'; nextTone = 'warn'; }

      const tasks = [
        { key: 'profile', label: 'Profile and contact details complete', done: profileDone },
        { key: 'ipo', label: 'IPO confirmed', done: ipoDone },
        { key: 'qsg', label: 'QSG confirmed', done: qsgDone },
        { key: 'smo', label: 'SMO confirmed', done: smoDone },
        { key: 'checkin', label: 'First mentor check-in logged', done: memberCheckins.length > 0 },
      ];
      const completed = tasks.filter((task) => task.done).length;
      const nextTask = tasks.find((task) => !task.done) ?? null;

      let nextCheckInKind = null;
      let nextCheckInDueAt = null;
      if (!checkinKinds.has('welcome')) {
        nextCheckInKind = 'welcome';
        nextCheckInDueAt = joinedAt;
      } else if (!checkinKinds.has('day3') && daysSinceJoin >= 3) {
        nextCheckInKind = 'day3';
        nextCheckInDueAt = new Date(new Date(joinedAt).getTime() + 3 * 86400000).toISOString();
      } else if (!checkinKinds.has('day7') && daysSinceJoin >= 7) {
        nextCheckInKind = 'day7';
        nextCheckInDueAt = new Date(new Date(joinedAt).getTime() + 7 * 86400000).toISOString();
      }

      const trainingComplete = ipoDone && qsgDone && smoDone;
      const atRisk = !trainingComplete && (
        daysSinceJoin >= 7
        || (daysSinceJoin >= 3 && !profileDone)
        || (daysSinceJoin >= 3 && memberCheckins.length === 0)
      );
      const bonus = bonusByMember.get(pid) ?? null;

      return {
        partnerId: pid,
        member: labels[pid] ? { username: labels[pid].username, name: labels[pid].name } : null,
        level,
        levelLabel: LEVEL_LABELS[level] ?? 'Partner',
        depth,
        relation: depth <= 1 ? 'Direct' : `Level ${depth}`,
        joinedAt,
        daysSinceJoin,
        ipoDone,
        qsgDone,
        smoDone,
        nextAction,
        nextTone,
        playbook: {
          tasks,
          completed,
          total: tasks.length,
          percent: Math.round((completed / tasks.length) * 100),
          nextTask,
          atRisk,
          checkins: {
            count: memberCheckins.length,
            kinds: [...checkinKinds],
            lastAt: lastCheckInAt,
            nextKind: nextCheckInKind,
            nextDueAt: nextCheckInDueAt,
          },
          mentorBonus: bonus ? {
            amount: Number(bonus.amount ?? 0),
            status: bonus.status,
            dueAt: bonus.dueAt ?? null,
          } : null,
        },
      };
    });

    // At-risk first, then the existing training urgency order.
    const rank = (m) => (!m.ipoDone ? 0 : !m.qsgDone ? 1 : !m.smoDone ? 2 : 3);
    items.sort((a, b) => (
      Number(b.playbook.atRisk) - Number(a.playbook.atRisk)
      || rank(a) - rank(b)
      || a.depth - b.depth
    ));
    const capped = items.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 500));
    return { items: capped, total: items.length };
  }
}
