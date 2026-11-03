import mongoose from 'mongoose';


/* Schema*/
const ParterEmailsSchema = mongoose.Schema(
    {
    
        emailSubject: {
            type: String,
            required: [true, "Please enter answer 1"]
        },
        emailBody: {
            type: String,
            required: [true, "Please enter answer 2"]
        },
        partnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'partner',
            required: true,
        },
        prospects: {  
            type: [String],  // Allow array of strings    
            required: [true, "prospect email is required"]  // Make required  
        },        
    },
    {
        timestamps: true
    }
)

/* Model */
export const ParterEmailsModel = mongoose.model('Partner-emails', ParterEmailsSchema);