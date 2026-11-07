import { domainEvents } from '../../../shared/events/DomainEvents.js';
import { recordAudit } from '../../audit/index.js';

export class GetOnboardingStatusUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId) {
    return this.repo.getStatus(partnerId);
  }
}

export class ListStarterProductsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute() {
    const products = await this.repo.listProducts();
    return products.map((product) => ({
      id: String(product._id),
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
    }));
  }
}

export class SubmitKycUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId, input) {
    return this.repo.submitKyc(partnerId, input);
  }
}

export class CreateActivationOrderUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute({ partnerId, productId, shipping, idempotencyKey }) {
    const result = await this.repo.createOrder({
      partnerId,
      productId,
      shipping,
      idempotencyKey,
    });

    if (!result.repeated) {
      await this.events.emit('partner.activated', {
        partnerId: String(partnerId),
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        productId: String(productId),
        amount: result.order.amount,
        currency: result.order.currency,
        grossMargin: Number(result.grossMargin) || 0,
        activatedAt: result.order.activatedAt,
      }).catch(() => null);
    }

    const { grossMargin: _grossMargin, ...safeResult } = result;
    return safeResult;
  }
}

export class ListMyActivationOrdersUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId, query) {
    return this.repo.listMyOrders(partnerId, query);
  }
}

export class ListAdminActivationOrdersUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query) {
    return this.repo.listAdminOrders(query);
  }
}

export class FulfillActivationOrderUseCase {
  constructor({ repo, commissions = null, audit = recordAudit }) {
    this.repo = repo;
    this.commissions = commissions;
    this.audit = audit;
  }

  async execute(orderId, adminId) {
    const order = await this.repo.fulfillOrder(orderId, adminId);
    let autoRelease = null;
    if (this.commissions?.releaseActivationOrder) {
      try {
        autoRelease = await this.commissions.releaseActivationOrder(orderId, adminId);
        if (autoRelease?.released > 0) {
          void this.audit({
            actorId: adminId ?? 'system',
            action: 'commission.auto_release',
            targetType: 'order',
            targetId: String(orderId),
            detail: { trigger: 'fulfillment', ...autoRelease },
          });
        }
      } catch (error) {
        console.error('[onboarding] activation commission auto-release failed:', error?.message ?? error);
        autoRelease = { error: true };
      }
    }
    return { ...order, autoRelease };
  }
}

export class RefundActivationOrderUseCase {
  constructor({ repo, events = domainEvents }) {
    this.repo = repo;
    this.events = events;
  }

  async execute(orderId, adminId, reason) {
    const result = await this.repo.refundOrder(orderId, adminId, reason);
    if (!result.repeated) {
      await this.events.emit('partner.activation_refunded', {
        partnerId: result.partner?.id ?? null,
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        amount: result.order.amount,
        reason,
      }).catch(() => null);
    }
    return result;
  }
}

export class ListKycSubmissionsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query) {
    return this.repo.listKyc(query);
  }
}

export class VerifyKycUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId, adminId) {
    return this.repo.verifyKyc(partnerId, adminId);
  }
}

export class RejectKycUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(partnerId, adminId, note) {
    return this.repo.rejectKyc(partnerId, adminId, note);
  }
}
