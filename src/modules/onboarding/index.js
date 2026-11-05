import { StarterProductModel } from './infrastructure/Onboarding.models.js';

export {
  default,
  buildOnboardingRouter,
  buildAdminOnboardingRouter,
} from './interface/Onboarding.routes.js';

export const STARTER_PRODUCT = {
  sku: 'MS-STARTER-001',
  name: 'MarketSpase Signature Clothing Set',
  description: 'A premium everyday clothing set, delivered nationwide. Activation includes business onboarding and access to the MarketSpase partner network.',
  price: 38000,
  currency: 'NGN',
  imageUrl: '/img/activation-hoodi.jpeg',
  shippingCost: 3000,
  cogs: 16000,
  active: true,
  sortOrder: 1,
};

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
