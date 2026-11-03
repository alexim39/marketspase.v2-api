import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { 
    getAllProducts,
    updateProduct,
    Savecart,
    GetAllCartsBy,
    listOrdersForAdmin,
    decideOrder,
    adminCreateProduct,
    adminUpdateProduct
} from '../controllers/product.controller.js'
const ProductRouter = express.Router();

// Get all campaigns createdBy
ProductRouter.get('/getAll', getAllProducts);
// Update product
ProductRouter.put('/:id', updateProduct);
// purchase transaction on cart
ProductRouter.post('/cart', Savecart);
//getAllOrderBy
ProductRouter.get('/getAllOrderBy/:partnerId', GetAllCartsBy);
// Admin order queue (role-gated)
ProductRouter.get('/orders', requireAuth, requireRole('admin'), listOrdersForAdmin);
ProductRouter.patch('/orders/:id', requireAuth, requireRole('admin'), decideOrder);
// Admin product catalog (role-gated; legacy PUT /:id left untouched)
ProductRouter.post('/', requireAuth, requireRole('admin'), adminCreateProduct);
ProductRouter.patch('/:id', requireAuth, requireRole('admin'), adminUpdateProduct);


export default ProductRouter;