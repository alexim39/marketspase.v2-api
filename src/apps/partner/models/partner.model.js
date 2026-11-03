import mongoose from 'mongoose';

/* Schema partners */
const partnersSchema = mongoose.Schema(
  {
    username: {
      type: String,
      unique: true,
      required: [true, "Please enter response for username"]
    },
    name: {
      type: String,
      required: [true, "Please enter name"]
    },
    surname: {
      type: String,
      required: [true, "Please enter surname"]
    },
    address: {
      type: {
        street: { type: String },
        city: { type: String },
        state: { type: String },
        country: { 
          type: String,
          default: 'Nigeria'
        },
      },
    },
    email: {
      type: String,
      unique: true,
      lowercase: true,
      required: [true, "Please enter email address"]
    },
    phone: {
      type: String,
      unique: true,
      required: [true, "Please enter phone number"]
    },
    reservationCode: {
      type: String,
    },
    emailVerified: {
      type: Boolean,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    emailVerificationTokenHash: {
      type: String,
      select: false,
      default: undefined,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
      default: undefined,
    },
    accountState: {
      type: String,
      enum: ['member', 'partner'],
      default: 'partner',
    },
    kycStatus: {
      type: String,
      enum: ['not_started', 'pending', 'verified', 'rejected'],
      default: 'not_started',
    },
    kycSubmittedAt: { type: Date, default: null },
    kycVerifiedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    activationOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActivationOrder',
      default: null,
    },
    placementParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      default: null,
    },
    placementCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GrowthCampaign',
      default: null,
    },
    placedAt: { type: Date, default: null },
    password: {
      type: String,
      required: [true, "Please enter password"]
    },
    tnc: {
      type: Boolean,
      default: false
    },
    status: {
      type: Boolean,
      default: false
    },
    bio: {
      type: String,
    },
    partnerOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      // Legacy rows stored "" here, which fails ObjectId casting on every
      // document save (broke wallet charges outright). Normalize to unset.
      set: (v) => (v === '' || v === null ? undefined : v),
    },  
    visits: {
      type: Number,
      default: 0
    }, 
    dobDatePicker: {
      type: Date
    },
    // Derived calendar parts for indexed birthday lookup (R6 follow-up).
    // Maintained by schema hooks below + one-shot backfill — never set directly.
    dobMonth: {
      type: Number, min: 1, max: 12,
    },
    dobDay: {
      type: Number, min: 1, max: 31,
    },
    balance: {
      type: Number,
      default: 0,
    },
    profileImage: {
      type: String,
    },
    jobTitle: {
      type: String,
    },
    educationBackground: {
      type: String,
    },
    hobby: {
      type: String,
    },
    skill: {
      type: String,
    },
    role: {
      type: String,
      default: 'User'
    },
    commissionRank: {
      type: String,
      enum: ['Partner', 'Builder', 'Leader', 'Ambassador'],
      default: 'Partner',
    },
    permissions: {
      type: [String],
      default: [],
    },
    // Admin suspension — set only via PATCH /v1/admin/partners/:id/suspend.
    // Suspended partners fail signin and session checks; existing JWTs die
    // at expiry (24h) at the latest.
    suspendedAt: {
      type: Date,
      default: null,
    },
    suspendReason: {
      type: String,
      default: null,
    },
    // Self-service erasure (GDPR): request stamp, scheduled execution, and
    // the 48h-reminder stamp. Account stays fully functional until the sweep
    // job executes; cancellation clears all three. Never set directly —
    // only via POST/DELETE /v1/auth/me/erasure and the erasure-due job.
    eraseRequestedAt: {
      type: Date,
      default: null,
    },
    eraseScheduledFor: {
      type: Date,
      default: null,
    },
    eraseReminderAt: {
      type: Date,
      default: null,
    },
    whatsappGroupLink: {
      type: String,
    },
    whatsappChatLink: {
      type: String,
    },
    testimonial: {
      type: String,
    },
    facebookPage: {
      type: String,
    },
    linkedinPage: {
      type: String,
    },
    youtubePage: {
      type: String,
    },
    instagramPage: {
      type: String,
    },
    tiktokPage: {
      type: String,
    },
    twitterPage: {
      type: String,
    },
    // Public one-pager (/:partnerUsername) content — all optional, edited in
    // Partner → Settings → Landing page. Flat + nullable so legacy rows
    // without these fields keep working.
    headline: {
      type: String,
      maxlength: 140,
    },
    subHeadline: {
      type: String,
      maxlength: 300,
    },
    heroBadge: {
      type: String,
      maxlength: 80,
    },
    businessTagline: {
      type: String,
      maxlength: 140,
    },
    aboutStory: {
      type: String,
      maxlength: 2000,
    },
    achievements: {
      type: String,
      maxlength: 1000,
    },
    inviteNote: {
      type: String,
      maxlength: 1000,
    },
    opportunityPoints: {
      type: [String],
      default: undefined,
    },
    videoTestimonialUrl: {
      type: String,
    },
    displayPhone: {
      type: String,
    },
    displayEmail: {
      type: String,
    },
    locationDisplay: {
      type: String,
      maxlength: 120,
    },
    whatsappCtaText: {
      type: String,
      maxlength: 140,
    },
    followers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner'
    }],
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: String,
    },
    // Login telemetry (admin Member 360) — stamped on signin, cleared on
    // signout. Absent on pre-tracking rows: the UI says "never seen".
    lastLoginAt: {
      type: Date,
      default: null,
      index: true,
    },    lastLoginIp: {
      type: String,
      default: null,
    },
    lastLoginAgent: {
      type: String,
      default: null,
    },
    loginCount: {
      type: Number,
      default: 0,
    },
    // Dormant-nudge guard — stamped when the 3-day inactivity email fires.
    // One-time per account: the job skips stamped rows forever.
    dormantNudgeAt: {
      type: Date,
      default: null,
    },
    // Presence heartbeat — stamped on signin + throttled app ping while the
    // dashboard is open. Powers the admin "Online now" pill. Null = offline.
    lastSeenAt: {
      type: Date,
      default: null,
      index: true,
    },
    subscription: {
      status: { 
        type: String, 
        required: true,
        default: 'expired'
      },//"active | cancelled | expired",
      plan: { 
        type: String, 
        required: true,
        default: 'Basic'
      },//"Basic | Premium | Business",
      nextBillingDate: { type: Date },
    },
    settings: {
      notification: {
        send: {
          type: String,
          required: true,
          default: 'email', // "email" | "sms" | "both"
          enum: ['email', 'sms', 'both', 'off']
        },
        receive: {
          type: String,
          required: true,
          default: 'email', // "email" | "sms" | "both"
          enum: ['email', 'sms', 'both', 'off']
        }
      }
    },
  },
  {
    timestamps: true
  }
);

/**
 * Pure calendar-part extraction (server-local month/day — the same basis
 * the birthday job queries on). Exported for the job, the backfill and tests.
 * @returns {{dobMonth: number|null, dobDay: number|null}}
 */
export const dobParts = (dob) => {
  if (dob === undefined || dob === null || (typeof dob === 'string' && dob.trim() === '')) {
    return { dobMonth: null, dobDay: null };
  }
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime())) return { dobMonth: null, dobDay: null };
  return { dobMonth: d.getMonth() + 1, dobDay: d.getDate() };
};

/** Document-save path (create + .save()). Testable without Mongo. */
export const applyDobSave = (doc) => {
  if (typeof doc.isModified === 'function' && !doc.isModified('dobDatePicker')) return false;
  const { dobMonth, dobDay } = dobParts(doc.dobDatePicker);
  doc.dobMonth = dobMonth ?? undefined;
  doc.dobDay = dobDay ?? undefined;
  return true;
};

/**
 * Query-update path (findOneAndUpdate / findByIdAndUpdate — the only live
 * writer is legacy updateProfile). Handles `$set` and top-level shapes.
 * Absent key (incl. explicit `undefined`, which Mongoose strips) leaves
 * derived fields alone; null/invalid clears them.
 */
export const applyDobUpdate = (update) => {
  if (!update || typeof update !== 'object') return false;
  const set = update.$set && typeof update.$set === 'object' ? update.$set : null;
  const raw = set && 'dobDatePicker' in set
    ? set.dobDatePicker
    : ('dobDatePicker' in update ? update.dobDatePicker : undefined);
  if (raw === undefined) return false;
  const target = set ?? update;
  const { dobMonth, dobDay } = dobParts(raw);
  if (dobMonth == null) {
    delete target.dobMonth;
    delete target.dobDay;
    const unset = update.$unset && typeof update.$unset === 'object' ? update.$unset : {};
    update.$unset = { ...unset, dobMonth: 1, dobDay: 1 };
  } else {
    target.dobMonth = dobMonth;
    target.dobDay = dobDay;
    if (update.$unset && typeof update.$unset === 'object') {
      delete update.$unset.dobMonth;
      delete update.$unset.dobDay;
    }
  }
  return true;
};

partnersSchema.pre('save', function () { applyDobSave(this); });
partnersSchema.pre('findOneAndUpdate', function () { applyDobUpdate(this.getUpdate() ?? {}); });

/* Model */
export const PartnersModel = mongoose.models.Partner ?? mongoose.model('Partner', partnersSchema);
