import crypto from 'node:crypto';
import {
  AppError,
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import {
  PartnersModel,
  runInTransaction,
} from '../../identity-access/infrastructure/Auth.models.js';
import {
  ActivationOrderModel,
  ActivationQueueEntryModel,
  KycSubmissionModel,
  StarterProductModel,
} from './Onboarding.models.js';

const opts = (session, extra = {}) => (session ? { ...extra, session } : extra);

const partnerProjection = 'name surname username email phone balance accountState kycStatus activatedAt createdAt emailVerified address';

export const partnerSummary = (partner) => {
  if (!partner) return null;
  return {
    id: String(partner._id),
    name: partner.name ?? '',
    surname: partner.surname ?? '',
    username: partner.username ?? '',
    email: partner.email ?? '',
    phone: partner.phone ?? '',
    balance: Number(partner.balance) || 0,
    accountState: partner.accountState === 'member' ? 'member' : 'partner',
    kycStatus: partner.kycStatus
      ?? (partner.accountState === 'member' ? 'not_started' : 'verified'),
    activatedAt: partner.activatedAt ?? null,
    createdAt: partner.createdAt ?? null,
    emailVerified: partner.emailVerified !== false,
    address: partner.address ? {
      street: partner.address.street ?? '',
      city: partner.address.city ?? '',
      state: partner.address.state ?? '',
      country: partner.address.country ?? 'Nigeria',
    } : null,
  };
};

export const publicOrder = (order) => {
  if (!order) return null;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    productName: order.productName,
    sku: order.sku,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    shipping: order.shipping,
    paymentMethod: order.paymentMethod,
    activatedAt: order.activatedAt,
    fulfilledAt: order.fulfilledAt ?? null,
    refundedAt: order.refundedAt ?? null,
    refundReason: order.refundReason ?? null,
    createdAt: order.createdAt,
  };
};

export const publicQueue = (entry, position = null) => {
  if (!entry) return null;
  return {
    status: entry.status,
    enteredAt: entry.enteredAt,
    allocatedAt: entry.allocatedAt ?? null,
    campaignId: entry.campaignId ? String(entry.campaignId) : null,
    placementParentId: entry.placementParentId ? String(entry.placementParentId) : null,
    cancelledAt: entry.cancelledAt ?? null,
    position: entry.status === 'queued' ? position : null,
  };
};

const publicKyc = (kyc) => {
  if (!kyc) return null;
  return {
    status: kyc.status,
    dateOfBirth: kyc.dateOfBirth,
    address: kyc.address,
    city: kyc.city,
    state: kyc.state,
    country: kyc.country,
    idType: kyc.idType,
    idLast4: kyc.idLast4,
    submittedAt: kyc.submittedAt,
    reviewedAt: kyc.reviewedAt ?? null,
    reviewNote: kyc.reviewNote ?? null,
  };
};

const orderNumber = () => (
  `MSA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
);

const ageOn = (dateOfBirth, now) => {
  const dob = new Date(dateOfBirth);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const month = now.getUTCMonth() - dob.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
};

const queuePosition = async (entry, session) => {
  if (!entry || entry.status !== 'queued') return null;
  const earlier = await ActivationQueueEntryModel.countDocuments(
    {
      status: 'queued',
      _id: { $ne: entry._id },
      enteredAt: { $lte: entry.enteredAt },
    },
    opts(session),
  );
  return earlier + 1;
};

export class MongoOnboardingRepository {
  async listProducts() {
    return StarterProductModel.find({ active: true })
      .sort({ sortOrder: 1, price: 1 })
      .lean();
  }

  async findProduct(productId, { session } = {}) {
    return StarterProductModel.findById(productId, null, opts(session)).lean();
  }

  async findById(partnerId, { session } = {}) {
    return PartnersModel.findById(partnerId, partnerProjection, opts(session)).lean();
  }

  async getStatus(partnerId) {
    const partner = await this.findById(partnerId);
    if (!partner) throw new NotFoundException('Partner account not found');

    const [order, kyc, queue] = await Promise.all([
      ActivationOrderModel.findOne({ partnerId }).sort({ createdAt: -1 }).lean(),
      KycSubmissionModel.findOne({ partnerId }).lean(),
      ActivationQueueEntryModel.findOne({ partnerId }).lean(),
    ]);

    return {
      partner: partnerSummary(partner),
      activationOrder: publicOrder(order),
      kyc: publicKyc(kyc),
      queue: publicQueue(queue, await queuePosition(queue)),
    };
  }

  async submitKyc(partnerId, input = {}) {
    const now = new Date();
    if (input.dateOfBirth) {
      const age = ageOn(input.dateOfBirth, now);
      if (!Number.isFinite(age) || age < 18) {
        throw new ValidationException('You must be at least 18 years old to activate');
      }
      if (age > 120) throw new ValidationException('Enter a valid date of birth');
    }

    return runInTransaction(async (session) => {
      const partner = await this.findById(partnerId, { session });
      if (!partner) throw new NotFoundException('Partner account not found');

      // Document/address fields are optional while the no-document KYC step is
      // in place. The identity step completes automatically on submit; when
      // document verification returns, this block can require them again.
      const rawIdNumber = String(input.idNumber ?? '').replace(/\s+/g, '').toUpperCase();
      const hashSecret = process.env.KYC_HASH_SECRET ?? process.env.JWTTOKENSECRET ?? 'marketspase-kyc';
      const idNumberHash = rawIdNumber
        ? crypto.createHmac('sha256', hashSecret).update(rawIdNumber).digest('hex')
        : null;
      const submission = await KycSubmissionModel.findOneAndUpdate(
        { partnerId },
        {
          $set: {
            dateOfBirth: input.dateOfBirth ?? null,
            address: input.address ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            country: input.country ?? 'Nigeria',
            idType: input.idType ?? null,
            idNumberHash,
            idLast4: rawIdNumber ? rawIdNumber.slice(-4) : null,
            status: 'verified',
            submittedAt: now,
            reviewedBy: null,
            reviewedAt: now,
            reviewNote: null,
          },
        },
        opts(session, { new: true, upsert: true, setDefaultsOnInsert: true }),
      ).lean();

      await PartnersModel.updateOne(
        { _id: partnerId },
        { $set: { kycStatus: 'verified', kycSubmittedAt: now, kycVerifiedAt: now } },
        opts(session),
      );

      return publicKyc(submission);
    });
  }

  async createOrder({ partnerId, productId, shipping, idempotencyKey }) {
    const now = new Date();

    const existingByIdempotency = async (session) => {
      if (!idempotencyKey) return null;
      const order = await ActivationOrderModel.findOne(
        { partnerId, idempotencyKey },
        null,
        opts(session),
      ).lean();
      if (!order) return null;
      const queue = await ActivationQueueEntryModel.findOne({ partnerId }, null, opts(session)).lean();
      return {
        order: publicOrder(order),
        queue: publicQueue(queue, await queuePosition(queue, session)),
        repeated: true,
      };
    };

    const current = await existingByIdempotency();
    if (current) return current;

    try {
      return await runInTransaction(async (session) => {
        const replay = await existingByIdempotency(session);
        if (replay) return replay;

        const partner = await this.findById(partnerId, { session });
        if (!partner) throw new NotFoundException('Partner account not found');
        if (partner.accountState !== 'member') {
          throw new ConflictException('Your account is already an activated partner');
        }
        const kycStatus = partner.kycStatus ?? 'not_started';
        if (kycStatus === 'not_started') {
          throw new ValidationException('Submit identity verification before activating');
        }
        if (kycStatus === 'rejected') {
          throw new ConflictException('Identity verification was rejected. Please resubmit before activating.');
        }

        const product = await this.findProduct(productId, { session });
        if (!product || product.active === false) {
          throw new NotFoundException('Starter product not found');
        }
        if (Number(partner.balance) < Number(product.price)) {
          throw new AppError('Insufficient wallet balance', 409, 'INSUFFICIENT_BALANCE');
        }

        const number = orderNumber();
        const cogs = Math.max(Number(product.cogs) || 0, 0);
        const shippingCost = Math.max(Number(product.shippingCost) || 0, 0);
        const paymentFee = Math.round(Number(product.price) * 0.015 * 100) / 100;
        const grossMargin = Math.max(Number(product.price) - cogs - shippingCost - paymentFee, 0);
        const [order] = await ActivationOrderModel.create(
          [{
            orderNumber: number,
            partnerId,
            productId: product._id,
            productName: product.name,
            sku: product.sku,
            amount: product.price,
            currency: product.currency ?? 'NGN',
            cogs,
            shippingCost,
            paymentFee,
            grossMargin,
            status: 'Paid',
            shipping,
            paymentMethod: 'Wallet',
            paymentReference: number,
            idempotencyKey: idempotencyKey || undefined,
            activatedAt: now,
          }],
          opts(session),
        );

        const activated = await PartnersModel.findOneAndUpdate(
          {
            _id: partnerId,
            accountState: 'member',
            balance: { $gte: product.price },
          },
          {
            $inc: { balance: -Number(product.price) },
            $set: {
              accountState: 'partner',
              activatedAt: now,
              activationOrderId: order._id,
              address: {
                street: shipping.street,
                city: shipping.city,
                state: shipping.state,
                country: shipping.country ?? 'Nigeria',
              },
            },
          },
          opts(session, { new: true }),
        ).lean();

        if (!activated) {
          throw new AppError('Insufficient wallet balance', 409, 'INSUFFICIENT_BALANCE');
        }

        await TransactionModel.create(
          [{
            partnerId,
            amount: product.price,
            reference: number,
            status: 'Completed',
            paymentMethod: 'Wallet',
            transactionType: 'Debit',
            date: now,
          }],
          opts(session),
        );

        const queue = await ActivationQueueEntryModel.findOneAndUpdate(
          { partnerId },
          {
            $set: {
              status: 'queued',
              enteredAt: now,
              allocatedAt: null,
              campaignId: null,
              placementParentId: null,
              cancelledAt: null,
            },
            $setOnInsert: { partnerId },
          },
          opts(session, { new: true, upsert: true, setDefaultsOnInsert: true }),
        ).lean();

        return {
          order: publicOrder(order.toObject()),
          queue: publicQueue(queue, await queuePosition(queue, session)),
          partner: partnerSummary(activated),
          grossMargin,
          repeated: false,
        };
      });
    } catch (error) {
      if (error?.code === 11000 && idempotencyKey) {
        const replay = await existingByIdempotency();
        if (replay) return replay;
      }
      throw error;
    }
  }

  async listMyOrders(partnerId, { limit = 20 } = {}) {
    const orders = await ActivationOrderModel.find({ partnerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
      .lean();
    return orders.map(publicOrder);
  }

  async listAdminOrders({ status, page = 1, limit = 25 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      ActivationOrderModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((current - 1) * size)
        .limit(size)
        .lean(),
      ActivationOrderModel.countDocuments(filter),
    ]);

    const ids = [...new Set(rows.map((row) => String(row.partnerId)))];
    const partners = await PartnersModel.find({ _id: { $in: ids } })
      .select('name surname username email phone')
      .lean();
    const labels = new Map(partners.map((p) => [
      String(p._id),
      [p.name, p.surname].filter(Boolean).join(' ') || p.username || p.email,
    ]));

    return {
      data: rows.map((row) => ({
        ...publicOrder(row),
        partner: {
          id: String(row.partnerId),
          name: labels.get(String(row.partnerId)) ?? 'Member',
        },
        fulfilledBy: row.fulfilledBy ? String(row.fulfilledBy) : null,
        refundedBy: row.refundedBy ? String(row.refundedBy) : null,
        adminNote: row.adminNote ?? null,
      })),
      meta: {
        page: current,
        limit: size,
        total,
        pages: Math.max(Math.ceil(total / size), 1),
      },
    };
  }

  async fulfillOrder(orderId, adminId) {
    const now = new Date();
    const updated = await ActivationOrderModel.findOneAndUpdate(
      { _id: orderId, status: 'Paid' },
      { $set: { status: 'Fulfilled', fulfilledAt: now, fulfilledBy: adminId } },
      { new: true },
    ).lean();
    if (updated) return publicOrder(updated);

    const order = await ActivationOrderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException('Activation order not found');
    if (order.status === 'Fulfilled') return publicOrder(order);
    throw new ConflictException(`Cannot fulfil an order that is ${order.status.toLowerCase()}`);
  }

  async refundOrder(orderId, adminId, reason) {
    const now = new Date();

    return runInTransaction(async (session) => {
      const order = await ActivationOrderModel.findById(orderId, null, opts(session)).lean();
      if (!order) throw new NotFoundException('Activation order not found');
      if (order.status === 'Refunded') {
        return { order: publicOrder(order), repeated: true };
      }
      if (order.status === 'Cancelled') {
        throw new ConflictException('Cancelled orders cannot be refunded');
      }

      const queue = await ActivationQueueEntryModel.findOne(
        { partnerId: order.partnerId },
        null,
        opts(session),
      ).lean();
      if (queue?.status === 'allocated') {
        throw new ConflictException('This partner is already allocated. Resolve the placement before refunding.');
      }

      const refunded = await ActivationOrderModel.findOneAndUpdate(
        { _id: orderId, status: { $in: ['Paid', 'Fulfilled'] } },
        {
          $set: {
            status: 'Refunded',
            refundedAt: now,
            refundedBy: adminId,
            refundReason: reason,
          },
        },
        opts(session, { new: true }),
      ).lean();

      if (!refunded) {
        const latest = await ActivationOrderModel.findById(orderId, null, opts(session)).lean();
        if (latest?.status === 'Refunded') {
          return { order: publicOrder(latest), repeated: true };
        }
        throw new ConflictException('Order can no longer be refunded');
      }

      const deactivated = await PartnersModel.findOneAndUpdate(
        { _id: order.partnerId, activationOrderId: order._id },
        {
          $inc: { balance: Number(order.amount) },
          $set: {
            accountState: 'member',
            activatedAt: null,
            activationOrderId: null,
          },
        },
        opts(session, { new: true }),
      ).lean();

      if (!deactivated) {
        await PartnersModel.updateOne(
          { _id: order.partnerId },
          { $inc: { balance: Number(order.amount) } },
          opts(session),
        );
      }

      await TransactionModel.create(
        [{
          partnerId: order.partnerId,
          amount: order.amount,
          reference: `REF-${order.orderNumber}`,
          status: 'Completed',
          paymentMethod: 'Wallet',
          transactionType: 'Credit',
          date: now,
          decidedBy: adminId,
          decidedAt: now,
          decisionNote: reason,
        }],
        opts(session),
      );

      await ActivationQueueEntryModel.updateOne(
        { partnerId: order.partnerId, status: 'queued' },
        { $set: { status: 'cancelled', cancelledAt: now } },
        opts(session),
      );

      const partner = await this.findById(order.partnerId, { session });
      return {
        order: publicOrder(refunded),
        partner: partnerSummary(partner),
        repeated: false,
      };
    });
  }

  async listKyc({ status, page = 1, limit = 25 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      KycSubmissionModel.find(filter)
        .sort({ submittedAt: 1 })
        .skip((current - 1) * size)
        .limit(size)
        .lean(),
      KycSubmissionModel.countDocuments(filter),
    ]);

    const ids = rows.map((row) => String(row.partnerId));
    const partners = await PartnersModel.find({ _id: { $in: ids } })
      .select('name surname username email phone')
      .lean();
    const labels = new Map(partners.map((p) => [
      String(p._id),
      {
        name: [p.name, p.surname].filter(Boolean).join(' ') || p.username || p.email,
        username: p.username,
        email: p.email,
        phone: p.phone,
      },
    ]));

    return {
      data: rows.map((row) => ({
        ...publicKyc(row),
        partner: { id: String(row.partnerId), ...(labels.get(String(row.partnerId)) ?? { name: 'Member' }) },
      })),
      meta: {
        page: current,
        limit: size,
        total,
        pages: Math.max(Math.ceil(total / size), 1),
      },
    };
  }

  async verifyKyc(partnerId, adminId) {
    return this.reviewKyc(partnerId, adminId, 'verified', null);
  }

  async rejectKyc(partnerId, adminId, note) {
    return this.reviewKyc(partnerId, adminId, 'rejected', note);
  }

  async reviewKyc(partnerId, adminId, status, note) {
    const now = new Date();
    return runInTransaction(async (session) => {
      const submission = await KycSubmissionModel.findOneAndUpdate(
        { partnerId },
        {
          $set: {
            status,
            reviewedBy: adminId,
            reviewedAt: now,
            reviewNote: note,
          },
        },
        opts(session, { new: true }),
      ).lean();

      if (!submission) throw new NotFoundException('KYC submission not found');

      await PartnersModel.updateOne(
        { _id: partnerId },
        {
          $set: {
            kycStatus: status,
            kycVerifiedAt: status === 'verified' ? now : null,
          },
        },
        opts(session),
      );

      return publicKyc(submission);
    });
  }
}
