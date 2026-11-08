import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import {
    getCampaignsCreatedBy,
    listCampaignsForAdmin,
    recordVisits,
    getCampaign,
    updateCampaignStatus,
    cancelCampaign,
    duplicateCampaign,
} from '../controllers/campaign.controller.js'
const CampaignRouter = express.Router();

const CampaignStatusUpdate = z.object({
  status: z.enum(['Pending', 'Active', 'Rejected', 'Ended', 'Cancelled']),
  reason: z.string().trim().max(1000).optional(),
  spentAmount: z.coerce.number().min(0).max(100000000).optional(),
  spendNote: z.string().trim().max(500).optional(),
});

const CampaignVisits = z.object({
  username: z.string().trim().min(1).max(80),
  channel: z.string().trim().max(40).optional(),
});

// Campaign creation lives only at POST /v1/campaigns. The legacy unified and
// per-channel create endpoints and the pool-lead allocation engine were
// retired; read and management routes stay.

// Get all campaigns createdBy — owner, upline or admin.
CampaignRouter.get('/all-createdBy/:createdBy', requireAuth, getCampaignsCreatedBy);

// Admin queue (role-gated) — must precede /:id so 'queue' isn't read as an id.
CampaignRouter.get('/queue', requireAuth, requireRole('admin'), listCampaignsForAdmin);

CampaignRouter.post('/:id/duplicate', requireAuth, duplicateCampaign);
CampaignRouter.post('/:id/cancel', requireAuth, cancelCampaign);
CampaignRouter.patch('/:id/status', requireAuth, requireRole('admin'), validateBodyInPlace(CampaignStatusUpdate), updateCampaignStatus);

// Get a camapaign — owner, upline or admin.
CampaignRouter.get('/:id', requireAuth, getCampaign);

// record visit — PUBLIC (the :4201 site records anonymous page visits).
// Generous per-IP budget: every genuine page view fires exactly one call.
CampaignRouter.post('/visits', rateLimit({ name: 'campaign-visits', windowMs: 60000, max: 120 }), validateBodyInPlace(CampaignVisits), recordVisits);


export default CampaignRouter;
