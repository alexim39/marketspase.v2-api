import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

export const SignupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  surname: z.string().trim().min(2).max(80),
  email,
  password: z.string().min(6).max(128), // sole intentional tightening (legacy had no floor)
  phone: z.string().trim().min(7).max(20),
  // Acquisition attribution: campaign tracking code from /join?campaign=...
  campaign: z.string().trim().min(3).max(64).optional(),
  // Partner referral link: /join?ref=<username> (invalid/inactive falls back
  // to a system-owned account instead of rejecting the signup).
  ref: z.string().trim().min(1).max(80).optional(),
  // Converted pipeline lead: /join?ref=<username>&lead=<prospectId>.
  lead: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid lead').optional(),
  tnc: z.boolean().refine((v) => v === true, {
    message: 'You must accept the Terms of Service and Privacy Policy',
  }),
});

export const SigninSchema = z.object({
  email,
  password: z.string().min(1).max(128), // no strength leak on login path
});

export const ResetRequestSchema = z.object({ email });

export const ResetConfirmSchema = z.object({
  token: z.string().min(10).max(2048),
  newPassword: z.string().min(6).max(128),
});

export const VerifyEmailSchema = z.object({
  token: z.string().trim().min(32).max(128).regex(/^[a-f0-9]+$/i),
});

export const ResendVerificationSchema = z.object({ email });
