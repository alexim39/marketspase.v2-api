import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { 
    getAllProducts,
    getProductById,
    listProductsForAdmin,
    listResaleProducts,
    Savecart,
    GetAllCartsBy,
    listOrdersForAdmin,
    decideOrder,
    adminCreateProduct,
    adminUpdateProduct
} from '../controllers/product.controller.js'
const ProductRouter = express.Router();

const productFields = {
  sku: z.string().trim().max(80).optional(),
  img: z.string().trim().max(500).optional(),
  gallery: z.array(z.string().trim().max(500)).max(20).optional(),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).optional(),
  shortDesc: z.string().trim().max(500).optional(),
  price: z.coerce.number().min(0).max(100000000),
  cogs: z.coerce.number().min(0).max(100000000).optional(),
  shippingCost: z.coerce.number().min(0).max(100000000).optional(),
  partnerPrice: z.coerce.number().min(0).max(100000000).optional(),
  retailPrice: z.coerce.number().min(0).max(100000000).optional(),
  stock: z.union([z.coerce.number().min(0), z.null()]).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  commissionable: z.boolean().optional(),
  featured: z.boolean().optional(),
  sortOrder: z.coerce.number().min(0).max(10000).optional(),
  benefits: z.array(z.string().trim().max(200)).max(30).optional(),
  howToUse: z.string().trim().max(4000).optional(),
  deliveryNote: z.string().trim().max(2000).optional(),
  desc: z.string().trim().max(8000).optional(),
};
const LegacyProductCreate = z.object(productFields);
const LegacyProductUpdate = z.object({
  ...productFields,
  name: productFields.name.optional(),
  price: productFields.price.optional(),
});

// Get all campaigns createdBy
ProductRouter.get('/getAll', getAllProducts);
// Update product (legacy PUT kept for admins; no unguarded writes)
ProductRouter.put('/:id', requireAuth, requireRole('admin'), validateBodyInPlace(LegacyProductUpdate), adminUpdateProduct);
// purchase transaction on cart
ProductRouter.post('/cart', requireAuth, Savecart);
//getAllOrderBy
ProductRouter.get('/getAllOrderBy/:partnerId', requireAuth, GetAllCartsBy);
// Admin order queue (role-gated)
ProductRouter.get('/orders', requireAuth, requireRole('admin'), listOrdersForAdmin);
ProductRouter.patch('/orders/:id', requireAuth, requireRole('admin'), decideOrder);
// Admin catalog rows include cost and commission fields
ProductRouter.get('/admin/list', requireAuth, requireRole('admin'), listProductsForAdmin);
// Partner-only resale catalog
ProductRouter.get('/resale/catalog', requireAuth, listResaleProducts);
// Admin product catalog (role-gated; updates are whitelisted)
ProductRouter.post('/', requireAuth, requireRole('admin'), validateBodyInPlace(LegacyProductCreate), adminCreateProduct);
ProductRouter.patch('/:id', requireAuth, requireRole('admin'), validateBodyInPlace(LegacyProductUpdate), adminUpdateProduct);
// One product (full product page) — after every literal GET path
ProductRouter.get('/:id', getProductById);


export default ProductRouter;