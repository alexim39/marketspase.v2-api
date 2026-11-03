/**
 * Contracts for the analytics slice. Analytics never writes and never
 * caches — every metric derives from source aggregates at request time.
 */
export class ProspectStats {
  async stageDistribution(partnerId, start, end) { throw new Error('Not implemented'); }
  async findReadyToConvert(partnerId, limit) { throw new Error('Not implemented'); }
  async findByPartnerId(partnerId, page) { throw new Error('Not implemented'); }
}

export class TeamStats {
  async volumeBetween(partnerId, start, end) { throw new Error('Not implemented'); }
  async volumeForBetween(partnerIds, start, end) { throw new Error('Not implemented'); }
  async recruitsBetween(partnerId, start, end) { throw new Error('Not implemented'); }
  async activeMemberCount(partnerIds, start, end) { throw new Error('Not implemented'); }
}
