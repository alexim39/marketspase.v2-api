import { AppError, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';

/** Earner's own ledger page. */
export class GetMyCommissionsUseCase {  /** @param {{ledger}} deps */
  constructor({ ledger }) {
    this.ledger = ledger;
  }

  async execute({ partnerId, limit = 50, skip = 0, status }) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const allowed = status === undefined || status === '' ? undefined : status;
    if (allowed !== undefined && !['Pending', 'Released', 'Voided', 'Reversed'].includes(allowed)) {
      throw new ValidationException('Invalid status filter');
    }
    const [{ items, total }, sums] = await Promise.all([
      this.ledger.findByEarner(partnerId, { limit: lim, skip: sk, status: allowed }),
      this.ledger.sumByEarner(partnerId),
    ]);
    return { items, total, limit: lim, skip: sk, sums };
  }
}

/** Admin release queue: carts with Pending entries. */export class GetPendingCartsUseCase {
  /** @param {{ledger}} deps */
  constructor({ ledger }) {
    this.ledger = ledger;
  }

  async execute({ limit = 25, skip = 0 }) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    return this.ledger.pendingCarts({ limit: lim, skip: sk });
  }
}

/**
 * Resolve a bank account holder via Paystack — the secret lives server-side
 * (PAYSTACKTOKEN); the client must never call api.paystack.co directly.
 */
export class ResolveAccountUseCase {
  /** @param {{http}} deps (axios-compatible; stubbed in tests) */
  constructor({ http }) {
    this.http = http;
  }

  async execute({ accountNumber, bankCode }) {
    const acct = String(accountNumber ?? '').trim();
    const bank = String(bankCode ?? '').trim();
    if (!/^\d{10}$/.test(acct)) throw new ValidationException('Invalid account number');
    if (!bank) throw new ValidationException('Invalid bank code');
    const secret = process.env.PAYSTACKTOKEN;
    if (!secret) throw new AppError('Payment provider not configured', 500, 'CONFIG_ERROR');
    let data;
    try {
      const response = await this.http.get('https://api.paystack.co/bank/resolve', {
        params: { account_number: acct, bank_code: bank },
        headers: { Authorization: `Bearer ${secret}` },
      });
      data = response?.data?.data ?? response?.data;
    } catch (error) {
      throw new ValidationException(
        error?.response?.data?.message ?? 'Account could not be resolved',
      );
    }
    if (!data?.account_name) throw new ValidationException('Account not found');
    return { accountName: data.account_name, accountNumber: data.account_number ?? acct };
  }
}

/** Monthly released-earnings trend for the earner's charts. */
export class GetEarningsTrendUseCase {
  /** @param {{ledger}} deps */
  constructor({ ledger }) {
    this.ledger = ledger;
  }

  async execute({ partnerId, months = 6 }) {
    return this.ledger.releasedByMonth(partnerId, months);
  }
}

/**
 * Performance snapshot: personal + team volume, recruits, downline size,
 * commission sums. Team set is bounded (network tree depth 10) — documented
 * approximation for very large organizations.
 */
export class GetPerformanceUseCase {
  /** @param {{ledger, orders, network, partners}} deps */
  constructor({ ledger, orders, network, partners }) {
    this.ledger = ledger;
    this.orders = orders;
    this.network = network;
    this.partners = partners;
  }

  async execute({ partnerId }) {
    const me = await this.partners.findById(partnerId);
    if (!me) throw new NotFoundException('Partner not found');

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [personal, sums, recruits, tree] = await Promise.all([
      this.orders.personalVolume(partnerId),
      this.ledger.sumByEarner(partnerId),
      this.orders.recruitsSince(partnerId, monthStart),
      this.collectDownlineIds(partnerId),
    ]);

    const team = await this.orders.volumeFor(tree.ids);
    return {
      partner: { id: partnerId, plan: me.subscription?.plan ?? 'Basic' },
      personalVolume: personal.total,
      personalOrders: personal.orders,
      teamVolume: team.total,
      teamOrders: team.orders,
      downlineCount: tree.total,
      downlineTruncated: tree.truncated,
      recruitsThisMonth: recruits,
      commissions: sums,
    };
  }

  /** Bounded BFS over the upline-linked graph (reuses network contract). */
  async collectDownlineIds(rootId, maxDepth = 10, perLevelCap = 500) {
    const visited = new Set([String(rootId)]);
    const ids = [];
    let frontier = [String(rootId)];
    let truncated = false;
    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const children = await this.network.findChildren(frontier, perLevelCap);
      const fresh = [];
      for (const c of children) {
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        ids.push(c.id);
        fresh.push(c.id);
      }
      if (children.length >= perLevelCap * frontier.length) truncated = true;
      frontier = fresh;
    }
    if (frontier.length > 0) truncated = true;
    return { ids, total: ids.length, truncated };
  }
}
