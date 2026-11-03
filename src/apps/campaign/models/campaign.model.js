import mongoose from 'mongoose';

/* Campaign schema*/
const campaignSchema = mongoose.Schema({
  targetAudience: {
    ageRangeTarget: { type: String, default: 'All' },
    genderTarget: { type: String, default: 'All' },
    locationTarget: { type: String, default: 'States' }, // Can be 'States', 'Cities', or 'Countries' (adjust as needed)
    // Explicit targets backing the scope above (states or countries).
    // Absent on legacy documents — readers must treat missing as unsaid.
    locationTargets: { type: [String], default: [] },
    educationTarget: { type: String, default: 'All' },
    relationshipTarget: { type: String, default: 'All' },
    industryTarget: { type: String, default: 'All' },
  },
  marketingObjectives: {
    adObjective: { type: String, required: true },
    successMeasurement: { type: String},
  },
  // Campaign theme — picked by the partner at creation (dropdown). Drives
  // the ad angle for the admin team and the allocation matcher's affinity
  // scoring. Free text capped server-side; the wizard offers the standard list.
  category: { type: String, default: '' },
  // Internal lead allocation (system-matched pool leads → personal-list).
  // Debit-on-delivery: the partner pays perLeadPrice only when a lead
  // actually lands, so there is never a held allocation fund to refund —
  // ending a campaign simply stops further allocation debits.
  allocation: {
    enabled: { type: Boolean, default: true },
    perLeadPrice: { type: Number, default: 300 },
    dailyCap: { type: Number, default: 5 },
    totalCap: { type: Number, default: 50 },
    allowOutOfArea: { type: Boolean, default: false },
    paused: { type: Boolean, default: false },
    delivered: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    lastFundsNoticeAt: { type: Date, default: null },
    lastDigestAt: { type: Date, default: null },
    // Consecutive fund-failed runs before the matcher auto-pauses.
    fundsSkips: { type: Number, default: 0 },
  },
  // Admin close-out on End: what the held budget actually bought. The
  // platform never auto-refunds ad spend (it ran off-platform), but the
  // attestation is permanent and partner-visible.
  closeout: {
    spentAmount: { type: Number, default: null },
    spendNote: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
  },
  budget: {
    budgetType: { type: String, required: true },
    budgetAmount: { type: Number, required: true },
  },
  adDuration: {
    campaignStartDate: { type: Date, required: true },
    noEndDate: { type: Boolean, required: true },
    campaignEndDate: { type: Date },
  },
  adFormat: {
    adFormat: { type: String, required: true },
    deviceType: { type: String, required: true },
    adPreferences: {
      FacebookFeed: { type: Boolean, default: false },
      InstagramFeed: { type: Boolean, default: false },
      InstagramStories: { type: Boolean, default: false },
      FacebookStories: { type: Boolean, default: false },
      AudienceNetwork: { type: Boolean, default: false },
      MessengerInbox: { type: Boolean, default: false },
    },
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'partner', 
    required: true,
  },
  campaignName: {
    type:String,
    required: true,
  },
  deliveryStatus: {
    type:String,
    required: true,
    default: "Pending"
  },
  visits: {
    type:Number,
    default: 0
  },
  userDevice: {
    type: String,
    //unique: true,
    //required: [true, "Please enter surname"]
  },
   
},
{
    timestamps: true
}
);


// Admin queue leg (status-filtered, oldest-first).
campaignSchema.index({ deliveryStatus: 1, createdAt: 1 });

/* Model */
export const CampaignModel = mongoose.model('Campaign', campaignSchema);