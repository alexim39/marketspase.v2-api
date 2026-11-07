import { z } from 'zod';

const text = (min, max) => z.string().trim().min(min).max(max);
const email = z.string().trim().toLowerCase().email().max(254);

/** Public contact form — strictly whitelisted before the controller. */
export const ContactSubmitSchema = z.object({
  name: text(1, 120),
  surname: text(1, 120),
  email,
  subject: text(1, 200),
  message: text(1, 5000),
  username: z.string().trim().max(60).optional(),
});

/** Pre-approach download form. */
export const PreapproachSubmitSchema = z.object({
  name: text(1, 120),
  surname: text(1, 120),
  email,
  phone: text(7, 30),
  userDevice: z.string().trim().max(200).optional(),
  username: text(1, 80),
});
