import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

export const SubscribeSchema = z.object({
  email,
  userDevice: z.string().trim().max(200).optional(),
  username: z.string().trim().max(80).optional(),
});

/** Confirmation and unsubscribe tokens are 32 random bytes, hex encoded. */
export const TokenParamsSchema = z.object({
  token: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Invalid token'),
});
