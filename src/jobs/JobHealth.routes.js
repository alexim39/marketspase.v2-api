import express from 'express';
import { requireAuth } from '../shared/http/requireAuth.js';
import { requireRole } from '../modules/identity-access/interface/RequireRole.js';
import { asyncHandler } from '../shared/http/asyncHandler.js';
import { JobRunModel, jobsHealth } from './job-health.js';

/** Admin automation health — are the sweeps actually firing? */
const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const data = await jobsHealth(JobRunModel);
    res.status(200).json({ message: 'Automation health retrieved', data, success: true });
  }),
);

export default router;
