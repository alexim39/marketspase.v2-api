import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit } from '../../../shared/http/rateLimit.js';
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



// public referral picker (safe fields, no auth — used by Get Started).
// Throttled: autocomplete types per keystroke.
PartnerRouter.get('/public-search', rateLimit({ name: 'partner-search', windowMs: 60000, max: 60 }), searchPartnersPublic);

// public page lookup (safe fields only — used by /:partnerUsername).
// Throttled against username harvesting scripts.
PartnerRouter.get('/check-username/:username', rateLimit({ name: 'username-check', windowMs: 60000, max: 60 }), checkPartnerUsername);

// Everything below needs a partner session. Writes additionally enforce
// session-ownership inside the controllers (self-only or scoped reads).
// Update partner
PartnerRouter.put('/update-profile', requireAuth, updateProfile);

// Update partner
PartnerRouter.put('/update-profession', requireAuth, updateProfession);

// Update username
PartnerRouter.put('/update-username', requireAuth, updateUsername)

// Change password
PartnerRouter.put('/change-password', requireAuth, changePassword)

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
