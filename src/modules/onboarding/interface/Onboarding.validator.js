import { z } from 'zod';

const phone = z.string().trim().regex(/^[+0-9][0-9\s-]{6,19}$/, 'Enter a valid phone number');
const id = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const shippingSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone,
  street: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100).default('Nigeria'),
  notes: z.string().trim().max(500).default(''),
});

export const SubmitKycSchema = z.object({
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  address: z.string().trim().min(5).max(300).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  country: z.string().trim().min(2).max(100).optional(),
  idType: z.enum(['nin', 'drivers_license', 'passport', 'voters_card']).optional(),
  idNumber: z.string().trim().regex(/^[A-Za-z0-9-]{6,30}$/, 'Enter a valid ID number').optional(),
});

export const CreateActivationOrderSchema = z.object({
  productId: id,
  shipping: shippingSchema,
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export const OrderQuerySchema = z.object({
  status: z.enum(['Paid', 'Fulfilled', 'Refunded', 'Cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const KycQuerySchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const OrderIdParamsSchema = z.object({ id });
export const PartnerIdParamsSchema = z.object({ partnerId: id });

export const RefundOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const RejectKycSchema = z.object({
  note: z.string().trim().min(3).max(500),
});
