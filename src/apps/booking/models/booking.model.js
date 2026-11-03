import mongoose from 'mongoose';


/* Schema booking*/
const userBookingSchema = mongoose.Schema(
    {
    
        reason: {
            type: String,
            required: [true, "Please enter response for reason"]
        },
        description: {
            type: String,
            //required: [true, "Please enter answer 2"]
        },
        referralCode: {
            type: String,
            //required: [true, "Please enter answer 3"]
        },
        consultDate: {
            type: Date,
            required: [true, "Please enter response for consultation date"]
        },
        consultTime: {
            type: String,
            required: [true, "Please enter response for consultation time"]
        },
        contactMethod: {
            type: String,
            required: [true, "Please enter response for contact method"]
        },
        referral: {
            type: String,
            required: [true, "Please enter response for referral"]
        },
        phone: {
            type: String,
            //unique: true,
            required: [true, "Please enter phone number"]
        },
        email: {
            type: String,
            //unique: true,
            //required: [true, "Please enter email address"]
        },
        name: {
            type: String,
            //unique: true,
            required: [true, "Please enter name"]
        },
        surname: {
            type: String,
            //unique: true,
            //required: [true, "Please enter surname"]
        },
        userDevice: {
            type: String,
            //unique: true,
            //required: [true, "Please enter surname"]
        },
        username: {
            type: String,
            default: 'business',
            //required: [true, "Please enter username"]
        },
        // Pipeline link — the prospect this session is for. Stored at
        // booking time (the book-session page knows the exact id) so the
        // pipeline can advance without phone-match guesswork. Optional for
        // legacy rows created before the link existed.
        prospectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Prospect',
            default: null,
            index: true,
        },
        // Reminder idempotency — T-24h / T-1h stamps. Null-check in the
        // job filter makes each leg fire exactly once, even across
        // overlapping runs or parallel dynos.
        reminded24hAt: {
            type: Date,
            default: null,
            index: true,
        },
        reminded1hAt: {
            type: Date,
            default: null,
            index: true,
        },
        status: {
            type: String,
            default: 'Scheduled',
            //required: [true, "Please enter username"]
        },
        
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const BookingModel = mongoose.model('Booking', userBookingSchema);