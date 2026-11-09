import { z } from 'zod';

const text = (min, max) => z.string().trim().min(min).max(max);
const email = z.string().trim().toLowerCase().email().max(254);
const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const toList = (value) => (Array.isArray(value)
  ? value
  : String(value ?? '').split(','))
  .map((entry) => String(entry ?? '').trim())
  .filter(Boolean);

const list = (max, { required = false } = {}) => {
  const base = z.union([
    z.array(z.string().trim().max(120)).max(max),
    z.string().trim().max(2000),
  ]).transform((value) => toList(value).slice(0, max));
  return required
    ? base.refine((value) => value.length > 0, 'Select at least one option')
    : base.optional().default([]);
};

/** Public prospect survey form. */
export const ProspectSurveySchema = z.object({
  ageRange: text(1, 80),
  socialMedia: list(20, { required: true }),
  employedStatus: text(1, 120),
  importanceOfPassiveIncome: text(1, 120),
  onlinePurchaseSchedule: text(1, 120),
  primaryOnlineBusinessMotivation: text(1, 200),
  comfortWithTech: text(1, 120),
  onlineBusinessTimeDedication: text(1, 120),
  phoneNumber: text(7, 30),
  email,
  name: text(1, 120),
  surname: text(1, 120),
  referralCode: z.string().trim().max(80).optional(),
  referral: z.string().trim().max(120).optional(),
  userDevice: z.string().trim().max(200).optional(),
  username: z.string().trim().max(80).optional().default('business'),
  country: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  campaignId: objectId.optional().nullable(),
});
