import mongoose from 'mongoose';


/* Schema*/
const emailSubscriptionSchema = mongoose.Schema(
    {
    
        email: {
            type: String,
            //unique: true,
            required: [true, "Please enter email address"]
        },
        status: {
            type: String,
            default: 'Pending',
        },
        confirmTokenHash: {
            type: String,
            select: false,
        },
        confirmExpiresAt: {
            type: Date,
        },
        confirmedAt: {
            type: Date,
        },
        unsubscribeTokenHash: {
            type: String,
            select: false,
        },
        unsubscribedAt: {
            type: Date,
        },
        userDevice: {
            type: String,
            //unique: true,
            //required: [true, "Please enter surname"]
        },
        username: {
            type: String,
            default: 'business',
            // Never unique: every footer subscribe without a partner link
            // stores 'business' — a unique leg 500s every subscriber after
            // the first. (The stale username_1 index is dropped at boot;
            // see LEGACY_DROP in shared/mongo/indexes.js.)
            //required: [true, "Please enter username"]
        },
        deletedAt: { type: Date, default: null, index: true },
        deletedBy: { type: String, default: null },
        
       
    },
    {
        timestamps: true
    }
)

/* Model */
emailSubscriptionSchema.pre(/^find/, function hideDeletedSubscriptions() {
    if (!this.getOptions?.().withDeleted) this.where({ deletedAt: null });
});
emailSubscriptionSchema.pre('countDocuments', function hideDeletedSubscriptionCounts() {
    if (!this.getOptions?.().withDeleted) this.where({ deletedAt: null });
});
export const EmailSubscriptionModel = mongoose.model('Email-subscription', emailSubscriptionSchema);