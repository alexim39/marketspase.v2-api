import { ConflictException, NotFoundException } from '../../../shared/domain/AppError.js';
import { computeShares } from '../domain/CommissionPlan.js';

/**
 * Accrue commissions for a completed cart. Idempotent: unique (cartId,level)
 * index + pre-check make frontend retries (and double checkout webhooks) safe.
 * Buyer is excluded — only uplines earn. No balance moves here (Pending).
 */
export class AccrueCommissionsUseCase {
  /** @param {{ledger, orders, network}} deps */
  constructor({ ledger, orders, network }) {
    this.ledger = ledger;
    this.orders = orders;
    this.network = network;
  }

  async execute({ cartId }) {
    const existing = await this.ledger.findByCart(cartId);
    if (existing.length > 0) {
      return { accrued: 0, entries: existing, deduped: true };
    }

    const cart = await this.orders.findCart(cartId);
    if (!cart) throw new NotFoundException('Order not found');
    if (!cart.buyerId) throw new NotFoundException('Order has no buyer');

    const plan = await this.ledger.getActivePlan();
    const shares = computeShares(cart.total, plan.rates);

    // Walk upline: buyer -> partnerOf chain, up to 5 levels.
    const earners = [];
    const visited = new Set([String(cart.buyerId)]);
    let current = await this.network.findNode(String(cart.buyerId));
    for (const share of shares) {
      const parentId = current?.parentId;
      if (!parentId || visited.has(parentId)) break;
      visited.add(parentId);
      const earner = await this.network.findNode(parentId);
      if (!earner) break;
      earners.push({ share, earner });
      current = earner;
    }

    if (earners.length === 0) return { accrued: 0, entries: [], deduped: false };

    const entries = earners.map(({ share, earner }) => ({
      cartId,
      level: share.level,
      rate: share.rate,
      amount: share.amount,
      purchaseTotal: Number(cart.total),
      buyerId: cart.buyerId,
      buyerUsername: cart.buyerUsername,
      buyerName: cart.buyerName,
      earnerId: earner.id,
      earnerPlan: earner.plan ?? 'Basic',
      status: 'Pending',
    }));

    let saved = [];
    try {
      saved = await this.ledger.insertMany(entries);
    } catch (err) {
      if (err?.code !== 11000) throw err; // concurrent accrue won the race
    }
    const finalEntries = saved.length > 0 ? saved : await this.ledger.findByCart(cartId);
    return { accrued: saved.length, entries: finalEntries, deduped: saved.length === 0 };
  }
}

/**
 * Release a cart's Pending commissions (admin, post-fulfillment):
 * flip to Released + credit balances + Transaction rows, atomically.
 * Also advances the cart to Fulfilled — the fulfillment step itself.
 */
export class ReleaseCartCommissionsUseCase {
  /** @param {{ledger, orders}} deps */
  constructor({ ledger, orders }) {
    this.ledger = ledger;
    this.orders = orders;
  }

  async execute({ cartId, releasedBy }) {
    const cart = await this.orders.findCart(cartId);
    if (!cart) throw new NotFoundException('Order not found');
    const { released, total } = await this.ledger.releaseCart(cartId, { releasedBy });
    if (released > 0) await this.orders.markCart(cartId, 'Fulfilled');
    return { released, total };
  }
}

/** Void a cart's commissions (admin): Pending→Voided, Released→clawback. */
export class VoidCartCommissionsUseCase {
  /** @param {{ledger, orders}} deps */
  constructor({ ledger, orders }) {
    this.ledger = ledger;
    this.orders = orders;
  }

  async execute({ cartId, releasedBy }) {
    const cart = await this.orders.findCart(cartId);
    if (!cart) throw new NotFoundException('Order not found');
    if ((await this.ledger.findByCart(cartId)).length === 0) {
      throw new ConflictException('No commissions exist for this order');
    }
    const result = await this.ledger.voidCart(cartId, { releasedBy });
    await this.orders.markCart(cartId, 'Voided');
    return result;
  }
}
