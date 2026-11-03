import {ProductModel, CartModel} from '../models/product.model.js';
import { sendEmail } from "../../../services/emailService.js";
import {TransactionModel} from '../../transaction/models/transaction.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import { NotifyUseCase } from '../../../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { recordAudit } from '../../../modules/audit/index.js';

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
    await order.save();

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
    res.status(200).json({ message: `Order marked as ${status.toLowerCase()}!`, data: order, success: true });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'order.decide',
      targetType: 'order', targetId: String(order._id),
      detail: { status, amount: Number(order.totalCost) ?? null, owner: String(order.partner) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deciding order', error: error.message, success: false });
  }
};

const cleanProductFields = (body = {}) => {
  const out = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 200);
    if (!name) throw new Error('Product name is required');
    out.name = name;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new Error('Product price must be zero or more');
    out.price = Math.round(price * 100) / 100;
  }
  if (body.desc !== undefined) out.desc = String(body.desc).slice(0, 2000);
  if (body.img !== undefined) out.img = String(body.img).slice(0, 500);
  return out;
};

/**
 * Admin product catalog (role-gated at the route). Whitelisted fields
 * only — unlike legacy `updateProduct`, this never duplicates the row.
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
      //const { createdBy } = req.params; // Assuming createdBy is passed as a query parameter
  
      // get products
      const products = await ProductModel.find({});
  
      res.status(200).json({
        message: 'Products retrieved successfully!',
        data: products,
        success: true,
      });

    } catch (error) {
      res.status(500).json({
        message: 'Error retrieving Ads',
        error: error.message,
        success: false,
      });
    }
  };


// Update a product
export const updateProduct = async (req, res) => {
  try {
      const {id} = req.params;
      const product = await ProductModel.findByIdAndUpdate(id, req.body);
      if (!product) {
          return res.status(404).json({
              message: `Product not found`,
              success: false,
          })
      }
      const updatedProduct = await ProductModel.create(req.body);
      res.status(200).json({
        message: 'Products retrieved successfully!',
        data: updatedProduct,
        success: true,
      });

  } catch (error) {
      console.error(error.message);
      res.status(500).json({
          error: error.message,
          message: 'Error updating product',
          success: false,
      })
  }
}
 
// Save cart  
export const Savecart = async (req, res) => {  
  try {  
    const { products, partnerId } = req.body;  

    // Find the partner by ID  
    const partner = await PartnersModel.findById(partnerId);  
    if (!partner) {  
      return res.status(400).json({  
        message: 'Partner not found',  
        success: false,
      });  
    }  

    const cartProducts = [];  
    let totalCost = 0;  
  
    for (const productData of products) {  
      const product = await ProductModel.findOne({ _id: productData._id });  
      if (!product) {  
        console.warn(`Product with ID ${productData._id} not found. Skipping.`);  
        continue;  
      }  
  
      // Ensure price and quantity are valid numbers before calculating total cost  
      const price = Number(product.price);  
      const quantity = Number(productData.quantity);  
  
      if (!isNaN(price) && !isNaN(quantity) && quantity > 0) {  
        totalCost += price * quantity; // Calculate total cost based on price and quantity  
        cartProducts.push({ product: product._id, quantity }); // Add product ID and quantity to cartProducts  
      }  
    }  

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
        reference: Math.floor(100000000 + Math.random() * 900000000).toString() // Generate a random 9-digit number as string  
      });  

      await transaction.save();  

      // Create a new cart with products and total cost  
      const cart = new CartModel({  
        products: cartProducts,  
        totalCost: totalCost,  
        partner: partnerId,  
      });  
    
      await cart.save();  

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
            message: 'Cart saved successfully', 
            success: true,
            // Phase D glue: expose the order id so clients can accrue
            // commissions idempotently via POST /v1/billing/accrue/:cartId.
            data: { cartId: cart._id },
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

    // Fetch carts and populate the products field  
    const carts = await CartModel.find({ partner: partnerId })  
      .populate({  
        path: 'products.product', // Populate the product field within products  
        model: 'Product' // Specify the model to populate  
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