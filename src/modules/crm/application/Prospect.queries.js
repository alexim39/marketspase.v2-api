import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { PartnerId } from '../domain/Prospect.entity.js';
import { buildProspectNotifications } from '../domain/Prospect.notifications.js';
import { stuckAnalysis } from '../domain/Prospect.stuck.js';
import { bucketFollowUps } from '../domain/Prospect.reminders.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const idOrThrow = (value, field) => {
  const v = String(value ?? '').trim();
  if (!OBJECT_ID_RE.test(v)) throw new ValidationException(`Invalid ${field}`);
  return v;
};

/** GET /v1/prospects/:id */
export class GetProspectByIdUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) { this.prospects = prospects; }
  async execute({ prospectId }) {
    const found = await this.prospects.findById(idOrThrow(prospectId, 'prospectId'));
    if (!found) throw new NotFoundException('Prospect not found');
    return found;
  }
}

/**
 * GET /v1/prospects/by-partner/:partnerId — paginated (legacy: unbounded
 * `find`, a load bomb on large contact lists). Partner-existence 404
 * preserved via read-only PartnerLookup.
 */
export class GetProspectsByPartnerUseCase {
  /** @param {{prospects, partners}} deps */
  constructor({ prospects, partners }) { this.prospects = prospects; this.partners = partners; }
  async execute({ partnerId, limit = 100, skip = 0, q, stage }) {
    const pid = PartnerId.create(partnerId);
    if (!(await this.partners.exists(pid))) throw new NotFoundException('Partner not found');
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const sk = Math.max(Number(skip) || 0, 0);
    const query = { limit: lim, skip: sk };
    if (q) query.q = String(q).trim().slice(0, 80);
    if (stage) query.stage = String(stage).trim();
    return this.prospects.findByPartnerId(pid, query);
  }
}

/**
 * GET /v1/prospects/reminders/mine — follow-up commitments due, bucketed
 * overdue / today / upcoming from each prospect's latest open touch.
 */
export class GetFollowUpRemindersUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) { this.prospects = prospects; }

  async execute({ partnerId, now = new Date() }) {
    const pid = PartnerId.create(partnerId);
    const items = await this.prospects.findDueFollowUps(pid, now, { withinDays: 7, limit: 200 });
    const buckets = bucketFollowUps(items, now);
    return { ...buckets, total: buckets.overdue.length + buckets.today.length + buckets.upcoming.length };
  }
}

/** GET /v1/prospects/notifications/:partnerId — ported util, now an endpoint. */
export class GetProspectNotificationsUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) { this.prospects = prospects; }
  async execute({ partnerId, now }) {
    const pid = PartnerId.create(partnerId);
    const { items } = await this.prospects.findByPartnerId(pid, { limit: 500, skip: 0 });
    return buildProspectNotifications(items, now);
  }
}

/**
 * GET /v1/prospects/stuck/:partnerId — prospects sitting in a stage past
 * its attention threshold, worst first. `days` overrides every threshold.
 */
export class GetStuckProspectsUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) { this.prospects = prospects; }
  async execute({ partnerId, days, now = new Date() }) {
    const pid = PartnerId.create(partnerId);
    const { items } = await this.prospects.findByPartnerId(pid, { limit: 500, skip: 0 });
    let d;
    if (days !== undefined && days !== null) {
      const num = Number(days);
      if (!Number.isFinite(num) || num < 1) throw new ValidationException('Invalid days');
      d = Math.min(num, 365);
    }
    return stuckAnalysis(items, { now, days: d });
  }
}
