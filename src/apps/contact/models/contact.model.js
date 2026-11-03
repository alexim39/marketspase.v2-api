import mongoose from 'mongoose';


/* Schema*/
const contactSchema = mongoose.Schema(
    {
        name: {
            type: String,
            //unique: true,
            required: [true, "Please enter name"]
        },
        surname: {
            type: String,
            //unique: true,
            required: [true, "Please enter surname"]
        },
        email: {
            type: String,
            required: [true, "Please enter email address"]
        },
        subject: {
            type: String,
            //unique: true,
            required: [true, "Please enter subject"]
        },
        message: {
            type: String,
            //unique: true,
            required: [true, "Please enter message"]
        },
        
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const ContactModel = mongoose.model('Contact', contactSchema);



/* pre-approach */
/* Schema*/
const downloadSchema = mongoose.Schema(
    {
        name: {
            type: String,
            //unique: true,
            required: [true, "Please enter name"]
        },
        surname: {
            type: String,
            //unique: true,
            required: [true, "Please enter surname"]
        },
        email: {
            type: String,
            unique: true,
            required: [true, "Please enter email address"]
        },
        phone: {
            type: String,
            //unique: true,
            required: [true, "Please enter phone number"]
        },
        userDevice: {
            type: String,
            //unique: true,
            //required: [true, "Please enter surname"]
        },
        username: {
            type: String,
            default: 'business',
            unique: true,
            //required: [true, "Please enter username"]
        },
        
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const PreapproachDownloadModel = mongoose.model('Preapproach-download', downloadSchema);