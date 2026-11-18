import { StarterProductModel } from './infrastructure/Onboarding.models.js';
import { STARTER_PRODUCT } from './domain/StarterProduct.js';

export {
  default,
  buildOnboardingRouter,
  buildAdminOnboardingRouter,
} from './interface/Onboarding.routes.js';
export { STARTER_PRODUCT };

export const ensureStarterProduct = async () => {
  const existing = await StarterProductModel.findOne({ sku: STARTER_PRODUCT.sku }).lean();
  if (existing) {
    if (!existing.imageUrl) {
      await StarterProductModel.updateOne(
        { _id: existing._id },
        { $set: { imageUrl: STARTER_PRODUCT.imageUrl } },
      ).catch(() => null);
    }
    return { seeded: false, id: String(existing._id) };
  }
  const created = await StarterProductModel.create(STARTER_PRODUCT);
  return { seeded: true, id: String(created._id) };
};
