/**
 * Repository contracts for the billing slice.
 * Money movement (balance credits/debits + Transaction rows) happens ONLY
 * inside `releaseCart` / `voidCart`, which must run in a single Mongo
 * transaction (implemented in infrastructure).
 */

export class CommissionLedger {
  /** @returns {Promise<any>} active plan doc (seeded with defaults if none) */
  async getActivePlan() { throw new Error('Not implemented'); }
  /** Idempotency: existing entries for a cart (empty = not yet accrued). */
  async findByCart(cartId) { throw new Error('Not implemented'); }
  /** Bulk insert Pending entries (unique cartId+level enforced by index). */
  async insertMany(entries) { throw new Error('Not implemented'); }
  /** Earner's ledger page (newest first). */
  async findByEarner(partnerId, { limit, skip, status }) { throw new Error('Not implemented'); }
  /** Sums per status for one earner. */
  async sumByEarner(partnerId) { throw new Error('Not implemented'); }
  /** Carts having Pending entries (admin release queue). */
  async pendingCarts({ limit, skip }) { throw new Error('Not implemented'); }
  /**
   * Release ALL Pending entries of a cart: flip to Released, credit each
   * earner balance, write Transaction(Credit/Commission) rows — atomically.
   * @returns {{released:number, total:number}}
   */
  async releaseCart(cartId, { releasedBy }) { throw new Error('Not implemented'); }
  /**
   * Void a cart: Pending → Voided; already-Released → Reversed + balance
   * debit + Transaction(Debit/Clawback) rows — atomically.
   * @returns {{voided:number, reversed:number}}
   */
  async voidCart(cartId, { releasedBy }) { throw new Error('Not implemented'); }
}

export class OrderReader {
  /** @returns {Promise<{id,buyerId,buyerUsername,buyerName,total,status}|null>} */
  async findCart(cartId) { throw new Error('Not implemented'); }
  /** @returns {Promise<any>} cart with new status */
  async markCart(cartId, status) { throw new Error('Not implemented'); }
  /** Personal purchase volume (non-voided carts). */
  async personalVolume(partnerId) { throw new Error('Not implemented'); }
  /** Summed volume over an explicit id set (bounded team set from network). */
  async volumeFor(partnerIds) { throw new Error('Not implemented'); }
  /** Direct recruits since a date (for recruits-this-month). */
  async recruitsSince(partnerId, since) { throw new Error('Not implemented'); }
}
