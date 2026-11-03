import mongoose from 'mongoose';

/* Schema*/
const reservationCodeSchema = mongoose.Schema(
    {
    
        code: {
            type: String,
            unique: true,
            required: [true, "Please enter response for reservation code"]
        },
        partnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Partner',
            required: true,
        },
        // Actor who submitted the record — differs from partnerId only for
        // on-behalf records (upline recording for a downline owner). Absent
        // on legacy/self-recorded rows; readers must null-tolerate it.
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Partner',
            default: null,
        },
        prospectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Prospect',
            //required: true,
        },
        status: {
            type: String,
            //unique: true,
            default: 'Pending'
        },
        
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const ReservationCodeModel = mongoose.model('Reservation-code', reservationCodeSchema);