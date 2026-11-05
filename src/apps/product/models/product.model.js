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
            default: true,
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
const CartSchema = new mongoose.Schema({  
    products: [  
        {   
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Reference to Product  
            quantity: {  
                type: Number,  
                required: [true, "Please enter quantity"] // Ensure quantity is required  
            },  
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
    orderStatus: {   
        type: String,  
        default: 'Pending' 
    },  
    createdAt: {   
        type: Date,   
        default: Date.now   
    }  
});  

// Admin queue leg (status-filtered, oldest-first).
CartSchema.index({ orderStatus: 1, createdAt: 1 });  

/* Model */  
export const CartModel = mongoose.model('Cart', CartSchema);
