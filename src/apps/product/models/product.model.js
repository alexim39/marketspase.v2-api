import mongoose from 'mongoose';


/* Schema*/
const productSchema = mongoose.Schema(
    {
    
        img: {
            type: String,
            //required: [true, "Please enter image"]
        },
        name: {
            type: String,
            //required: [true, "Please enter name"]
        },
        price: {
            type: Number,
            //required: [true, "Please enter price"]
        },
        desc: {
            type: String,
            //required: [true, "Please enter description"]
        },
        
       
    },
    {
        timestamps: true
    }
)

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
