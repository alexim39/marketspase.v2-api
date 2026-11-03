/**
 * Contracts for the reports slice (upline <-> downline reporting).
 * Reports flow upward (downline → direct upline); requests flow downward
 * (leader → downline, ancestor-authorized).
 */
export class ReportStore {
  async createReport(data) { throw new Error('Not implemented'); }
  async listByAuthor(partnerId, limit) { throw new Error('Not implemented'); }
  async listByAuthors(partnerIds, limit) { throw new Error('Not implemented'); }
  async createRequest(data) { throw new Error('Not implemented'); }
  async findRequestById(id) { throw new Error('Not implemented'); }
  async findOpenRequest(requesterId, downlineId, periodStart, periodEnd) { throw new Error('Not implemented'); }
  async listIncomingRequests(downlineId) { throw new Error('Not implemented'); }
  async listOutgoingRequests(requesterId) { throw new Error('Not implemented'); }
  async fulfillRequest(id, reportId) { throw new Error('Not implemented'); }
}
