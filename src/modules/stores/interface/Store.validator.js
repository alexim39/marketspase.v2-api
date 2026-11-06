import { z } from 'zod';

const text = (max) => z.string().trim().max(max).optional();

export const StoreListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
});

export const StoreUpdateSchema = z.object({
  name: text(120),
  tagline: text(180),
  bio: text(4000),
  logo: text(500),
  banner: text(500),
  whatsapp: text(40),
  phone: text(40),
  instagram: text(500),
  tiktok: text(500),
  facebook: text(500),
  x: text(500),
  youtube: text(500),
  deliveryNote: text(2000),
  deliveryFee: z.coerce.number().min(0).max(1000000).optional(),
  returnPolicy: text(2000),
  autoPublish: z.boolean().optional(),
  status: z.enum(['draft', 'published']).optional(),
});

export const StoreProductUpdateSchema = z.object({
  retailPrice: z.coerce.number().min(0.01).max(100000000).optional(),
  status: z.enum(['draft', 'published', 'paused']).optional(),
});

const orderStatus = z.enum([
  'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
]);

export const StoreOrderCreateSchema = z.object({
  items: z.array(z.object({
    storeProductId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid store product'),
    quantity: z.coerce.number().int().min(1).max(99),
  })).min(1).max(20),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(7).max(30),
    street: z.string().trim().min(3).max(300),
    city: z.string().trim().min(2).max(120),
    state: z.string().trim().min(2).max(120),
    country: z.string().trim().max(80).optional().default('Nigeria'),
    note: z.string().trim().max(1000).optional().default(''),
  }),
});

export const StoreOrderUpdateSchema = z.object({
  status: z.enum(['processing', 'shipped', 'delivered']),
  courier: z.string().trim().max(120).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  trackingUrl: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const StoreOrderListQuerySchema = z.object({
  status: orderStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
});

export const StoreOrderReferenceSchema = z.object({
  reference: z.string().trim().min(8).max(80),
});

export const StoreOrderParamsSchema = z.object({
  orderId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid order'),
});

export const StoreProductParamsSchema = z.object({
  id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid store product'),
});

export const StoreSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
});

export const StorePublicProductParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  productId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid product'),
});
