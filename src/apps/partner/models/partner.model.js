import mongoose from 'mongoose';
import { open, seal } from '../../../shared/security/fieldCrypto.js';

const ADDRESS_FIELDS = ['street', 'city', 'state', 'country'];

const sealAddress = (address) => {
  if (!address || typeof address !== 'object') return address;
  for (const key of ADDRESS_FIELDS) {
    if (address[key] !== undefined && address[key] !== null && address[key] !== '') {
      address[key] = seal(address[key]);
    }
  }
  return address;
};

const openAddress = (address) => {
  if (!address || typeof address !== 'object') return address;
  for (const key of ADDRESS_FIELDS) {
    if (address[key]) address[key] = open(address[key]);
  }
  return address;
};

const sealAddressUpdate = (update) => {
  if (!update || typeof update !== 'object') return;
  for (const container of [update, update.$set, update.$setOnInsert]) {
    if (!container || typeof container !== 'object') continue;
    if (container.address && typeof container.address === 'object') {
      sealAddress(container.address);
    }
    for (const key of Object.keys(container)) {
      if (!key.startsWith('address.')) continue;
      const value = container[key];
      if (value !== undefined && value !== null && value !== '') {
        container[key] = seal(value);
      }
    }
  }
};

/* Schema partners */
const partnersSchema = mongoose.Schema(
  {
    username: {
      type: String,
      unique: true,
      required: [true, "Please enter response for username"]
    },
    /**
     * Canonical public store slug. Set when the store is first created and
     * kept in sync if an admin changes it; links use this, never the username.
     */
    storeSlug: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
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
        street: { type: String, get: open, set: seal },
        city: { type: String, get: open, set: seal },
        state: { type: String, get: open, set: seal },
        country: {
          type: String,
          default: 'Nigeria',
          get: open,
          set: seal,
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
    // Acquisition attribution — growth campaign tracking code (gc_...).
    campaignCode: {
      type: String,
      trim: true,
      default: null,
      index: true,
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
    mentorContactPreference: {
      type: String,
      enum: ['in_app', 'email', 'whatsapp', 'phone', 'prefer_not_now'],
      default: 'in_app',
    },
    mentorContactConsentAt: { type: Date, default: null },
    mentorContactPreferenceUpdatedAt: { type: Date, default: null },
    activationOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActivationOrder',
      default: null,
    },
    placementCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GrowthCampaign',
      default: null,
    },
    placedAt: { type: Date, default: null },
    /**
     * True when no valid sponsor owns this account yet. System-owned members
     * are the only ones campaign allocation may place under a campaign owner.
     * A referred member has partnerOf set and is never reallocated.
     */
    systemOwned: { type: Boolean, default: false, index: true },
    /** Raw referral username captured at signup, kept for audit/reporting. */
    referralCode: { type: String, default: null, trim: true, maxlength: 80 },
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
      type: String,
      get: open,
      set: seal,
    },
    // Derived calendar parts for indexed birthday lookup (R6 follow-up).
    // Maintained by schema hooks below + one-shot backfill — never set directly.
    dobMonth: {
      type: Number, min: 1, max: 12,
    },
    dobDay: {
      type: Number, min: 1, max: 31,
    },
    // One birthday greeting per channel per calendar year. The job stores the
    // year only after a successful send so a failed email can still retry.
    birthdayGreetingYear: { type: Number, default: null },
    birthdayGreetingSentAt: { type: Date, default: null },
    birthdayEmailYear: { type: Number, default: null },
    birthdayEmailSentAt: { type: Date, default: null },
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
      type: [String],
      default: [],
    },
    skill: {
      type: [String],
      default: [],
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
    // Rank source: auto = mirrored from the journey/training ladder;
    // admin = temporary or permanent manual override. Commission depth reads
    // commissionRank, so every rank change is written to partner_rank_history.
    commissionRankSource: {
      type: String,
      enum: ['auto', 'admin'],
      default: 'auto',
    },
    commissionRankReason: {
      type: String,
      default: '',
      trim: true,
    },
    commissionRankOverrideUntil: {
      type: Date,
      default: null,
    },
    commissionRankUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },
    commissionRankUpdatedAt: {
      type: Date,
      default: null,
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
    timestamps: true,
    toObject: { getters: true },
    toJSON: { getters: true },
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
const dobText = (value) => {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '').trim();
};

export const applyDobSave = (doc) => {
  if (typeof doc.isModified === 'function' && !doc.isModified('dobDatePicker')) return false;
  const raw = typeof doc.get === 'function'
    ? doc.get('dobDatePicker', null, { getters: false })
    : doc.dobDatePicker;
  const plain = open(raw);
  const { dobMonth, dobDay } = dobParts(plain);
  doc.dobMonth = dobMonth ?? undefined;
  doc.dobDay = dobDay ?? undefined;
  if (plain !== undefined && plain !== null && String(plain).trim() !== '') {
    doc.dobDatePicker = dobText(plain);
  } else {
    doc.dobDatePicker = null;
  }
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
  const plain = open(raw);
  const { dobMonth, dobDay } = dobParts(plain);
  if (dobMonth == null) {
    target.dobDatePicker = null;
    delete target.dobMonth;
    delete target.dobDay;
    const unset = update.$unset && typeof update.$unset === 'object' ? update.$unset : {};
    update.$unset = { ...unset, dobMonth: 1, dobDay: 1 };
  } else {
    target.dobDatePicker = seal(dobText(plain));
    target.dobMonth = dobMonth;
    target.dobDay = dobDay;
    if (update.$unset && typeof update.$unset === 'object') {
      delete update.$unset.dobMonth;
      delete update.$unset.dobDay;
    }
  }
  return true;
};

export const sealPartnerUpdate = (update) => {
  sealAddressUpdate(update);
  applyDobUpdate(update);
};

const openLeanPartnerAddress = (doc) => {
  if (doc && !doc.$__) openAddress(doc.address);
};

partnersSchema.pre('save', function () {
  if (this.address) sealAddress(this.address);
  applyDobSave(this);
});
partnersSchema.pre('findOneAndUpdate', function () { sealPartnerUpdate(this.getUpdate() ?? {}); });
partnersSchema.pre('updateOne', function () { sealPartnerUpdate(this.getUpdate() ?? {}); });
partnersSchema.pre('updateMany', function () { sealPartnerUpdate(this.getUpdate() ?? {}); });
partnersSchema.post('find', function (docs) {
  for (const doc of docs ?? []) openLeanPartnerAddress(doc);
});
partnersSchema.post('findOne', openLeanPartnerAddress);
partnersSchema.post('findOneAndUpdate', openLeanPartnerAddress);

/* Model */
export const PartnersModel = mongoose.models.Partner ?? mongoose.model('Partner', partnersSchema);
