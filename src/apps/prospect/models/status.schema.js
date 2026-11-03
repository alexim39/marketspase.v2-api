import mongoose from 'mongoose';

export const StatusSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      default: 'New Prospect' 
    }, // Main status string
    note: { 
      type: String 
    },                          // Optional context from user input
    paydayDate: { 
      type: Date 
    },                      // For "Waiting for Pay Day"
    expectedDecisionDate: { 
      type: Date 
    },            // For "Promised to Join", "Thinking About It"
    onboardingDate: { 
      type: Date 
    }, 
     status: {
        type: String,
        default: 'Open', 
        // Closed - When not needed anymore!
    },                // For "Booked for Onboarding"
    // Canonical pipeline stage (Phase A). DECLARED — without these paths
    // Mongoose strict mode silently strips every stage write on update
    // (200 OK, nothing persisted): advance/convert appeared to do nothing.
    stage: {
      type: String,
      enum: ['New', 'Contacted', 'Interested', 'In Negotiation', 'Converted', 'Closed'],
    },
    stageEnteredAt: {
      type: Date,
    },                // Stuck-in-pipeline clock, stamped on every advance
  },
  {
    timestamps: true,
  }
);
