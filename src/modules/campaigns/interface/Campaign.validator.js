import { z } from 'zod';
import { MIN_CAMPAIGN_BUDGET_NGN } from '../domain/Campaign.allocation.js';

const id = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const state = z.string().trim().min(2).max(60);

export const CreateGrowthCampaignSchema = z.object({
  name: z.string().trim().min(3).max(80),
  category: z.string().trim().max(60).default(''),
  brief: z.string().trim().max(600).default(''),
  budgetAmount: z.coerce.number().int().min(MIN_CAMPAIGN_BUDGET_NGN).max(10000000),
  capacityTotal: z.coerce.number().int().min(1).max(20).default(4),
  maxPerWeek: z.coerce.number().int().min(1).max(10).default(2),
  targetStates: z.array(state).max(10).default([]),
  ageRange: z.string().trim().max(30).default('All'),
  gender: z.string().trim().max(30).default('All'),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional().nullable(),
});

export const GrowCampaignQuerySchema = z.object({
  status: z.enum(['Pending', 'Active', 'Paused', 'Ended', 'Cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const CampaignIdParamsSchema = z.object({ id });

export const CancelGrowthCampaignSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const RejectGrowthCampaignSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const EndGrowthCampaignSchema = z.object({
  spentAmount: z.coerce.number().min(0),
  note: z.string().trim().max(500).optional(),
});

export const AllocatePartnersSchema = z.object({
  campaignId: id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const QueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
