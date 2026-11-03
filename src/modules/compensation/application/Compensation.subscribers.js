import { domainEvents } from '../../../shared/events/DomainEvents.js';
import { MongoCompensationRepository } from '../infrastructure/Compensation.mongo.repository.js';
import {
  CancelActivationCompensationUseCase,
  RecordActivationCompensationUseCase,
  RecordAllocationCompensationUseCase,
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
    }
    : buildCompensationHandlers({ repo });

  const offs = [
    events.on('partner.activated', handlers.activated),
    events.on('partner.allocated', handlers.allocated),
    events.on('partner.activation_refunded', handlers.refunded),
  ];
  return () => offs.forEach((off) => off());
};
