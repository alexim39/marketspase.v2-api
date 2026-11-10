import { domainEvents } from '../../../shared/events/DomainEvents.js';
import { MongoCompensationRepository } from '../infrastructure/Compensation.mongo.repository.js';
import { PROGRESSION_EVENTS } from '../../progression/domain/ProgressionEvents.js';
import {
  CancelActivationCompensationUseCase,
  RecordActivationCompensationUseCase,
  RecordAllocationCompensationUseCase,
  SyncCommissionRankUseCase,
} from './Compensation.usecases.js';

const safe = (label, fn) => async (payload) => {
  try {
    return await fn(payload);
  } catch (error) {
    console.error(`[compensation] ${label} failed:`, error?.message ?? error);
    return null;
  }
};

export const buildCompensationHandlers = ({ repo }) => {
  const activation = new RecordActivationCompensationUseCase({ repo });
  const allocation = new RecordAllocationCompensationUseCase({ repo });
  const cancel = new CancelActivationCompensationUseCase({ repo });
  const syncRank = new SyncCommissionRankUseCase({ repo });

  const rankSync = (label) => safe(label, (payload) => syncRank.execute({
    partnerId: payload?.partnerId,
    from: payload?.from ?? null,
    to: payload?.to,
    source: 'auto',
    reason: payload?.toLabel
      ? `Journey rank changed to ${payload.toLabel}`
      : `Journey rank changed to ${payload?.to ?? 'next rank'}`,
    now: new Date(),
  }));

  return {
    activated: safe('activation', (payload) => activation.execute({
      orderId: payload?.orderId,
      partnerId: payload?.partnerId,
      orderNumber: payload?.orderNumber,
      productName: payload?.productName,
      grossMargin: payload?.grossMargin,
      activatedAt: payload?.activatedAt,
    })),
    allocated: safe('allocation', (payload) => allocation.execute({
      partnerId: payload?.partnerId,
      ownerId: payload?.ownerId,
      campaignId: payload?.campaignId,
    })),
    refunded: safe('refund', (payload) => cancel.execute({
      partnerId: payload?.partnerId,
      orderId: payload?.orderId,
      reason: payload?.reason ?? 'Activation reversed',
    })),
    promoted: rankSync('rank promotion'),
    demoted: rankSync('rank demotion'),
  };
};

export const subscribeCompensation = ({
  events = domainEvents,
  repo = new MongoCompensationRepository(),
  useCases = null,
} = {}) => {
  const handlers = useCases
    ? {
      activated: useCases.activated,
      allocated: useCases.allocated,
      refunded: useCases.refunded,
      promoted: useCases.promoted,
      demoted: useCases.demoted,
    }
    : buildCompensationHandlers({ repo });

  const offs = [
    events.on('partner.activated', handlers.activated),
    events.on('partner.allocated', handlers.allocated),
    events.on('partner.activation_refunded', handlers.refunded),
    events.on(PROGRESSION_EVENTS.PROMOTED, handlers.promoted),
    events.on(PROGRESSION_EVENTS.DEMOTED, handlers.demoted),
  ];
  return () => offs.forEach((off) => off());
};
