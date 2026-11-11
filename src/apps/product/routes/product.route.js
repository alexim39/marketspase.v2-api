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
    adminUpdateProduct,
    previewProductPricing,
    publishProduct,
    uploadProductMedia,
    deleteProductMedia,
} from '../controllers/product.controller.js'
import { productMediaUpload } from './ProductMedia.upload.js';
const ProductRouter = express.Router();

const money = z.coerce.number().min(0).max(100000000);
const rate = z.coerce.number().min(0).max(1);
const costBreakdown = z.object({
  manufacturing: money.optional(),
  packaging: money.optional(),
  inboundFreight: money.optional(),
  duties: money.optional(),
  other: money.optional(),
  lastMileShipping: money.optional(),
  handling: money.optional(),
  acquisitionAllowance: money.optional(),
  paymentFeeRate: rate.optional(),
  refundReserveRate: rate.optional(),
  rankReserveRate: rate.optional(),
  notes: z.string().trim().max(1000).optional(),
}).partial().optional();

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
  status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
  commissionable: z.boolean().optional(),
  pricingMode: z.enum(['resale', 'direct', 'both']).optional(),
  mentorBonus: z.coerce.number().min(0).max(10000000).optional(),
  targetPlatformContributionPct: rate.optional(),
  targetPartnerMarginPct: rate.optional(),
  publish: z.boolean().optional(),
  media: z.array(z.any()).max(5).optional(),
  costBreakdown,
  featured: z.boolean().optional(),
  sortOrder: z.coerce.number().min(0).max(10000).optional(),
  benefits: z.array(z.string().trim().max(200)).max(30).optional(),
  howToUse: z.string().trim().max(4000).optional(),
  deliveryNote: z.string().trim().max(2000).optional(),
  desc: z.string().trim().max(8000).optional(),
};
const AdminProductCreate = z.object({
  ...productFields,
  price: productFields.price.optional(),
});
const AdminProductUpdate = z.object({
  ...productFields,
  name: productFields.name.optional(),
  price: productFields.price.optional(),
});

// Get all campaigns createdBy
ProductRouter.get('/getAll', getAllProducts);
// Update product (legacy PUT kept for admins; no unguarded writes)
ProductRouter.put('/:id', requireAuth, requireRole('admin'), validateBodyInPlace(AdminProductUpdate), adminUpdateProduct);
// Pricing preview (no writes)
ProductRouter.post('/pricing/preview', requireAuth, requireRole('admin'), previewProductPricing);
// Admin media upload / removal
ProductRouter.post('/:id/media', requireAuth, requireRole('admin'), productMediaUpload.single('file'), uploadProductMedia);
ProductRouter.delete('/:id/media/:mediaId', requireAuth, requireRole('admin'), deleteProductMedia);
// Explicit publish gate (revalidates costs, margin and media)
ProductRouter.post('/:id/publish', requireAuth, requireRole('admin'), publishProduct);
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
ProductRouter.post('/', requireAuth, requireRole('admin'), validateBodyInPlace(AdminProductCreate), adminCreateProduct);
ProductRouter.patch('/:id', requireAuth, requireRole('admin'), validateBodyInPlace(AdminProductUpdate), adminUpdateProduct);
// One product (full product page) — after every literal GET path
ProductRouter.get('/:id', getProductById);


export default ProductRouter;