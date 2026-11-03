import mongoose from 'mongoose';

export const CommunicationSchema = new mongoose.Schema(
    {
    
    date: {
        type: Date,
        required: true,
        default: Date.now,
    },
    type: {
        type: String,
        enum: ['call', 'email', 'text', 'zoom', 'whatsapp', 'presentation'],
        required: true,
    },
    duration: {
        type: Number,
        // Only applicable for 'call' and 'zoom'
        min: 0,
        default: 0,
    },
    description: {
        type: String,
        required: true,
    },
    followUpAction: {
        type: String,
        default: 'To be determined',
    },
    topicsDiscussed: {
        type: [String],
        default: [],
    },
    documentsShared: {
        type: [String],
        default: [],
    },
    interestLevel: {
        type: String,
        enum: ['hot', 'warm', 'cold'],
        default: 'warm',
    },
    // Author attribution — who logged this touch (owner vs supporting upline).
    // Absent on legacy entries; optional so old clients keep working.
    createdBy: {
        type: String,
    },
    createdByName: {
        type: String,
    },
    // Structured outcome — countable (Connected / No answer / Booked session /
    // Follow-up set / Closed-lost). Absent on legacy entries.
    outcome: {
        type: String,
        enum: ['Connected', 'No answer', 'Booked session', 'Follow-up set', 'Closed-lost'],
    },
    // Committed callback date — drives overdue nudges. Absent when none set.
    followUpDate: {
        type: Date,
    },
    status: {
        type: String,
        default: 'Open', 
        // Closed - When not needed anymore!
    }

  },
  {
    timestamps: true,
  }
);
