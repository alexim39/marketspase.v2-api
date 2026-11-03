import { ForbiddenException, UnauthorizedException } from '../../../shared/domain/AppError.js';
import { adminBootstrapEmails, lenientRole } from '../domain/PartnerRole.js';
import { PartnersModel } from '../infrastructure/Auth.models.js';

/**
 * Role gate for v1 routers. Chain AFTER `requireAuth` (needs req.auth).
 * Role is read from DB per request (never trusted from the JWT claim),
 * normalized to canonical lowercase. `ADMIN_EMAILS` bootstraps the first
 * admins without a DB write — effective for the gate only.
 *
 * Usage: `router.patch('/x', requireAuth, requireRole('admin'), handler)`
 */
export const requireRole = (...allowed) => async (req, _res, next) => {
  try {
    const requesterId = req.auth?.partnerId;
    if (!requesterId) throw new UnauthorizedException('User unauthenticated');

    const doc = await PartnersModel.findById(requesterId).select('role email').lean();
    if (!doc) throw new UnauthorizedException('User unauthenticated');

    let role = lenientRole(doc.role);
    if (role !== 'admin' && adminBootstrapEmails().includes(String(doc.email ?? '').toLowerCase())) {
      role = 'admin';
    }
    req.auth.role = role;

    if (!allowed.includes(role)) throw new ForbiddenException('Insufficient permissions');
    next();
  } catch (err) {
    next(err);
  }
};
