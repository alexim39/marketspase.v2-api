/**
 * Product-order commission use cases.
 *
 * These sit alongside activation commissions but use the product margin
 * snapshot and the referral tree (`partnerOf`). Nothing here moves money
 * outside the wallet ledger.
 */
export class AccrueProductCommissionsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(cartId) {
    return this.repo.accrueProductSale(cartId);
  }
}

export class ReleaseProductCommissionsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(cartId, releasedBy) {
    return this.repo.releaseProductSale(cartId, releasedBy);
  }
}

export class VoidProductCommissionsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(cartId, releasedBy, reason) {
    return this.repo.voidProductSale(cartId, releasedBy, reason);
  }
}
