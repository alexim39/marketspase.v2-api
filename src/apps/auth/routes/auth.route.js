import express from 'express';
import { z } from 'zod';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { signin, partnerSignout, getPartner, requestPasswordReset} from '../controllers/auth.controller.js'
const AuthRouter = express.Router();

const LegacySignin = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
const LegacyReset = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});


// signup retired — POST /v1/auth/signup is the only signup path (transactional consume + upline link).
// partner login — throttled per IP against credential stuffing.
AuthRouter.post('/signin', rateLimit({ name: 'legacy-auth', windowMs: 60000, max: 10 }), validateBodyInPlace(LegacySignin), signin);
// Get partner
AuthRouter.get('/', getPartner);
// partner logout
AuthRouter.post('/signout', partnerSignout);
// partner reset password request — throttled per IP against email bombing.
AuthRouter.post('/reset-password-request', rateLimit({ name: 'legacy-reset', windowMs: 60000, max: 5 }), validateBodyInPlace(LegacyReset), requestPasswordReset );

export default AuthRouter;