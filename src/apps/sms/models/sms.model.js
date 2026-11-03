import mongoose from 'mongoose';  

/* Schema */  
const ParterSMSSchema = mongoose.Schema(  
    {  
        smsBody: {  
            type: String,  
            required: [true, "Please enter answer 2"]  
        },  
        partnerId: {  
            type: mongoose.Schema.Types.ObjectId,  
            ref: 'partner',  
            required: true,  
        },  
        prospect: {  
            type: [String],  // Allow array of strings  
            validate: {  
                validator: function(v) {  
                    // Check if v is an array of strings  
                    return Array.isArray(v) && v.every(phone => typeof phone === 'string');  
                },  
                message: props => `${props.value} is not a valid array of phone!`  
            },  
            required: [true, "prospect is required"]  // Make required  
        },  
        transactionId: {  
            type: mongoose.Schema.Types.ObjectId,  
            ref: 'Transaction',  
            required: true,  
        },  
        status: {  
            type: String,  
            required: true  
        },
        // Optional campaign attribution for ROI (outreach slice).
        campaignId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Campaign',
            default: null,
            index: true,
            sparse: true,
        },
        // Wallet cost of this send (mirrors its transaction amount).
        cost: {
            type: Number,
            default: 0,
        },
        // Provider delivery reports keyed by per-recipient reference
        // (`<transactionId>:<index>`). Additive — legacy rows simply lack it.
        delivery: {
            type: Map,
            of: String,
            default: {},
        }  
    },  
    {  
        timestamps: true  
    }  
);  

/* Model */  
export const ParterSMSModel = mongoose.model('Partner-sms', ParterSMSSchema);