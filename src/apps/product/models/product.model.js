import mongoose from 'mongoose';


const productMediaSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['image', 'video'],
            required: true,
        },
        url: {
            type: String,
            required: true,
            trim: true,
        },
        publicId: {
            type: String,
            default: null,
            trim: true,
        },
        thumbnailUrl: {
            type: String,
            default: '',
            trim: true,
        },
        width: {
            type: Number,
            default: null,
            min: 0,
        },
        height: {
            type: Number,
            default: null,
            min: 0,
        },
        duration: {
            type: Number,
            default: null,
            min: 0,
        },
        order: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { _id: true },
);

const costBreakdownSchema = new mongoose.Schema(
    {
        manufacturing: { type: Number, min: 0, default: 0 },
        packaging: { type: Number, min: 0, default: 0 },
        inboundFreight: { type: Number, min: 0, default: 0 },
        duties: { type: Number, min: 0, default: 0 },
        other: { type: Number, min: 0, default: 0 },
        lastMileShipping: { type: Number, min: 0, default: 0 },
        handling: { type: Number, min: 0, default: 0 },
        acquisitionAllowance: { type: Number, min: 0, default: 0 },
        paymentFeeRate: { type: Number, min: 0, max: 1, default: 0.015 },
        refundReserveRate: { type: Number, min: 0, max: 1, default: 0.03 },
        rankReserveRate: { type: Number, min: 0, max: 1, default: 0.015 },
        notes: { type: String, default: '', trim: true, maxlength: 1000 },
        landedCost: { type: Number, min: 0, default: 0 },
        totalCostPerUnit: { type: Number, min: 0, default: 0 },
    },
    { _id: false },
);

const productPricingSchema = new mongoose.Schema(
    {
        mode: {
            type: String,
            enum: ['resale', 'direct', 'both'],
            default: 'resale',
        },
        targetPlatformContributionPct: { type: Number, min: 0, max: 1, default: 0.10 },
        minPlatformContributionPct: { type: Number, min: 0, max: 1, default: 0.05 },
        minPlatformContributionAmount: { type: Number, min: 0, default: 2000 },
        targetPartnerMarginPct: { type: Number, min: 0, max: 1, default: 0.30 },
        minPartnerMarginPct: { type: Number, min: 0, max: 1, default: 0.20 },
        storeServiceFeePct: { type: Number, min: 0, max: 1, default: 0.02 },
        paymentFeeRate: { type: Number, min: 0, max: 1, default: 0.015 },
        refundReserveRate: { type: Number, min: 0, max: 1, default: 0.03 },
        rankReserveRate: { type: Number, min: 0, max: 1, default: 0.015 },
        commissionRate: { type: Number, min: 0, max: 1, default: 0.185 },
        sellingPrice: { type: Number, min: 0, default: 0 },
        landedCost: { type: Number, min: 0, default: 0 },
        totalCostPerUnit: { type: Number, min: 0, default: 0 },
        paymentFee: { type: Number, min: 0, default: 0 },
        commissionBase: { type: Number, min: 0, default: 0 },
        commission: { type: Number, min: 0, default: 0 },
        refundReserve: { type: Number, min: 0, default: 0 },
        rankReserve: { type: Number, min: 0, default: 0 },
        handling: { type: Number, min: 0, default: 0 },
        mentorBonus: { type: Number, min: 0, default: 0 },
        acquisitionAllowance: { type: Number, min: 0, default: 0 },
        platformContribution: { type: Number, default: 0 },
        platformContributionPct: { type: Number, default: 0 },
        breakEvenPrice: { type: Number, min: 0, default: 0 },
        minimumViablePrice: { type: Number, min: 0, default: 0 },
        minimumRetailPrice: { type: Number, min: 0, default: 0 },
        recommendedPartnerPrice: { type: Number, min: 0, default: 0 },
        recommendedRetailPrice: { type: Number, min: 0, default: 0 },
        partnerMargin: { type: Number, default: 0 },
        partnerMarginPct: { type: Number, default: 0 },
        partnerMarginPercent: { type: Number, default: 0 },
        storeServiceFee: { type: Number, min: 0, default: 0 },
        status: {
            type: String,
            enum: ['healthy', 'thin', 'blocked', 'incomplete'],
            default: 'incomplete',
        },
        canPublish: { type: Boolean, default: false },
        reasons: { type: [String], default: [] },
        warnings: { type: [String], default: [] },
        computedAt: { type: Date, default: null },
    },
    { _id: false },
);

/* Schema
 * Catalog products. `price` remains the single checkout price so legacy
 * orders and wallet debits are untouched; the extra commerce fields are
 * optional and are only used to present a richer shop.
 */
const productSchema = mongoose.Schema(
    {
        sku: {
            type: String,
            trim: true,
        },
        img: {
            type: String,
        },
        gallery: {
            type: [String],
            default: [],
        },
        media: {
            type: [productMediaSchema],
            default: [],
            validate: {
                validator: (value) => !Array.isArray(value) || value.length <= 5,
                message: 'A product can have at most 5 images or videos',
            },
        },
        costBreakdown: {
            type: costBreakdownSchema,
            default: null,
        },
        pricing: {
            type: productPricingSchema,
            default: null,
        },
        publishedAt: {
            type: Date,
            default: null,
        },
        name: {
            type: String,
        },
        category: {
            type: String,
            trim: true,
            default: 'Essentials',
        },
        shortDesc: {
            type: String,
            trim: true,
            default: '',
        },
        price: {
            type: Number,
        },
        cogs: {
            type: Number,
            min: 0,
            default: 0,
        },
        shippingCost: {
            type: Number,
            min: 0,
            default: 0,
        },
        partnerPrice: {
            type: Number,
            min: 0,
            default: 0,
        },
        retailPrice: {
            type: Number,
            min: 0,
            default: 0,
        },
        stock: {
            type: Number,
            min: 0,
            default: null,
        },
        status: {
            type: String,
            enum: ['draft', 'active', 'inactive', 'archived'],
            default: 'active',
        },
        commissionable: {
            type: Boolean,
            default: false,
        },
        pricingMode: {
            type: String,
            enum: ['resale', 'direct', 'both'],
            default: 'resale',
        },
        mentorBonus: {
            type: Number,
            min: 0,
            default: 0,
        },
        featured: {
            type: Boolean,
            default: false,
        },
        sortOrder: {
            type: Number,
            default: 0,
        },
        benefits: {
            type: [String],
            default: [],
        },
        howToUse: {
            type: String,
            trim: true,
            default: '',
        },
        deliveryNote: {
            type: String,
            trim: true,
            default: '',
        },
        desc: {
            type: String,
        },
    },
    {
        timestamps: true
    }
)

productSchema.index({ status: 1, sortOrder: 1, createdAt: -1 });

/* Model */
export const ProductModel = mongoose.model('Product', productSchema);




// models/Cart.js
const shippingSchema = new mongoose.Schema(
    {
        fullName: { type: String, required: true, trim: true },
        phone: { type: String, required: true, trim: true },
        street: { type: String, required: true, trim: true },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        country: { type: String, default: 'Nigeria', trim: true },
        notes: { type: String, default: '', trim: true },
    },
    { _id: false },
);

const CartSchema = new mongoose.Schema({  
    orderNumber: {
        type: String,
        trim: true,
        index: true,
    },
    shipping: {
        type: shippingSchema,
        default: null,
    },
    paymentMethod: {
        type: String,
        default: 'Wallet',
        trim: true,
    },
    paymentReference: {
        type: String,
        default: '',
        trim: true,
    },
    products: [  
        {   
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Reference to Product  
            quantity: {  
                type: Number,  
                required: [true, "Please enter quantity"] // Ensure quantity is required  
            },
            // Price/cost snapshot at checkout. Commission is calculated from
            // this, not from whatever the product costs later.
            price: { type: Number, min: 0 },
            cogs: { type: Number, min: 0, default: 0 },
            shippingCost: { type: Number, min: 0, default: 0 },
            commissionable: { type: Boolean, default: false },
            saleMode: {
                type: String,
                enum: ['personal', 'resale'],
                default: 'personal',
            },
            // Suggested retail price snapshot for a resale line. The partner's
            // direct margin is retailPrice − price; it is not a platform cost.
            retailPrice: { type: Number, min: 0, default: 0 },
            // True when checkout decremented numeric stock for this line.
            stockTracked: { type: Boolean, default: false },
        }  
    ],  
    partner: {  
        type: mongoose.Schema.Types.ObjectId,  
        ref: 'Partner',  
        required: true // Ensure partner is required  
    },  
    totalCost: {   
        type: Number,   
        required: true   
    },
    saleMode: {
        type: String,
        enum: ['personal', 'resale', 'mixed'],
        default: 'personal',
    },
    grossMargin: { type: Number, min: 0, default: 0 },
    commissionableMargin: { type: Number, min: 0, default: 0 },
    commissionPlan: {
        type: String,
        enum: ['legacy', 'growth'],
        default: 'legacy',
    },
    orderStatus: {   
        type: String,  
        default: 'Pending' 
    },
    decidedAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    stockRestored: { type: Boolean, default: false },
    stockRestoredAt: { type: Date, default: null },
    storeReceivedAt: { type: Date, default: null },
    createdAt: {   
        type: Date,   
        default: Date.now   
    }  
});  

// Admin queue leg (status-filtered, oldest-first).
CartSchema.index({ orderStatus: 1, createdAt: 1 });  

/* Model */  
export const CartModel = mongoose.model('Cart', CartSchema);
