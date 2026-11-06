import { z } from 'zod';
import { RANKS } from '../domain/Compensation.plan.js';

const id = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

export const CompensationEntryQuerySchema = z.object({
  status: z.enum(['Pending', 'Released', 'Voided', 'Reversed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const MentorBonusQuerySchema = z.object({
  status: z.enum(['scheduled', 'paid', 'forfeited', 'cancelled', 'clawed_back']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const EntryParamsSchema = z.object({ id });

export const VoidCommissionSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const SetCommissionRankSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  rank: z.enum(RANKS),
});

const isoDate = z.string().trim().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Invalid date',
);

export const ProductCommissionReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const ProductCommissionReconcileSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  apply: z.boolean().default(false),
});
