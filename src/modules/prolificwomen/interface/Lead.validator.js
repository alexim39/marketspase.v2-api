import { z } from 'zod';

export const SubmitLeadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30),
  location: z.string().trim().min(2).max(120),
  readyToBeMentored: z.enum(['yes', 'not-yet']),
  headOfficeInvite: z.enum(['yes', 'no']),
  availability: z.enum(['weekdays', 'weekends']),
  submittedAt: z.string().trim().max(40).optional(),
});

export const ListLeadsQuery = z.object({
  q: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  skip: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['all', 'new', 'accepted']).optional().default('all'),
});

export const InboxLeadsQuery = z.object({
  q: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(500).optional().default(500),
  skip: z.coerce.number().int().min(0).optional().default(0),
});
