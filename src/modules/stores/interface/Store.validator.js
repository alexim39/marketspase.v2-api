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
  returnPolicy: text(2000),
  autoPublish: z.boolean().optional(),
  status: z.enum(['draft', 'published']).optional(),
});

export const StoreProductUpdateSchema = z.object({
  retailPrice: z.coerce.number().min(0.01).max(100000000).optional(),
  status: z.enum(['draft', 'published', 'paused']).optional(),
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
