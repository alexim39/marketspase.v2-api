import mongoose from 'mongoose';


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
            enum: ['active', 'inactive', 'archived'],
            default: 'active',
        },
        commissionable: {
            type: Boolean,
            default: false,
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
    createdAt: {   
        type: Date,   
        default: Date.now   
    }  
});  

// Admin queue leg (status-filtered, oldest-first).
CartSchema.index({ orderStatus: 1, createdAt: 1 });  

/* Model */  
export const CartModel = mongoose.model('Cart', CartSchema);
