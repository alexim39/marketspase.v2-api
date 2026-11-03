import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { signin, partnerSignout, getPartner, requestPasswordReset} from '../controllers/auth.controller.js'
const AuthRouter = express.Router();


// signup retired — POST /v1/auth/signup is the only signup path (transactional consume + upline link).
// partner login — throttled per IP against credential stuffing.
AuthRouter.post('/signin', rateLimit({ name: 'legacy-auth', windowMs: 60000, max: 10 }), signin);
// Get partner
AuthRouter.get('/', getPartner);
// partner logout
AuthRouter.post('/signout', partnerSignout);
// partner reset password request — throttled per IP against email bombing.
AuthRouter.post('/reset-password-request', rateLimit({ name: 'legacy-reset', windowMs: 60000, max: 5 }), requestPasswordReset );

export default AuthRouter;