import { ForbiddenException, UnauthorizedException } from '../domain/AppError.js';
import { PartnersModel } from '../../apps/partner/models/partner.model.js';
import { hasPermission } from '../../modules/identity-access/domain/Permissions.js';

export const requirePermission = (permission) => async (req, _res, next) => {
  try {
    const partnerId = req.auth?.partnerId;
    if (!partnerId) throw new UnauthorizedException('User unauthenticated');

    const partner = await PartnersModel.findById(partnerId)
      .select('permissions')
      .lean()
      .catch(() => null);
    if (!partner) throw new UnauthorizedException('User unauthenticated');
    if (!hasPermission(partner, permission)) {
      throw new ForbiddenException('Feature access required');
    }

    next();
  } catch (err) {
    next(err);
  }
};
