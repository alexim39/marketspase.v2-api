import mongoose from 'mongoose';  

/* Schema */  
const ticketSchema = mongoose.Schema(  
    {  
        subject: {  
            type: String,  
            required: [true, "Please enter the subject of the issue"],  
        },  
        description: {  
            type: String,  
            required: [true, "Please enter a description of the challenge faced"],  
        },  
        date: {  
            type: Date,  
            required: [true, "Please enter the date the issue occurred"],  
        },  
        category: {  
            type: String,  
            required: [true, "Please select a category"],  
        },  
        priority: {  
            type: String,  
            required: [true, "Please select a priority level"],  
        },  
        comment: {  
            type: String,  
            default: '',  
        },  
        partnerId: {  
            type: mongoose.Schema.Types.ObjectId,  
            ref: 'partner',  
            required: true,  
        },  
    },  
    {  
        timestamps: true,  
    }  
);  

/* Model */  
export const TicketModel = mongoose.model('Ticket', ticketSchema);