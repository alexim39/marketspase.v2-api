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
        /** Set when a converted prospect completes signup under this partner. */
        convertedPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner',
            default: null,
            index: true,
        },
        convertedAt: {
            type: Date,
            default: null,
        },
        surverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Survey',
        },
        // Partner quality rating (1–5) from the pipeline after conversion.
        rating: {
            score: { type: Number, min: 1, max: 5 },
            note: { type: String, maxlength: 500 },
            at: { type: Date },
        },
        // Optional campaign attribution retired with the legacy lead
        // allocation engine. New prospects carry no campaignId.
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
        // Business records are never hard-deleted. Queries filter this out;
        // GDPR erasure uses the anonymisation path, not this flag.
        deletedAt: { type: Date, default: null, index: true },
        deletedBy: { type: String, default: null },
    },
    {
        timestamps: true
    }
)

/* Model */
// Soft-delete read fence: legacy and slice reads never surface deleted rows.
// Pass `{ withDeleted: true }` for admin restore/reconciliation queries.
prospectSchema.pre(/^find/, function hideDeletedProspects() {
    if (!this.getOptions?.().withDeleted) this.where({ deletedAt: null });
});
prospectSchema.pre('countDocuments', function hideDeletedProspectCounts() {
    if (!this.getOptions?.().withDeleted) this.where({ deletedAt: null });
});
prospectSchema.pre('aggregate', function hideDeletedProspectAggregates() {
    if (!this.options?.withDeleted) this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const ProspectModel = mongoose.model('Prospect', prospectSchema);
