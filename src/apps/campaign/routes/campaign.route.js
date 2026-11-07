import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import {
    createCampaign,
    createFacebookCampaign,
    getCampaignsCreatedBy,
    listCampaignsForAdmin,
    recordVisits,
    createYoutubeCampaign,
    createLinkedinCampaign,
    getCampaign,
    updateCampaignStatus,
    allocateCampaignNow,
    allocationSummary,
    myAllocationSummaries,
    campaignAllocations,
    updateAllocationSettings,
    reportAllocation,
    reportAllocationBySurvey,
    verdictAllocation,
    listReportedAllocations,
    campaignNames,
    cancelCampaign,
    duplicateCampaign,
    estimateSupply,
} from '../controllers/campaign.controller.js'
const CampaignRouter = express.Router();

const dateValue = z.union([z.string().trim().min(1).max(40), z.date()]);
const channel = z.enum(['facebook', 'youtube', 'linkedin']);

const CampaignCreate = z.object({
  channel: channel.optional(),
  campaignName: z.string().trim().min(2).max(160),
  category: z.string().trim().max(80).optional(),
  userDevice: z.string().trim().max(200).optional(),
  targetAudience: z.object({
    ageRangeTarget: z.string().trim().max(40).optional(),
    genderTarget: z.string().trim().max(40).optional(),
    locationTarget: z.string().trim().max(40).optional(),
    locationTargets: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    educationTarget: z.string().trim().max(60).optional(),
    relationshipTarget: z.string().trim().max(60).optional(),
    industryTarget: z.string().trim().max(60).optional(),
  }).optional(),
  marketingObjectives: z.object({
    adObjective: z.string().trim().min(1).max(200),
    successMeasurement: z.string().trim().max(500).optional(),
  }),
  budget: z.object({
    budgetType: z.string().trim().min(1).max(40),
    budgetAmount: z.coerce.number().min(0).max(100000000),
  }),
  adDuration: z.object({
    campaignStartDate: dateValue,
    noEndDate: z.boolean(),
    campaignEndDate: dateValue.optional(),
  }),
  adFormat: z.object({
    adFormat: z.string().trim().min(1).max(80),
    deviceType: z.string().trim().min(1).max(80),
    adPreferences: z.object({
      FacebookFeed: z.boolean().optional(),
      InstagramFeed: z.boolean().optional(),
      InstagramStories: z.boolean().optional(),
      FacebookStories: z.boolean().optional(),
      AudienceNetwork: z.boolean().optional(),
      MessengerInbox: z.boolean().optional(),
    }).optional(),
  }),
});

const CampaignStatusUpdate = z.object({
  status: z.enum(['Pending', 'Active', 'Rejected', 'Ended', 'Cancelled']),
  reason: z.string().trim().max(1000).optional(),
  spentAmount: z.coerce.number().min(0).max(100000000).optional(),
  spendNote: z.string().trim().max(500).optional(),
});

const CampaignAllocationSettings = z.object({
  paused: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowOutOfArea: z.boolean().optional(),
  dailyCap: z.coerce.number().int().min(1).max(1000).optional(),
  totalCap: z.coerce.number().int().min(1).max(1000).optional(),
});

const CampaignReport = z.object({
  reason: z.string().trim().max(1000).optional(),
});

const CampaignVerdict = z.object({
  decision: z.enum(['replace', 'reject']),
  note: z.string().trim().max(500).optional(),
});

const CampaignVisits = z.object({
  username: z.string().trim().min(1).max(80),
  channel: z.string().trim().max(40).optional(),
});

const CampaignAllocate = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

// unified creation (one wizard, per-channel minimums enforced inside)
// — session-owned: wallet + record always hit the caller's account.
CampaignRouter.post('/', requireAuth, validateBodyInPlace(CampaignCreate), createCampaign);

// create facebook campaign
CampaignRouter.post('/facebook', requireAuth, validateBodyInPlace(CampaignCreate), createFacebookCampaign);

// create youtbue campaign
CampaignRouter.post('/youtube', requireAuth, validateBodyInPlace(CampaignCreate), createYoutubeCampaign);

// create linkedin campaign
CampaignRouter.post('/linkedin', requireAuth, validateBodyInPlace(CampaignCreate), createLinkedinCampaign);

// Get all campaigns createdBy — owner, upline or admin.
CampaignRouter.get('/all-createdBy/:createdBy', requireAuth, getCampaignsCreatedBy);

// Admin queue (role-gated) — must precede /:id so 'queue' isn't read as an id.
CampaignRouter.get('/queue', requireAuth, requireRole('admin'), listCampaignsForAdmin);

// Allocation desk — static segments precede /:id/* so nothing is read as an id.
CampaignRouter.get('/allocations/reported', requireAuth, requireRole('admin'), listReportedAllocations);
CampaignRouter.post('/allocations/:allocationId/report', requireAuth, validateBodyInPlace(CampaignReport), reportAllocation);
CampaignRouter.post('/allocations/by-survey/:surveyId/report', requireAuth, validateBodyInPlace(CampaignReport), reportAllocationBySurvey);
CampaignRouter.patch('/allocations/:allocationId/verdict', requireAuth, requireRole('admin'), validateBodyInPlace(CampaignVerdict), verdictAllocation);
CampaignRouter.get('/mine/allocation-summary', requireAuth, myAllocationSummaries);
CampaignRouter.get('/estimate-supply', requireAuth, estimateSupply);
CampaignRouter.get('/names', requireAuth, campaignNames);
CampaignRouter.post('/:id/allocate', requireAuth, validateBodyInPlace(CampaignAllocate), allocateCampaignNow);
CampaignRouter.post('/:id/duplicate', requireAuth, duplicateCampaign);
CampaignRouter.post('/:id/cancel', requireAuth, cancelCampaign);
CampaignRouter.get('/:id/allocation-summary', requireAuth, allocationSummary);
CampaignRouter.get('/:id/allocations', requireAuth, campaignAllocations);
CampaignRouter.patch('/:id/allocation', requireAuth, validateBodyInPlace(CampaignAllocationSettings), updateAllocationSettings);
CampaignRouter.patch('/:id/status', requireAuth, requireRole('admin'), validateBodyInPlace(CampaignStatusUpdate), updateCampaignStatus);

// Get a camapaign — owner, upline or admin.
CampaignRouter.get('/:id', requireAuth, getCampaign);

// record visit — PUBLIC (the :4201 site records anonymous page visits).
// Generous per-IP budget: every genuine page view fires exactly one call.
CampaignRouter.post('/visits', rateLimit({ name: 'campaign-visits', windowMs: 60000, max: 120 }), validateBodyInPlace(CampaignVisits), recordVisits);


export default CampaignRouter;
