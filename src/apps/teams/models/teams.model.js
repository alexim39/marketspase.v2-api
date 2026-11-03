import mongoose from 'mongoose';  

/* Schema */  
const teamSchema = mongoose.Schema(  
    {  
        teamName: {  
            type: String,  
            required: [true, "Please enter the team name"],  
        },  
        description: {  
            type: String,  
        },  
        teamPurpose: {  
            type: String,  
            required: [true, "Please select a purpose for the team"] 
        },  
        partnerId: {  
            type: mongoose.Schema.Types.ObjectId,  
            ref: 'Partner', // Assuming there's a User model to reference  
            required: true,  
        },  
        members: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Partner'
          }],
    },  
    {  
        timestamps: true, // Automatically add createdAt and updatedAt fields  
    }  
);  

/* Model */  
export const TeamModel = mongoose.model('Team', teamSchema);