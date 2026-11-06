import {ProductModel, CartModel} from '../models/product.model.js';
import { sendEmail } from "../../../services/emailService.js";
import {TransactionModel} from '../../transaction/models/transaction.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import { NotifyUseCase } from '../../../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { recordAudit } from '../../../modules/audit/index.js';
import { MongoCompensationRepository } from '../../../modules/compensation/infrastructure/Compensation.mongo.repository.js';
import {
  AccrueProductCommissionsUseCase,
  ReleaseProductCommissionsUseCase,
  VoidProductCommissionsUseCase,
} from '../../../modules/compensation/application/ProductCommission.usecases.js';
import { summarizeProductMargins } from '../../../modules/compensation/domain/ProductCommission.js';
import { cleanShipping } from '../domain/Shipping.js';
import { canBuyResale, cartSaleMode, resalePrices } from '../domain/Resale.js';

const productCommissionPlan = () => (
  process.env.PRODUCT_COMMISSION_PLAN === 'legacy' ? 'legacy' : 'growth'
);

const productOrderNumber = () => (
  `PRD-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`
);

const productCommissionRepo = () => new MongoCompensationRepository();

// Admin queue: every order by status, oldest first (money already debited).
export const listOrdersForAdmin = async (req, res) => {
  try {
    const status = req.query.status ?? 'Pending';
    if (!['Pending', 'Fulfilled', 'Cancelled'].includes(status) && status !== 'All') {
      return res.status(400).json({ message: 'Invalid status filter', success: false });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const filter = status === 'All' ? {} : { orderStatus: status };
    const [rows, total] = await Promise.all([
      CartModel.find(filter)
        .populate('products.product', 'name price')
        .sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      CartModel.countDocuments(filter),
    ]);
    const ownerIds = [...new Set(rows.map((r) => String(r.partner)).filter(Boolean))];
    const owners = ownerIds.length > 0
      ? await PartnersModel.find({ _id: { $in: ownerIds } }).select('username name surname phone').lean().catch(() => [])
      : [];
    const labels = Object.fromEntries((owners ?? []).map((o) => [String(o._id), {
      username: o.username,
      name: [o.name, o.surname].filter(Boolean).join(' ') || o.username,
      phone: o.phone ?? null,
    }]));
    res.status(200).json({
      message: 'Orders retrieved successfully!',
      data: rows.map((r) => ({ ...r, owner: labels[String(r.partner)] ?? null })),
      meta: { total, limit, skip },
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving orders', error: error.message, success: false });
  }
};

/** Best-effort owner notice — never fails the decision. */
const notifyBuyer = async (ownerId, { title, body, orderId, status }) => {
  try {
    const stored = new MongoStoredNotificationStore();
    await new NotifyUseCase({ stored }).execute({
      recipientId: String(ownerId),
      category: 'commission',
      priority: 'medium',
      title,
      body,
      icon: 'shopping_bag',
      link: '/dashboard/products/order-history',
      key: `order:${orderId}:${status}`,
    }).catch(() => null);
  } catch { /* notifications never fail admin actions */ }
};

// Admin decision: Pending→Fulfilled (ship it) or →Cancelled (full refund —
export const decideOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!['Fulfilled', 'Cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status', success: false });
    }
    const order = await CartModel.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found', success: false });
    }
    if ((order.orderStatus ?? 'Pending') !== 'Pending') {
      return res.status(409).json({ message: `Cannot decide a ${order.orderStatus} order`, success: false });
    }
    order.orderStatus = status;
    order.decidedAt = new Date();
    if (status === 'Fulfilled') order.fulfilledAt = order.decidedAt;
    else order.cancelledAt = order.decidedAt;
    await order.save();

    // Product commissions: growth carts accrue on the product margin and
    // release only after fulfilment. Legacy carts keep their old flow.
    let commission = null;
    if (order.commissionPlan === 'growth') {
      const repo = productCommissionRepo();
      try {
        if (status === 'Fulfilled') {
          await new AccrueProductCommissionsUseCase({ repo }).execute(order._id);
          commission = await new ReleaseProductCommissionsUseCase({ repo })
            .execute(order._id, req.auth?.partnerId);
        } else {
          commission = await new VoidProductCommissionsUseCase({ repo })
            .execute(order._id, req.auth?.partnerId, 'Product order cancelled');
        }
      } catch (commissionError) {
        console.error('Product commission update failed:', commissionError?.message ?? commissionError);
        commission = { error: true };
      }
    }

    if (status === 'Cancelled') {
      const owner = await PartnersModel.findById(order.partner);
      if (owner && Number(order.totalCost) > 0) {
        owner.balance = Number(owner.balance ?? 0) + Number(order.totalCost);
        await owner.save();
        await TransactionModel.create({
          partnerId: owner._id,
          amount: Number(order.totalCost),
          status: 'Completed',
          paymentMethod: 'Order Refund',
          transactionType: 'Credit',
          reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
        });
      }
    }

    await notifyBuyer(order.partner, {
      title: status === 'Fulfilled' ? 'Your order is on its way' : 'Your order was cancelled',
      body: status === 'Fulfilled'
        ? `Order worth ₦${Number(order.totalCost).toLocaleString()} has been fulfilled.`
        : `Your order was cancelled and ₦${Number(order.totalCost).toLocaleString()} was refunded in full.`,
      orderId: String(order._id),
      status,
    });
    res.status(200).json({ message: `Order marked as ${status.toLowerCase()}!`, data: order, commission, success: true });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'order.decide',
      targetType: 'order', targetId: String(order._id),
      detail: {
        status,
        amount: Number(order.totalCost) ?? null,
        owner: String(order.partner),
        commission: commission ? { released: commission.released ?? 0, voided: commission.voided ?? 0, error: !!commission.error } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deciding order', error: error.message, success: false });
  }
};

const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);

const cleanNumber = (value, label, { min = 0, allowNull = false } = {}) => {
  if (allowNull && (value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw new Error(`${label} must be ${min} or more`);
  }
  return Math.round(number * 100) / 100;
};

const cleanStringList = (value, { maxItems = 8, maxLength = 300 } = {}) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
};

const cleanProductFields = (body = {}) => {
  const out = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 200);
    if (!name) throw new Error('Product name is required');
    out.name = name;
  }
  if (body.price !== undefined) {
    out.price = cleanNumber(body.price, 'Product price');
  }
  if (body.sku !== undefined) out.sku = cleanText(body.sku, 64);
  if (body.desc !== undefined) out.desc = String(body.desc).slice(0, 8000);
  if (body.img !== undefined) out.img = cleanText(body.img, 500);
  if (body.gallery !== undefined) out.gallery = cleanStringList(body.gallery, { maxItems: 8, maxLength: 500 });
  if (body.category !== undefined) out.category = cleanText(body.category, 80) || 'Essentials';
  if (body.shortDesc !== undefined) out.shortDesc = cleanText(body.shortDesc, 240);
  if (body.benefits !== undefined) out.benefits = cleanStringList(body.benefits, { maxItems: 8, maxLength: 200 });
  if (body.howToUse !== undefined) out.howToUse = cleanText(body.howToUse, 1200);
  if (body.deliveryNote !== undefined) out.deliveryNote = cleanText(body.deliveryNote, 1200);
  if (body.cogs !== undefined) out.cogs = cleanNumber(body.cogs, 'Cost price');
  if (body.shippingCost !== undefined) out.shippingCost = cleanNumber(body.shippingCost, 'Shipping cost');
  if (body.partnerPrice !== undefined) out.partnerPrice = cleanNumber(body.partnerPrice, 'Partner price');
  if (body.retailPrice !== undefined) out.retailPrice = cleanNumber(body.retailPrice, 'Retail price');
  if (body.stock !== undefined) {
    out.stock = body.stock === null ? null : cleanNumber(body.stock, 'Stock');
  }
  if (body.status !== undefined) {
    if (!['active', 'inactive', 'archived'].includes(body.status)) {
      throw new Error('Product status must be active, inactive or archived');
    }
    out.status = body.status;
  }
  if (body.commissionable !== undefined) out.commissionable = Boolean(body.commissionable);
  if (body.featured !== undefined) out.featured = Boolean(body.featured);
  if (body.sortOrder !== undefined) {
    const order = Number(body.sortOrder);
    if (!Number.isFinite(order)) throw new Error('Sort order must be a number');
    out.sortOrder = Math.round(order);
  }
  return out;
};

/**
 * Admin product catalog (role-gated at the route). Whitelisted fields
 * only; updates never duplicate the row.
 */
export const adminCreateProduct = async (req, res) => {
  try {
    const fields = cleanProductFields(req.body ?? {});
    if (!fields.name || fields.price === undefined) {
      return res.status(400).json({ message: 'Product name and price are required', success: false });
    }
    const product = await ProductModel.create(fields);
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'product.create',
      targetType: 'product', targetId: String(product._id),
      detail: { name: product.name, price: product.price },
    });
    res.status(200).json({ message: 'Product created successfully!', data: product, success: true });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Error creating product', success: false });
  }
};

export const adminUpdateProduct = async (req, res) => {
  try {
    const fields = cleanProductFields(req.body ?? {});
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ message: 'Nothing to update', success: false });
    }
    const product = await ProductModel.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true }).lean();
    if (!product) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'product.update',
      targetType: 'product', targetId: String(product._id),
      detail: fields,
    });
    res.status(200).json({ message: 'Product updated successfully!', data: product, success: true });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Error updating product', success: false });
  }
};


  
// get all products
export const getAllProducts = async (req, res) => {
    try {
      // Hidden rows stay in the database for order history, but never show
      // in the member/partner catalog.
      const products = await ProductModel.find({
        status: { $nin: ['inactive', 'archived'] },
      })
        .select('-cogs -shippingCost -partnerPrice -retailPrice -commissionable')
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

      res.status(200).json({
        message: 'Products retrieved successfully!',
        data: products,
        success: true,
      });

    } catch (error) {
      res.status(500).json({
        message: 'Error retrieving products',
        error: error.message,
        success: false,
      });
    }
  };

// Admin catalog: full docs including cost/commission fields.
export const listProductsForAdmin = async (req, res) => {
  try {
    const products = await ProductModel.find({}).sort({ createdAt: -1 }).lean();
    res.status(200).json({
      message: 'Products retrieved successfully!',
      data: products,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving products',
      error: error.message,
      success: false,
    });
  }
};

// Partner-only resale catalog: partner price and suggested retail.
export const listResaleProducts = async (req, res) => {
  try {
    const partner = await PartnersModel.findById(req.auth?.partnerId)
      .select('accountState kycStatus suspendedAt')
      .lean();
    if (!partner || !canBuyResale(partner)) {
      return res.status(403).json({
        message: 'Resale pricing is available to verified partners',
        success: false,
      });
    }

    const products = await ProductModel.find({
      status: 'active',
      partnerPrice: { $gt: 0 },
    })
      .select('name img category shortDesc price partnerPrice retailPrice stock featured sortOrder')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    res.status(200).json({
      message: 'Resale products retrieved successfully!',
      data: products,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving resale products',
      error: error.message,
      success: false,
    });
  }
};

// get one product for the full product page
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(String(id))) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    const product = await ProductModel.findOne({
      _id: id,
      status: { $nin: ['inactive', 'archived'] },
    })
      .select('-cogs -shippingCost -partnerPrice -retailPrice -commissionable')
      .lean();
    if (!product) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    res.status(200).json({
      message: 'Product retrieved successfully!',
      data: product,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving product',
      error: error.message,
      success: false,
    });
  }
};


// Save cart  
export const Savecart = async (req, res) => {  
  try {  
    const { products } = req.body;
    const partnerId = req.auth?.partnerId;

    if (!partnerId) {
      return res.status(401).json({
        message: 'Sign in to place an order',
        success: false,
      });
    }

    // Find the partner by ID  
    const partner = await PartnersModel.findById(partnerId);  
    if (!partner) {  
      return res.status(400).json({  
        message: 'Partner not found',  
        success: false,
      });  
    }  

    const shipping = cleanShipping(req.body.shipping) ?? cleanShipping({
      fullName: [partner.name, partner.surname].filter(Boolean).join(' '),
      phone: partner.phone,
      street: partner.address?.street,
      city: partner.address?.city,
      state: partner.address?.state,
      country: partner.address?.country,
    });
    if (!shipping) {
      return res.status(400).json({
        message: 'Add a delivery address before placing this order',
        success: false,
      });
    }

    const commissionPlan = productCommissionPlan();
    const orderNumber = productOrderNumber();
    const cartProducts = [];
    const marginLines = [];
    let totalCost = 0;  

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        message: 'Your cart is empty',
        success: false,
      });
    }

    for (const productData of products) {  
      const product = await ProductModel.findOne({
        _id: productData._id,
        status: { $nin: ['inactive', 'archived'] },
      });
      if (!product) {  
        return res.status(400).json({
          message: 'One of the products in your cart is no longer available. Remove it and try again.',
          success: false,
        });
      }  
  
      // Ensure price and quantity are valid numbers before calculating total cost  
      const quantity = Number(productData.quantity);  
      const lineMode = productData.saleMode === 'resale' ? 'resale' : 'personal';
      const prices = resalePrices(product);
      const unitPrice = lineMode === 'resale' ? prices.partnerPrice : Number(product.price);
      const retailPrice = lineMode === 'resale' ? prices.retailPrice : 0;

      if (lineMode === 'resale' && !canBuyResale(partner)) {
        return res.status(403).json({
          message: 'Resale pricing is available to verified partners',
          success: false,
        });
      }

      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({
          message: lineMode === 'resale'
            ? `Product "${product.name ?? 'item'}" does not have a resale price yet. Contact support.`
            : `Product "${product.name ?? 'item'}" is price-on-request. Contact support before ordering.`,
          success: false,
        });
      }

      if (!isNaN(quantity) && quantity > 0) {
        const cogs = Math.max(Number(product.cogs) || 0, 0);
        const shippingCost = Math.max(Number(product.shippingCost) || 0, 0);
        const commissionable = product.commissionable === true && cogs > 0;

        totalCost += unitPrice * quantity;
        cartProducts.push({
          product: product._id,
          quantity,
          price: unitPrice,
          cogs,
          shippingCost,
          commissionable,
          saleMode: lineMode,
          retailPrice,
        });
        marginLines.push({ price: unitPrice, quantity, cogs, shippingCost, commissionable });
      }  
    }  

    if (totalCost <= 0 || cartProducts.length === 0) {
      return res.status(400).json({
        message: 'Order total must be greater than zero',
        success: false,
      });
    }

    const saleMode = cartSaleMode(cartProducts);

    const { grossMargin, commissionableMargin } = summarizeProductMargins(marginLines);

    // Check if the partner has sufficient balance  
    if (partner.balance >= totalCost) {  
      // Deduct the total cost from partner's balance  
      partner.balance -= totalCost;  

      // Save the updated partner balance  
      await partner.save();  

      // Record the transaction  
      const transaction = new TransactionModel({  
        partnerId: partner._id,  
        amount: totalCost,  
        status: 'Completed',  
        paymentMethod: 'Product Purchase',  
        transactionType: 'Debit',  
        reference: orderNumber,
      });  

      await transaction.save();  

      // Create a new cart with the price/cost snapshot used for commission.
      const cart = new CartModel({  
        orderNumber,
        products: cartProducts,  
        totalCost: totalCost,  
        grossMargin,
        commissionableMargin,
        commissionPlan,
        saleMode,
        shipping,
        paymentMethod: 'Wallet',
        paymentReference: orderNumber,
        partner: partnerId,  
      });  
    
      await cart.save();  

      // Growth-plan orders accrue here. A failure never blocks the paid
      // order; fulfilment retries the accrual before releasing.
      let commission = null;
      if (commissionPlan === 'growth') {
        try {
          const result = await new AccrueProductCommissionsUseCase({ repo: productCommissionRepo() })
            .execute(cart._id);
          commission = {
            entries: result.entries?.length ?? 0,
            deduped: !!result.deduped,
          };
        } catch (commissionError) {
          console.error('Product commission accrual failed:', commissionError?.message ?? commissionError);
          commission = { error: true };
        }
      }

      // Send email after successfully submitting the records  
      const emailSubject = 'Product Order Confirmation';  
      const emailMessage = `  
          <h1>Product Orders</h1>  
          <p>A partner just made an order on the platform</p>  
          <p>You may have to follow up on partner to close out the order.</p>  

      `;  

      // Use the found user's email to send the email  
      //await sendEmail(user.email, emailSubject, emailMessage);  

      //const emailsToSend = [partner.email, 'ago.fnc@gmail.com'];
      const emailsToSend = ['ago.fnc@gmail.com'];

      for (const email of emailsToSend) {
          await sendEmail(email, emailSubject, emailMessage);
      }

        res.status(200).json({ 
            message: 'Order placed successfully',
            success: true,
            data: {
              cartId: cart._id,
              orderNumber,
              commissionPlan,
              commission,
            },
        });   

    } else {  
      return res.status(401).json({  
        message: 'Insufficient balance for transaction',  
        success: false,
      });   
    }   
  } catch (error) {  
    res.status(500).json({ 
        message: 'Failed to save cart', 
        error: error.message,
        success: false,
    });  
  }  
}

// Fetch all carts
export const GetAllCartsBy = async (req, res) => {  
  try {  
    const { partnerId } = req.params;   
    if (!req.auth?.partnerId || String(req.auth.partnerId) !== String(partnerId)) {
      return res.status(403).json({
        message: 'You can only view your own orders',
        success: false,
      });
    }

    // Fetch carts and populate the products field. Cost/margin snapshots are
    // internal — the buyer sees what they paid, not what the platform paid.
    const carts = await CartModel.find({ partner: partnerId })
      .select('-grossMargin -commissionableMargin -commissionPlan -products.cogs -products.shippingCost -products.commissionable')
      .sort({ createdAt: -1 })
      .populate({  
        path: 'products.product', // Populate the product field within products  
        model: 'Product', // Specify the model to populate
        select: 'name price img category desc',
      });  

    res.status(200).json({
        data: carts, 
        message: 'Carts retrieved successfully', 
        success: true
    });  
  } catch (error) {  
    res.status(500).json({ 
        message: 'Failed to fetch carts',
         error: error.message,
        success: false,
    });  
  }  
}