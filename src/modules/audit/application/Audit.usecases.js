import { AUDIT_ACTIONS } from '../domain/AuditLog.js';

/** GET /v1/admin/audit — filtered, newest-first admin action history. */
export class ListAuditUseCase {
  /** @param {{audit}} deps */
  constructor({ audit }) {
    this.audit = audit;
  }

  async execute({ actorId = null, action = null, from = null, to = null, limit = 50, skip = 0 } = {}) {
    if (action && !AUDIT_ACTIONS.includes(action)) {
      const { ValidationException } = await import('../../../shared/domain/AppError.js');
      throw new ValidationException(`Unknown audit action (expected one of: ${AUDIT_ACTIONS.join(', ')})`);
    }
    return this.audit.list({ actorId, action, from, to, limit, skip });
  }
}
