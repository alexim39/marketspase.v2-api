import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { 
    checkPartnerUsername, getAllUsers, searchPartnersPublic,
     getPartnerByNames, getPartnerByName,
    tiktokPage, twitterPage, updateTestimonial, updateLandingPage,
    updateYoutubePage, updateInstagramPage,
    updateFacebookPage, updateLinkedinPage,
    updateProfile, updateWhatsappGroupLink, updateWhatsappChatLink,
    updateUsername, unfollowPartner, checkFollowStatus,
    changePassword, updateProfession, followPartner, getPartnersOf, getPartnerById
} from '../controllers/partner.controller.js'
const PartnerRouter = express.Router();

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid account');
const ProfileUpdate = z.object({
  id: objectId,
  name: z.string().trim().min(1).max(80),
  surname: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(30),
  bio: z.string().trim().max(1000).optional(),
  address: z.unknown().optional(),
  dobDatePicker: z.union([z.string(), z.date()]).optional(),
});
const ProfessionUpdate = z.object({
  id: objectId,
  jobTitle: z.string().trim().min(1).max(120),
  educationBackground: z.string().trim().min(1).max(200),
  hobby: z.string().trim().max(200).optional(),
  skill: z.string().trim().max(200).optional(),
});
const UsernameUpdate = z.object({
  id: objectId,
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Invalid username'),
});
const PasswordUpdate = z.object({
  id: objectId,
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});



// public referral picker (safe fields, no auth — used by Get Started).
// Throttled: autocomplete types per keystroke.
PartnerRouter.get('/public-search', rateLimit({ name: 'partner-search', windowMs: 60000, max: 60 }), searchPartnersPublic);

// public page lookup (safe fields only — used by /:partnerUsername).
// Throttled against username harvesting scripts.
PartnerRouter.get('/check-username/:username', rateLimit({ name: 'username-check', windowMs: 60000, max: 60 }), checkPartnerUsername);

// Everything below needs a partner session. Writes additionally enforce
// session-ownership inside the controllers (self-only or scoped reads).
// Update partner
PartnerRouter.put('/update-profile', requireAuth, validateBodyInPlace(ProfileUpdate), updateProfile);

// Update partner
PartnerRouter.put('/update-profession', requireAuth, validateBodyInPlace(ProfessionUpdate), updateProfession);

// Update username
PartnerRouter.put('/update-username', requireAuth, validateBodyInPlace(UsernameUpdate), updateUsername)

// Change password
PartnerRouter.put('/change-password', requireAuth, validateBodyInPlace(PasswordUpdate), changePassword)

// member directory (safe fields, capped) — authenticated members only
PartnerRouter.get('/getAllUsers', requireAuth, getAllUsers)

// get all partners
PartnerRouter.get('/getPartnerByNames/:name/:surname', requireAuth, getPartnerByNames)

// get all partners
PartnerRouter.get('/getPartnerByName/:name', requireAuth, getPartnerByName)

// follow
PartnerRouter.post('/follow/:searchPartnerId', requireAuth, followPartner);

// unfollow
PartnerRouter.post('/unfollow/:searchPartnerId', requireAuth, unfollowPartner);

// check follow
PartnerRouter.get('/check-follow-status/:partnerId/:searchPartnerId', requireAuth, checkFollowStatus);

// Update partner social media pages
PartnerRouter.put('/whatsappgrouplink', requireAuth, updateWhatsappGroupLink);
PartnerRouter.put('/whatsappchatlink', requireAuth, updateWhatsappChatLink);
PartnerRouter.put('/facebookPage', requireAuth, updateFacebookPage);
PartnerRouter.put('/linkedinPage', requireAuth, updateLinkedinPage);
PartnerRouter.put('/youtubePage', requireAuth, updateYoutubePage);
PartnerRouter.put('/instagramPage', requireAuth, updateInstagramPage);
PartnerRouter.put('/tiktokPage', requireAuth, tiktokPage);
PartnerRouter.put('/twitterPage', requireAuth, twitterPage);
// update testimonial
PartnerRouter.put('/testimonial', requireAuth, updateTestimonial);
// unified public one-pager save (/:partnerUsername content)
PartnerRouter.put('/landing-page', requireAuth, updateLandingPage);

// get all partnersOf
PartnerRouter.get('/getPartnersOf/:partnerId', requireAuth, getPartnersOf);

// get partner by id
PartnerRouter.get('/getById/:partnerId', requireAuth, getPartnerById);




export default PartnerRouter;
