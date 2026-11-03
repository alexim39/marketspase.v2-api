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
        
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const EmailSubscriptionModel = mongoose.model('Email-subscription', emailSubscriptionSchema);