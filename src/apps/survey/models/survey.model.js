import mongoose from 'mongoose';

/* Schema survey*/
const userSurveySchema = mongoose.Schema(
    {
    
        ageRange: {
            type: String,
            required: [true, "Please choose age range"]
        },
        socialMedia: { 
            type: [String], 
            required: [true, "Please choose social media channel"]

        },
        employedStatus: {
            type: String,
            required: [true, "Please enter employment status"]
        },
        importanceOfPassiveIncome: {
            type: String,
            required: [true, "Please choose passive income response"]
        },
        onlinePurchaseSchedule: {
            type: String,
            required: [true, "Please choose online purchase response"]
        },
        primaryOnlineBusinessMotivation: {
            type: String,
            required: [true, "Please choose primary motivation response"]
        },
        comfortWithTech: {
            type: String,
            required: [true, "Please choose comfort with tech"]
        },
        onlineBusinessTimeDedication: {
            type: String,
            required: [true, "Please choose hours of dedication"]
        },
        phoneNumber: {
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
            required: [true, "Please enter surname"]
        },
        referralCode: {
            type: String,
            //required: [true, "Please enter answer 3"]
        },
        referral: {
            type: String,
            //required: [true, "Please enter response for referral"]
        },
        userDevice: {
            type: String,
            //unique: true,
            //required: [true, "Please enter surname"]
        },
        prospectStatus: {
            type: String,
            default: 'Not Moved',
            //unique: true,
            //required: [true, "Please enter surname"]
        },
        username: {
            type: String,
            default: 'business',
           // unique: true,
           //required: [true, "Please enter surname"]
        },
        // System allocation → personal-list: the campaign this row was
        // assigned under (drives exact ROI attribution on accept).
        campaignId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        allocatedAt: {
            type: Date,
            default: null,
        },
        country: { 
            type: String,
            default: 'Nigeria'
         },
          state: { 
            type: String, 
        },
        // Normalized state (lowercase, FCT/Abuja aliased) for pool geo
        // matching — set at write; read paths fall back to normalizing.
        stateNorm: {
            type: String,
            default: '',
            index: true,
        },
        // Buy Prospect engine: times returned to the pool (sinks future
        // rank) + partner quality ratings guiding prioritization.
        claimCount: {
            type: Number,
            default: 0,
        },
        ratings: [{
            score: { type: Number, min: 1, max: 5 },
            by: { type: String },
            at: { type: Date },
            note: { type: String, maxlength: 500 },
        }],
       
    },
    {
        timestamps: true
    }
)

/* Model */
export const ProspectSurveyModel = mongoose.model('Survey', userSurveySchema);

/* For Partners */

const partnerSurveyFormSchema = new mongoose.Schema({
    difficulty: { type: String, required: true },
    challenges: [{ type: String }], // Array of strings for checkboxes
    strategies: [{ type: String }], // Array of strings for checkboxes
    //importanceOfPassiveIncome: { type: String, required: true },
    targetAudience: [{ type: String }], // Array of strings for checkboxes
    recruitmentTool: { type: String, required: true },
    misconception: { type: String, required: true },
    businessMotivation: { type: String, required: true },
    recruitmentAttempt: { type: String, required: true },
    trainingSupport: { type: String, required: true },
    comfortWithTech: { type: String, required: true },
    businessTimeDedication: { type: String, required: true },
    phoneNumber: { type: String, required: true, match: /^[0-9]+$/ },
    reservationCode: { type: String },
    name: { type: String, required: true },
    gender: { type: String, required: true },
    interestedInTraining: { type: String, required: true },
  }, {
    timestamps: true, // Adds createdAt and updatedAt timestamps automatically
  });
  
export const PartnerSurveyModel = mongoose.model('Partner-Survey', partnerSurveyFormSchema);