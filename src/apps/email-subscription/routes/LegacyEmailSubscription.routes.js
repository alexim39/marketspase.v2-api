import express from 'express';

/**
 * Temporary compatibility redirects for links already delivered by email
 * before the v1 migration. They contain no business logic and can be removed
 * once `npm run audit:legacy` shows no `/emailSubscription/*` traffic.
 */
const router = express.Router();

const toV1 = (suffix) => (req, res) => res.redirect(
  302,
  `/v1/email-subscription/${suffix.replace(':token', encodeURIComponent(req.params.token ?? ''))}`,
);

router.post('/subscribe', (req, res) => res.redirect(307, '/v1/email-subscription/subscribe'));
router.get('/confirm/:token', toV1('confirm/:token'));
router.get('/unsubscribe/:token', toV1('unsubscribe/:token'));

export default router;
