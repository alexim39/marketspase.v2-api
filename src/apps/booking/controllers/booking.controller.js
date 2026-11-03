import { BookingModel } from "../models/booking.model.js";
import { sendEmail } from "../../../services/emailService.js";
import { PartnersModel } from './../../partner/models/partner.model.js';
import { ProspectModel } from '../../prospect/models/prospect.model.js';
import { EmailSubscriptionModel } from "../../email-subscription/models/email-subscription.model.js";
import { ownerEmailTemplate } from "../services/email/ownerTemplate.js";
import { userNotificationEmailTemplate } from "../services/email/userTemplate.js";
import { buildPartnerAccess } from '../../../modules/crm/application/Prospect.access.js';

// Ownership guard: bookings key off the owner's `username`. Reads + status
// need owner/upline/admin; deletes need owner/admin. Submit stays
// partner-authenticated (attribution rides the form's username).
const guard = buildPartnerAccess({
  findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean().catch(() => null),
});
const deny = (res, err) => res.status(err?.statusCode ?? 403).json({ message: err?.message ?? 'Forbidden', success: false });

// Resolve a booking's owning partner id from its `username` (null = orphan).
const ownerIdOf = async (booking) => {
  if (!booking?.username) return null;
  const owner = await PartnersModel.findOne({ username: booking.username }).select('_id').lean().catch(() => null);
  return owner ? String(owner._id) : null;
};

// Pipeline order for forward-only advances (terminal stages never touched).
const STAGE_RANK = { New: 0, Contacted: 1, Interested: 2, 'In Negotiation': 3, Converted: 4, Closed: 4 };

/**
 * Advance a prospect forward-only (never backward, never out of terminal).
 * Best-effort: all failures resolve null so booking flows never break.
 */
const advanceProspect = async (prospectId, to, note) => {
  try {
    if (!prospectId || !STAGE_RANK[to]) return null;
    const current = await ProspectModel.findById(prospectId).select('status.stage').lean().catch(() => null);
    if (!current) return null;
    const from = current?.status?.stage ?? null;
    if (from === 'Converted' || from === 'Closed') return null;
    if (from && (STAGE_RANK[from] ?? -1) >= STAGE_RANK[to]) return null;
    const at = new Date();
    await ProspectModel.findByIdAndUpdate(prospectId, {
      $set: {
        'status.stage': to,
        'status.stageEnteredAt': at,
        'status.updatedAt': at,
        ...(note ? { 'status.note': String(note).slice(0, 2000) } : {}),
      },
      $push: { stageHistory: { from, to, at } },
    }).catch(() => null);
    return { from, to };
  } catch { return null; }
};

/** Resolve a prospect for a booking: explicit id first, phone fallback. */
const resolveProspectId = async (prospectId, ownerPartnerId, phone) => {
  if (prospectId) {
    const hit = await ProspectModel.findById(prospectId).select('_id').lean().catch(() => null);
    if (hit) return String(hit._id);
  }
  if (!ownerPartnerId || !phone) return null;
  const docs = await ProspectModel.find({ partnerId: ownerPartnerId }).select('prospectPhone').lean().catch(() => []);
  const norm = String(phone).replace(/\D/g, '');
  const hit = (docs ?? []).find((d) => String(d.prospectPhone ?? '').replace(/\D/g, '') === norm);
  return hit ? String(hit._id) : null;
};

// User survey form
export const SessionBookingController = async (req, res) => {
  try {
    const {
      reason,
      description,
      referralCode,
      consultDate,
      consultTime,
      contactMethod,
      referral,
      phone,
      email,
      name,
      surname,
      userDevice,
      username,
      prospectId
    } = req.body;

    // Check for required fields — email is optional (not all prospects share it),
    // phone is the primary contact key. Username is required to attribute the booking.
    if (!consultDate || !consultTime || !phone || !username) {
      return res.status(400).json({
        message: "Missing required booking information.",
        success: false
      });
    }

    // Prevent duplicate booking for the same user at the same date/time
    // (only compare non-empty identifiers — blank emails must not collide).
    const or = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    let existingBooking = null;
    if (or.length > 0) {
      existingBooking = await BookingModel.findOne({
        $or: or,
        consultDate: consultDate,
        consultTime: consultTime
      });
    }

    if (existingBooking) {
      return res.status(400).json({
        message: "You have already booked a session for this date and time.",
        success: false
      });
    }

    // Create the booking (pipeline link rides along when the booker came from a prospect page).
    const userBooking = await BookingModel.create({
      reason,
      description,
      referralCode,
      consultDate,
      consultTime,
      contactMethod,
      referral,
      phone,
      email,
      name,
      surname,
      userDevice,
      username,
      prospectId: prospectId ?? null,
      // status: 'Scheduled',
    });

    // Pipeline link — a booked presentation moves the prospect to Interested
    // (forward-only; terminal/advanced stages untouched). Best-effort.
    try {
      const owner = prospectId ? null : await PartnersModel.findOne({ username }).select('_id').lean().catch(() => null);
      const pid = await resolveProspectId(prospectId, owner ? String(owner._id) : null, phone);
      if (pid) {
        if (!userBooking.prospectId) {
          await BookingModel.findByIdAndUpdate(userBooking._id, { $set: { prospectId: pid } }).catch(() => null);
        }
        await advanceProspect(pid, 'Interested', `Presentation scheduled for ${consultDate ?? ''} ${consultTime ?? ''}`.trim());
      }
    } catch { /* pipeline sync never fails the booking */ }

    // Find the user by username (for owner notification — best-effort)
    const partner = await PartnersModel.findOne({ username });

    // Send emails best-effort — a mail failure must never turn a saved booking into a 500.
    try {
      if (partner?.email) {
        const ownerSubject = "Notification for One-on-One Session Booking";
        const ownerMessage = ownerEmailTemplate(userBooking);
        await sendEmail(partner.email, ownerSubject, ownerMessage);
      }
    } catch (e) { console.warn('[booking] owner email failed:', e?.message ?? e); }

    try {
      if (userBooking.email) {
        const userSubject = "Your Session Booking is Confirmed – Let’s Talk Business!";
        const userMessage = userNotificationEmailTemplate(userBooking);
        await sendEmail(userBooking.email, userSubject, userMessage);
      }
    } catch (e) { console.warn('[booking] prospect email failed:', e?.message ?? e); }

    if (!partner) {
      // Booking is already saved — surface as success with a hint, not a 404 that looks like a failure.
      return res.status(200).json({
        message: 'Session booked, but owner account was not found for notification.',
        success: true
      });
    }

    res.status(200).json({
      message: 'Session has been successfully booked. Ensure to meet with prospect on time!',
      success: true
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      error: error.message,
      message: "Error creating booking",
      success: false
    });
  }
};

// Get all booking for partner — owner, upline or admin.
export const getBookingsForPartner = async (req, res) => {
  try {
    const { createdBy } = req.params;

    try {
      await guard.requireListAccess(req.auth?.partnerId, createdBy);
    } catch (err) {
      return deny(res, err);
    }

    // Step 1: Find the user and get username
    const partner = await PartnersModel.findById(createdBy);
    if (!partner) {
      return res.status(404).json({ 
        message: "User not found",
        success: false,
      });
    }

    /// Step 2: user found username to get user from BookingModel collection
    const prospectObject = await BookingModel.find({
      username: partner.username,
    });

    if (!prospectObject) {
      return res.status(400).json({ 
        message: "Prospects not found",
        success: false,
      });
    }

    res.status(200).json({
      message: "Prospects retrieved successfully!",
      data: prospectObject,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error retrieving Ads",
      error: error.message,
      success: false,
    });
  }
};

// delete booking — owner or admin only.
export const deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await BookingModel.findById(id);

    // Check if the boooking exists
    if (!booking) {
      return res.status(404).json({
        message: "Booking not found",
        success: false,
      });
    }

    try {
      await guard.requireOwnerId(req.auth?.partnerId, await ownerIdOf(booking), 'delete this booking');
    } catch (err) {
      return deny(res, err);
    }

    // Here we delete the survey entry
    await BookingModel.findByIdAndDelete(id);

    res.status(200).json({
      message: "Booking deleted successfully!",
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting survey",
      error: error.message,
      success: false,
    });
  }
};

// Booking update — owner, upline (support) or admin.
export const UpdateBooking = async (req, res) => {
    try {
      const { body } = req;
      if (body?.id) {
        try {
          const current = await BookingModel.findById(body.id).select('username').lean().catch(() => null);
          if (!current) {
            return res.status(404).json({
              message: "Booking not found",
              success: false,
            });
          }
          await guard.requireListAccess(req.auth?.partnerId, await ownerIdOf(current));
        } catch (err) {
          return deny(res, err);
        }
      }
      const updatedBooking = await BookingModel.findByIdAndUpdate(
        body.id,
        {
          status: body.sessionStatus,
          description: body.sessionRemark,
        },
        { new: true, runValidators: true } // new: true returns the updated document
      );

      // Pipeline link — a held presentation moves the prospect to In
      // Negotiation (forward-only). All other outcomes leave the stage
      // alone (the remark is mirrored to the timeline client-side).
      // Best-effort, never fails the update.
      try {
        if (body.sessionStatus === 'Completed' && updatedBooking) {
          let pid = updatedBooking.prospectId ? String(updatedBooking.prospectId) : null;
          if (!pid) {
            const oid = await ownerIdOf(updatedBooking);
            pid = await resolveProspectId(null, oid, updatedBooking.phone);
            if (pid) {
              await BookingModel.findByIdAndUpdate(body.id, { $set: { prospectId: pid } }).catch(() => null);
            }
          }
          if (pid) await advanceProspect(pid, 'In Negotiation', 'Presentation held — outcome recorded');
        }
      } catch { /* pipeline sync never fails the update */ }
  
      if (!updatedBooking) {
        return res.status(404).json({ 
          message: "Booking not found",
          success: false,
        });
      }
  
      res.status(200).json({
        updatedBooking, 
        success: true
      });
    } catch (error) {
      res.status(400).json({ 
        message: error.message,
        success: false,
      });
    }
};

// get partner email list — owner, upline or admin (PII harvest guard).
export const getPartnerEmailList = async (req, res) => {
  try {
    const { createdBy } = req.params;

    try {
      await guard.requireListAccess(req.auth?.partnerId, createdBy);
    } catch (err) {
      return deny(res, err);
    }
  
      // Step 1: Find the user and get username
      const partner = await PartnersModel.findById(createdBy);
      if (!partner) {
        return res.status(404).json({ 
          message: "User not found",
          success: false,
        });
      }
  
      /// Step 2: user found username to get user from emailListObject collection
      const emailListObject = await EmailSubscriptionModel.find({
        username: partner.username,
      });
  
      if (!emailListObject) {
        return res.status(400).json({ 
          message: "Email list not found",
          success: false,
        });
      }
  
      res.status(200).json({
        message: "Email list retrieved successfully!",
        data: emailListObject,
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        message: "Error retrieving Ads",
        error: error.message,
        success: false,
      });
    }
  };
