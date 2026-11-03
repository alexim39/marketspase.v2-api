import { PartnersModel } from "../models/partner.model.js";
import { BookingModel } from "./../../booking/models/booking.model.js";
import { ProspectSurveyModel } from "../../survey/models/survey.model.js";
import bcrypt from "bcryptjs";
import { sendEmail } from "../../../services/emailService.js";
import dotenv  from "dotenv"
dotenv.config()
import mongoose from 'mongoose';
import { buildProspectAccess } from '../../../modules/crm/application/Prospect.access.js';

// Session + ownership guard for this legacy router (no auth existed here).
// Reads that must stay public (username check, referral picker) are
// sanitized to public fields instead.
const guard = buildProspectAccess({
  findProspectById: async () => null,
  findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean().catch(() => null),
});
const sessionId = (req) => (req.auth?.partnerId ? String(req.auth.partnerId) : null);
const deny = (res, status, message) => res.status(status).json({ message, success: false });

/** Reject when the body id is not the caller's own account. */
const requireSelf = (req, res, id) => {
  if (!sessionId(req)) {
    deny(res, 401, 'User unauthenticated');
    return false;
  }
  if (!id || String(id) !== sessionId(req)) {
    deny(res, 403, 'You can only update your own profile');
    return false;
  }
  return true;
};

/** Strip secrets + internal fields from any partner document sent out. */
const safePartner = (doc) => {
  if (!doc) return doc;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete o.password;
  delete o.resetPasswordToken;
  delete o.resetPasswordExpires;
  return o;
};

// Public page fields (client PartnerInterface + landing content). Everything
// else (password, reservationCode, settings, wallet, telemetry) stays hidden.
// Phone and email are private by default: only the explicit displayPhone /
// displayEmail values a partner chooses are exposed publicly.
const PUBLIC_PROFILE_SELECT = [
  'username', 'name', 'surname', 'bio', 'jobTitle', 'profileImage',
  'testimonial',
  'whatsappGroupLink', 'whatsappChatLink',
  'facebookPage', 'linkedinPage', 'youtubePage', 'instagramPage', 'tiktokPage', 'twitterPage',
  'headline', 'subHeadline', 'heroBadge', 'businessTagline', 'aboutStory', 'achievements',
  'inviteNote', 'opportunityPoints', 'videoTestimonialUrl', 'displayPhone', 'displayEmail',
  'locationDisplay', 'whatsappCtaText',
].join(' ');

// Directory-safe fields for member search (no contact PII, no secrets).
const DIRECTORY_SELECT = 'username name surname profileImage jobTitle address';


// Public referral picker — safe fields only (no email/phone/password).
// GET /partners/public-search?q=ada — min 2 chars, max 8 rows.
export const searchPartnersPublic = async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    if (q.length < 2) {
      return res.status(200).json({ partners: [], success: true });
    }
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = await PartnersModel.find({
      $or: [{ username: rx }, { name: rx }, { surname: rx }],
    })
      .select('username name surname profileImage jobTitle address')
      .limit(8)
      .lean();
    const partners = (rows ?? []).map((p) => ({
      username: p.username ?? '',
      name: p.name ?? '',
      surname: p.surname ?? '',
      profileImage: p.profileImage ?? '',
      jobTitle: p.jobTitle ?? '',
      state: p.address?.state ?? '',
      city: p.address?.city ?? '',
    })).filter((p) => p.username);
    res.status(200).json({ partners, success: true });
  } catch (error) {
    res.status(500).json({ message: 'Search failed', success: false });
  }
};

// Check if a partner exists — public, but safe fields only (never secrets).
export const checkPartnerUsername = async (req, res) => {
  const { username } = req.params;
  const partner = await PartnersModel.findOne({ username }).select(PUBLIC_PROFILE_SELECT).lean();

  if (partner) {
    return res.status(200).json({partner: safePartner(partner), success: true});
  }

  res.status(404).json({
    message: "Username not found",
    code: "404",
    success: false
  });
};


// Update a partner's profile — own account only.
export const updateProfile = async (req, res) => {
  try {
    const { id, name, surname, bio, email, phone, address, dobDatePicker } =
      req.body;

    if (!requireSelf(req, res, id)) return;

    // Validate input
    if (!name || !surname || !email || !phone) {
      return res.status(400).json({
        message: "Name, surname, email, and phone are required.",
        success: false
      });
    }

    // Update fields
    const updateData = {
      name,
      surname,
      bio,
      email,
      phone,
      address,
      dobDatePicker,
    };

    const partner = await PartnersModel.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!partner) {
      return res.status(404).json({
        message: "Partner not found.",
        success: false
      });
    }

    res.status(200).json({
      message: "Partner updated successfully!",
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: "An error occurred while updating the profile.",
      success: false
    });
  }
};

// Update a partner's profession — own account only.
export const updateProfession = async (req, res) => {
  try {
    const { id, jobTitle, educationBackground, hobby, skill } = req.body;

    if (!requireSelf(req, res, id)) return;

    if (!jobTitle || !educationBackground) {
      return res.status(400).json({
        message: "Job title and education background are required.",
        success: false
      });
    }

    const updateData = { jobTitle, educationBackground, hobby, skill };

    const partner = await PartnersModel.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!partner) {
      return res.status(404).json({
        message: "Partner not found.",
        success: false
      });
    }

    res.status(200).json({
      message: "Partner's profession updated successfully!",
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      message: "An error occurred while updating the profession.",
      success: false
    });
  }
};






// Update a partner's username — own account only.
export const updateUsername = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { id, username } = req.body;

    if (!requireSelf(req, res, id)) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    if (!id || !username) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Partner ID and username are required.",
        success: false,
      });
    }

    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Username can only contain letters, numbers, and underscores.",
        success: false,
      });
    }

    const existingPartner = await PartnersModel.findOne({ username }).session(
      session
    );
    if (existingPartner && existingPartner._id.toString() !== id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        message: "This username is already in use by another partner.",
        success: false,
      });
    }

    const partner = await PartnersModel.findById(id).session(session);
    if (!partner) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Partner not found.",
        success: false,
      });
    }

    const oldUsername = partner.username;
    const updates = {};

    if (username !== partner.username) {
      updates.username = username;
    }

    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      const updateResult = await PartnersModel.updateOne(
        { _id: id },
        { $set: updates },
        { session }
      );
      //console.log("Partner Update Result:", updateResult);

      // Update related collections only if the username has changed
      if (oldUsername !== username) {
        const [prospectResult, bookingResult] = await Promise.all([
          ProspectSurveyModel.updateMany(
            { username: oldUsername },
            { $set: { username } },
            { session }
          ),
          BookingModel.updateMany(
            { username: oldUsername },
            { $set: { username } },
            { session }
          ),
        ]);
        //console.log("Prospect Survey Updates:", prospectResult);
        //console.log("Booking Updates:", bookingResult);
      }
    } else {
      //console.log("No changes to the username detected.");
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: "Username updated successfully!",
      success: true,
    });
  } catch (error) {
    //console.error("Error updating username:", error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      error: error.message,
      message: "An error occurred while updating the username.",
      success: false,
    });
  }
};






// Change a partner's password — own account only (current password verified).
export const changePassword = async (req, res) => {
  const { id, currentPassword, newPassword } = req.body;

  if (!requireSelf(req, res, id)) return;

  if (!id || !currentPassword || !newPassword) {
    return res.status(400).json({
      message: "Partner ID, current password, and new password are required.",
      success: false,
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      message: "New password must be at least 8 characters long.",
      success: false,
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      message: "Current password and new password cannot be the same.",
      success: false,
    });
  }

  try {
    const partner = await PartnersModel.findById(id);
    if (!partner) {
      return res.status(404).json({
        message: "Partner not found.",
        success: false,
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, partner.password);
    if (!isMatch) {
      return res.status(401).json({
        message: "Current password is incorrect.",
        success: false,
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    const updates = {};
    if (hashedNewPassword !== partner.password) {
      updates.password = hashedNewPassword;
    }

    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      const updateResult = await PartnersModel.updateOne(
        { _id: id },
        { $set: updates }
      );
      //console.log("Password Update Result:", updateResult);

      res.status(200).json({
        message: "Password changed successfully!",
        success: true,
      });
    } else {
      //console.log("New password is the same as the current password (after hashing). No update needed.");
      res.status(200).json({
        message: "Password changed successfully!", // Still report success as the intent was met
        success: true,
      });
    }
  } catch (error) {
    //console.error("Error changing password:", error);
    res.status(500).json({
      error: error.message,
      message: "An error occurred while changing the password.",
      success: false,
    });
  }
};




// Member directory — authenticated members only, safe fields, capped.
export const getAllUsers = async (req, res) => {
  try {
    const partners = await PartnersModel.find()
      .select(DIRECTORY_SELECT)
      .limit(500)
      .lean();
    res.status(200).json(partners.map(safePartner));
  } catch (error) {
    res.status(500).json({ 
      message: "Internal server error",
      success: false
    });
  }
};

// Get partner by name and/or surname — authenticated, directory-safe fields.
export const getPartnerByNames = async (req, res) => {
  const { name, surname } = req.params;
  try {
    const trimmedName = name ? name.trim() : "";
    const trimmedSurname = surname ? surname.trim() : "";

    const query = {};
    if (trimmedName) query.name = trimmedName;
    if (trimmedSurname) query.surname = trimmedSurname;

    const partners = await PartnersModel.find(query).select(DIRECTORY_SELECT).limit(50).lean();

    if (!partners || partners.length === 0) {
      return res.status(404).json({ 
        message: "Partner not found",
        success: false
      });
    }
    res.status(200).json({
      message: "Partner(s) found",
      data: partners.map(safePartner),
      success: true
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Internal server error",
      success: false 
    });
  }
};

// Get partner by name — authenticated, directory-safe fields.
export const getPartnerByName = async (req, res) => {
  const { name } = req.params;
  try {
    const trimmedName = name ? name.trim() : "";
    const capitalizedTrimmedName = trimmedName.charAt(0).toUpperCase() + trimmedName.slice(1);

    if (!capitalizedTrimmedName) {
      return res.status(400).json({ 
        message: "Name is required.",
        success: false 
      });
    }

    const query = { $or: [{ name: capitalizedTrimmedName }, { surname: capitalizedTrimmedName }] };
    const partners = await PartnersModel.find(query).select(DIRECTORY_SELECT).limit(50).lean();

    if (!partners || partners.length === 0) {
      return res.status(404).json({ message: "Partner not found", success: false });
    }
    res.status(200).json({
      message: "Partner(s) found",
      data: partners.map(safePartner),
      success: true
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error", success: false });
  }
};

// Follow a partner — the follower must be the session owner.
export const followPartner = async (req, res) => {
  try {
    const { searchPartnerId } = req.params;
    const partnerId = req.body.partnerId;

    if (!searchPartnerId) {
      return res.status(400).json({ message: "Missing required parameter: searchPartnerId", success: false });
    }
    if (!partnerId || String(partnerId) !== sessionId(req)) {
      return res.status(403).json({ message: "You can only follow as yourself", success: false });
    }

    const partnerToFollow = await PartnersModel.findById(searchPartnerId);
    if (!partnerToFollow) {
      return res.status(404).json({ message: "Partner not found", success: false });
    }

    if (!partnerToFollow.followers.includes(partnerId)) {
      partnerToFollow.followers.push(partnerId);
      await partnerToFollow.save();
      return res.status(200).json({ message: "Successfully followed the partner", success: true });
    }

    return res.status(400).json({ message: "You are already following this partner", success: false });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message, success: false });
  }
};

// Unfollow a partner — the follower must be the session owner.
export const unfollowPartner = async (req, res) => {
  try {
    const { searchPartnerId } = req.params;
    const partnerId = req.body.partnerId;

    if (!searchPartnerId || !partnerId) {
      return res.status(400).json({ message: "Missing required parameters", success: false });
    }
    if (String(partnerId) !== sessionId(req)) {
      return res.status(403).json({ message: "You can only unfollow as yourself", success: false });
    }

    const partnerToUnfollow = await PartnersModel.findById(searchPartnerId);
    if (!partnerToUnfollow) {
      return res.status(404).json({ message: "Partner not found", success: false });
    }

    if (partnerToUnfollow.followers.includes(partnerId)) {
      partnerToUnfollow.followers = partnerToUnfollow.followers.filter(
        (followerId) => followerId.toString() !== partnerId.toString()
      );
      await partnerToUnfollow.save();
      return res.status(200).json({ message: "Successfully unfollowed the partner", success: true });
    }

    return res.status(400).json({ message: "You are not following this partner", success: false });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message, success: false });
  }
};

// Check follow status
export const checkFollowStatus = async (req, res) => {
  try {
    const { searchPartnerId, partnerId } = req.params;

    if (!searchPartnerId || !partnerId) {
      return res.status(400).json({ message: "Missing required parameters", success: false });
    }

    const partner = await PartnersModel.findById(searchPartnerId);
    if (!partner) {
      return res.status(404).json({ message: "Partner not found", success: false });
    }

    const isFollowing = partner.followers.includes(partnerId);

    return res.status(200).json({ isFollowing, success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message, success: false });
  }
};

// Update partner's social media links — own account only.
const updateSocialMediaLink = async (req, res, platform, field) => {
  try {
    const { url, partnerId } = req.body;
    if (!requireSelf(req, res, partnerId)) return;
    const updateData = { [field]: url };

    const partner = await PartnersModel.findByIdAndUpdate(partnerId, updateData, { new: true });
    if (!partner) {
      return res.status(404).json({ message: `Partner not found`, success: false });
    }

    res.status(200).json({ message: "Partner updated successfully!", data: safePartner(partner), success: true });
  } catch (error) {
    res.status(500).json({ error: error.message, message: "Error updating social link", success: false });
  }
};

// Social media update handlers
export const updateWhatsappGroupLink = (req, res) => updateSocialMediaLink(req, res, "whatsappGroupLink", "whatsappGroupLink");
export const updateWhatsappChatLink = (req, res) => updateSocialMediaLink(req, res, "whatsappChatLink", "whatsappChatLink");
export const updateFacebookPage = (req, res) => updateSocialMediaLink(req, res, "facebookPage", "facebookPage");
export const updateLinkedinPage = (req, res) => updateSocialMediaLink(req, res, "linkedinPage", "linkedinPage");
export const updateYoutubePage = (req, res) => updateSocialMediaLink(req, res, "youtubePage", "youtubePage");
export const updateInstagramPage = (req, res) => updateSocialMediaLink(req, res, "instagramPage", "instagramPage");
export const tiktokPage = (req, res) => updateSocialMediaLink(req, res, "tiktokPage", "tiktokPage");
export const twitterPage = (req, res) => updateSocialMediaLink(req, res, "twitterPage", "twitterPage");

// Update Testimonial — own account only.
export const updateTestimonial = async (req, res) => {
  try {
    const { testimonial, partnerId } = req.body;

    // Validate input
    if (!testimonial || !partnerId) {
      return res.status(400).json({
        message: "Testimonial and partnerId are required.",
        success: false
      });
    }
    if (!requireSelf(req, res, partnerId)) return;

    // Create an object with the field you want to update
    const updateData = { testimonial };

    // Update partner's testimonial
    const partner = await PartnersModel.findByIdAndUpdate(
      partnerId,
      updateData,
      { new: true }
    );

    // Check if partner exists
    if (!partner) {
      return res.status(404).json({
        message: `Partner not found.`,
        success: false
      });
    }

    res.status(200).json({
      message: "Partner updated successfully!",
      data: safePartner(partner),
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: "An error occurred while updating the testimonial.",
      error: error.message,
      success: false
    });
  }
};

// Update public one-pager content (/:partnerUsername) — single allowlisted
// write so the Landing page editor saves atomically. All fields optional
// except partnerId; empty strings clear, undefined leaves untouched.
export const updateLandingPage = async (req, res) => {
  try {
    const { partnerId, ...rest } = req.body || {};
    if (!partnerId) {
      return res.status(400).json({
        message: "partnerId is required.",
        success: false
      });
    }
    if (!requireSelf(req, res, partnerId)) return;
    const ALLOWED = [
      'headline', 'subHeadline', 'heroBadge', 'businessTagline',
      'aboutStory', 'achievements', 'inviteNote', 'opportunityPoints',
      'videoTestimonialUrl', 'displayPhone', 'displayEmail',
      'locationDisplay', 'whatsappCtaText', 'testimonial',
      'jobTitle', 'bio',
      'whatsappGroupLink', 'whatsappChatLink',
      'facebookPage', 'linkedinPage', 'youtubePage',
      'instagramPage', 'tiktokPage', 'twitterPage',
    ];
    const updateData = {};
    for (const key of ALLOWED) {
      if (rest[key] === undefined) continue;
      if (key === 'opportunityPoints' && Array.isArray(rest[key])) {
        updateData[key] = rest[key].map((s) => String(s).slice(0, 200)).filter((s) => s.trim()).slice(0, 8);
      } else if (typeof rest[key] === 'string') {
        updateData[key] = rest[key].trim() === '' ? '' : rest[key].trim();
      } else {
        updateData[key] = rest[key];
      }
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        message: "Nothing to update.",
        success: false
      });
    }
    const partner = await PartnersModel.findByIdAndUpdate(partnerId, updateData, { new: true });
    if (!partner) {
      return res.status(404).json({ message: "Partner not found.", success: false });
    }
    res.status(200).json({
      message: "Landing page updated successfully!",
      data: safePartner(partner),
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: "An error occurred while updating the landing page.",
      error: error.message,
      success: false
    });
  }
};

// Get all partners of a given partner user — owner, upline or admin.
export const getPartnersOf = async (req, res) => {
  try {
    const { partnerId } = req.params;

    // Validate partnerId
    if (!partnerId) {
      return res.status(400).json({
        message: "partnerId is required.",
        success: false
      });
    }
    try {
      await guard.requireListAccess(sessionId(req), partnerId);
    } catch (err) {
      return res.status(err.statusCode ?? 403).json({ message: err.message, success: false });
    }

    // Find all partners where partnerOf matches the provided partnerId.
    // An empty downline is a healthy state (brand-new partners start here),
    // not a 404 — the clients render their activation CTA from this page.
    const partners = await PartnersModel.find({ partnerOf: partnerId }).exec();

    res.status(200).json({
      message: partners.length === 0
        ? "No partners yet — share a reservation code to grow this downline."
        : "Partners retrieved successfully!",
      data: partners.map(safePartner),
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: "An error occurred while fetching partners.",
      error: error.message,
      success: false
    });
  }
};

// Get a partner by ID — owner, upline or admin; secrets stripped.
export const getPartnerById = async (req, res) => {
  try {
    const { partnerId } = req.params;

    // Validate partnerId
    if (!partnerId) {
      return res.status(400).json({
        message: "partnerId is required.",
        success: false
      });
    }
    try {
      await guard.requireListAccess(sessionId(req), partnerId);
    } catch (err) {
      return res.status(err.statusCode ?? 403).json({ message: err.message, success: false });
    }

    // Find the partner by ID
    const partner = await PartnersModel.findById(partnerId);

    // Check if partner exists
    if (!partner) {
      return res.status(404).json({
        message: "Partner not found.",
        success: false
      });
    }

    res.status(200).json({
      message: "Partner retrieved successfully!",
      data: safePartner(partner),
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: "An error occurred while fetching the partner.",
      error: error.message,
      success: false
    });
  }
};  

