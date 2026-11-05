import mongoose from 'mongoose';
import { CommunicationSchema } from "./communications.schema.js";
import { StatusSchema } from "./status.schema.js";


/* Schema*/
const prospectSchema = mongoose.Schema(
    {
        prospectName: {
            type: String,
            required: [true, "Please enter name"]
        },
        prospectSurname: {
            type: String,
        },
        prospectPhone: {
            type: String,
            required: [true, "Please enter phone number"]
        },
        prospectEmail: {
            type: String,
        },
        prospectSource: {
            type: String,
            required: [true, "Please enter source"]
        },
        // Contact-list enrichment (onboarding): relationship context for the
        // upline working the list. Sparse — absent historically.
        relationship: {
            type: String,
            enum: ['Family', 'Friend', 'Colleague', 'Church', 'Neighbour', 'Referral', 'Other'],
            default: 'Other',
        },
        priority: {
            type: String,
            enum: ['high', 'normal'],
            default: 'normal',
        },
        bestTimeToCall: {
            type: String,
            maxlength: 120,
            default: '',
        },
        consentToContact: {
            type: Boolean,
            default: false,
        },
        notes: {
            type: String,
            maxlength: 2000,
            default: '',
        },
        // Contact-list submission grouping: which submitted batch (if any)
        // this prospect belongs to. Sparse — absent historically.
        listBatch: {
            type: String,
            default: null,
            index: true,
            sparse: true,
        },
        listSubmitted: {
            type: Boolean,
            default: false,
        },
        listSubmittedAt: {
            type: Date,
            default: null,
        },
        communications: [CommunicationSchema],
        // Stage-move audit — every pipeline advance appends {from, to, at,
        // by, byName} so the timeline shows who moved the prospect.
        // Absent on legacy documents.
        stageHistory: [{
          from: { type: String },
          to: { type: String },
          at: { type: Date },
          by: { type: String },
          byName: { type: String },
        }],
        partnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner',
            required: true,
        },
        surverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Survey',
        },
        // Buy Prospect pickup timestamp — starts the 7-day return window
        // (partners may send a pool-claimed lead back within 7 days).
        // Absent on manually added contacts and pre-tracking claims.
        claimedAt: {
            type: Date,
            default: null,
            index: true,
        },
        // Claim fee actually debited (₦). Null/0 = pre-fee claim → no
        // refund moves on return. Set by the paid claim path only.
        claimFeePaid: {
            type: Number,
            default: null,
        },
        // Pool return count snapshot at pickup — release restores
        // claimCount = poolReturns + 1 so chronic returners keep sinking.
        poolReturns: {
            type: Number,
            default: null,
        },
        // Expiry-warning bookkeeping (engine sets it once per claim).
        claimWarningAt: {
            type: Date,
            default: null,
        },
        // Partner quality rating (1–5) feeding pool prioritization.
        rating: {
            score: { type: Number, min: 1, max: 5 },
            note: { type: String, maxlength: 500 },
            at: { type: Date },
        },
        // Optional campaign attribution (R4): stamped when a prospect
        // arrives via a tracked campaign link. Sparse — absent historically.
        campaignId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Campaign',
            default: null,
            index: true,
            sparse: true,
        },
        status: StatusSchema,
        role: {
            type: String,
            default: 'User'
        },
        survey: {
            ageRange: {
                type: String,
            },
            socialMedia: { 
                type: [String],     
            },
            employedStatus: {
                type: String,
            },
            importanceOfPassiveIncome: {
                type: String,
            },
            onlinePurchaseSchedule: {
                type: String,
            },
            primaryOnlineBusinessMotivation: {
                type: String,
            },
            comfortWithTech: {
                type: String,
            },
            onlineBusinessTimeDedication: {
                type: String,
            },
            referralCode: {
                type: String,
            },
            referral: {
                type: String,
            },
            country: { 
                type: String,
                default: 'Nigeria'
             },
              state: { 
                type: String, 
            },
        },
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const ProspectModel = mongoose.model('Prospect', prospectSchema);
