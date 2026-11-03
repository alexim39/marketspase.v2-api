import { z } from 'zod';

/**
 * Presentation boundary: strict whitelist.
 * Unknown keys are stripped (Zod default) — `$where`, `$gt`,
 * `__proto__` etc. never reach Mongoose. This is the NoSQL-injection fix
 * for the legacy `new TicketModel(req.body)` passthrough.
 */
const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid partnerId');

export const SubmitTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  // accepts ISO string or Date; coerced to Date for the entity
  date: z.coerce.date(),
  category: z.string().trim().min(2).max(120),
  priority: z.string().trim().min(2).max(40),
  comment: z.string().trim().max(5000).optional().default(''),
  partnerId: objectIdString,
});

// Next step (after frontend sends enums): tighten to
// category: z.enum([...]), priority: z.enum(['low','medium','high','urgent'])
