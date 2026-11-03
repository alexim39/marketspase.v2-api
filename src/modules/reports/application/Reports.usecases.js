import {
  ConflictException, ForbiddenException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { createReportEntity, createRequestEntity } from '../domain/Report.entity.js';
import { isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';

/** Downline submits a period report — recipient is always the direct upline. */
export class SubmitReportUseCase {
  /** @param {{reports, network}} deps */
  constructor({ reports, network }) {
    Object.assign(this, { reports, network });
  }

  async execute({ partnerId, requestId, ...input }) {
    const node = await this.network.findNode(partnerId);
    if (!node) throw new NotFoundException('Partner not found');
    if (!node.parentId) throw new ValidationException('No upline found — there is nobody to report to');

    let request = null;
    if (requestId !== undefined && requestId !== null) {
      request = await this.reports.findRequestById(requestId);
      if (!request) throw new NotFoundException('Report request not found');
      if (String(request.downlineId) !== String(partnerId)) {
        throw new ForbiddenException('That request was not asked of you');
      }
      if (request.status !== 'open') throw new ConflictException('That request is already fulfilled');
    }

    const report = await this.reports.createReport({
      ...createReportEntity(input),
      partnerId,
      uplineId: node.parentId,
      requestId: request ? request.id : null,
    });
    if (request) await this.reports.fulfillRequest(request.id, report.id);
    return report;
  }
}

export class ListMyReportsUseCase {
  /** @param {{reports}} deps */
  constructor({ reports }) {
    this.reports = reports;
  }

  async execute({ partnerId, limit = 20 }) {
    return this.reports.listByAuthor(partnerId, Math.min(Math.max(Number(limit) || 20, 1), 100));
  }
}

/** Leader requests a report — only from their own downline (any depth). */
export class RequestReportUseCase {
  /** @param {{reports, network}} deps */
  constructor({ reports, network }) {
    Object.assign(this, { reports, network });
  }

  async execute({ requesterId, downlineId, ...input }) {
    if (String(requesterId) === String(downlineId)) {
      throw new ValidationException('You cannot request a report from yourself');
    }
    const node = await this.network.findNode(downlineId);
    if (!node) throw new NotFoundException('Downline partner not found');
    if (!(await isAncestor(this.network, requesterId, downlineId))) {
      throw new ForbiddenException('You can only request reports from your own downline');
    }
    const entity = createRequestEntity(input);
    const dupe = await this.reports.findOpenRequest(requesterId, downlineId, entity.periodStart, entity.periodEnd);
    if (dupe) throw new ConflictException('An open request already exists for that period');
    return this.reports.createRequest({ ...entity, requesterId, downlineId, status: 'open' });
  }
}

export class ListRequestsUseCase {
  /** @param {{reports}} deps */
  constructor({ reports }) {
    this.reports = reports;
  }

  async execute({ partnerId, box = 'incoming' }) {
    return box === 'outgoing'
      ? this.reports.listOutgoingRequests(partnerId)
      : this.reports.listIncomingRequests(partnerId);
  }
}

/** Leader reads what the direct downline submitted (newest first). */
export class ListTeamReportsUseCase {
  /** @param {{reports, network}} deps */
  constructor({ reports, network }) {
    Object.assign(this, { reports, network });
  }

  async execute({ partnerId, limit = 50 }) {
    const children = await this.network.findChildren([String(partnerId)], 500);
    return this.reports.listByAuthors(
      children.map((c) => c.id),
      Math.min(Math.max(Number(limit) || 50, 1), 100),
    );
  }
}

/** Direct-downline directory for the request form (safe fields only). */
export class ListDownlineUseCase {
  /** @param {{network}} deps */
  constructor({ network }) {
    this.network = network;
  }

  async execute({ partnerId }) {
    const children = await this.network.findChildren([String(partnerId)], 500);
    return children.map((c) => ({
      id: c.id,
      username: c.username,
      name: [c.name, c.surname].filter(Boolean).join(' ') || c.username,
    }));
  }
}
