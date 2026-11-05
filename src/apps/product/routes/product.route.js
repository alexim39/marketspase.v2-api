import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { 
    getAllProducts,
    getProductById,
    listProductsForAdmin,
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
// Update product (legacy PUT kept for admins; no unguarded writes)
ProductRouter.put('/:id', requireAuth, requireRole('admin'), adminUpdateProduct);
// purchase transaction on cart
ProductRouter.post('/cart', requireAuth, Savecart);
//getAllOrderBy
ProductRouter.get('/getAllOrderBy/:partnerId', requireAuth, GetAllCartsBy);
// Admin order queue (role-gated)
ProductRouter.get('/orders', requireAuth, requireRole('admin'), listOrdersForAdmin);
ProductRouter.patch('/orders/:id', requireAuth, requireRole('admin'), decideOrder);
// Admin catalog rows include cost and commission fields
ProductRouter.get('/admin/list', requireAuth, requireRole('admin'), listProductsForAdmin);
// Admin product catalog (role-gated; updates are whitelisted)
ProductRouter.post('/', requireAuth, requireRole('admin'), adminCreateProduct);
ProductRouter.patch('/:id', requireAuth, requireRole('admin'), adminUpdateProduct);
// One product (full product page) — after every literal GET path
ProductRouter.get('/:id', getProductById);


export default ProductRouter;