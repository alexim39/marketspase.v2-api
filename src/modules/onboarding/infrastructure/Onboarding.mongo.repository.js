import crypto from 'node:crypto';
import {
  AppError,
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { open, seal } from '../../../shared/security/fieldCrypto.js';
import {
  PartnersModel,
  runInTransaction,
} from '../../identity-access/infrastructure/Auth.models.js';
import { partnerCapabilities } from '../../identity-access/domain/PartnerCapabilities.js';
import { debitPartnerWallet } from '../../billing/application/Deposit.usecases.js';
import {
  ActivationOrderModel,
  ActivationQueueEntryModel,
  KycSubmissionModel,
  StarterProductModel,
} from './Onboarding.models.js';
import {
  UPGRADE_HANDLING_FEE_NGN,
  upgradePriceFor,
} from '../domain/StarterProduct.js';

const opts = (session, extra = {}) => (session ? { ...extra, session } : extra);

const partnerProjection = 'name surname username email phone balance bonusBalance accountState activationTier upgradedAt upgradeOrderId kycStatus suspendedAt activatedAt createdAt emailVerified address partnerOf systemOwned mentorContactPreference mentorContactConsentAt mentorContactPreferenceUpdatedAt';

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
    bonusBalance: Math.max(Number(partner.bonusBalance) || 0, 0),
    // Activation is cash-only, so the UI must show what is actually spendable.
    withdrawableBalance: Math.max(
      (Number(partner.balance) || 0) - Math.max(Number(partner.bonusBalance) || 0, 0),
      0,
    ),
    accountState: partner.accountState === 'member' ? 'member' : 'partner',
    activationTier: partner.activationTier === 'essential' ? 'essential' : 'signature',
    upgradedAt: partner.upgradedAt ?? null,
    kycStatus: partner.kycStatus
      ?? (partner.accountState === 'member' ? 'not_started' : 'verified'),
    activatedAt: partner.activatedAt ?? null,
    createdAt: partner.createdAt ?? null,
    emailVerified: partner.emailVerified !== false,
    mentorContactPreference: partner.mentorContactPreference ?? 'in_app',
    mentorContactConsentAt: partner.mentorContactConsentAt ?? null,
    mentorContactPreferenceUpdatedAt: partner.mentorContactPreferenceUpdatedAt ?? null,
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
    tier: order.tier === 'essential' ? 'essential' : 'signature',
    kind: order.kind === 'upgrade' ? 'upgrade' : 'activation',
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    shipping: order.shipping,
    paymentMethod: order.paymentMethod,
    mentorContactPreference: order.mentorContactPreference ?? 'in_app',
    mentorContactConsentAt: order.mentorContactConsentAt ?? null,
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
    cancelledAt: entry.cancelledAt ?? null,
    position: entry.status === 'queued' ? position : null,
  };
};

const publicKyc = (kyc) => {
  if (!kyc) return null;
  return {
    status: kyc.status,
    dateOfBirth: kyc.dateOfBirth,
    address: open(kyc.address),
    city: open(kyc.city),
    state: open(kyc.state),
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

    const [order, kyc, queue, sponsor] = await Promise.all([
      ActivationOrderModel.findOne({ partnerId }).sort({ createdAt: -1 }).lean(),
      KycSubmissionModel.findOne({ partnerId }).lean(),
      ActivationQueueEntryModel.findOne({ partnerId }).lean(),
      partner.partnerOf
        ? PartnersModel.findById(partner.partnerOf).select('name surname username').lean().catch(() => null)
        : null,
    ]);

    return {
      partner: partnerSummary(partner),
      activationOrder: publicOrder(order),
      upgrade: await this.upgradeQuote(partner, order),
      kyc: publicKyc(kyc),
      queue: publicQueue(queue, await queuePosition(queue)),
      sponsor: sponsor ? {
        id: String(sponsor._id),
        name: [sponsor.name, sponsor.surname].filter(Boolean).join(' ') || sponsor.username || 'Your sponsor',
        username: sponsor.username ?? '',
      } : null,
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
            address: seal(input.address),
            city: seal(input.city),
            state: seal(input.state),
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

  async createOrder({
    partnerId,
    productId,
    shipping,
    idempotencyKey,
    mentorContactPreference = 'in_app',
    mentorContactConsent = false,
  }) {
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

        const allowedPreferences = ['in_app', 'email', 'whatsapp', 'phone', 'prefer_not_now'];
        const preference = allowedPreferences.includes(mentorContactPreference)
          ? mentorContactPreference
          : 'in_app';
        const needsConsent = ['email', 'whatsapp', 'phone'].includes(preference);
        if (needsConsent && mentorContactConsent !== true) {
          throw new ValidationException('Agree to share your chosen contact channel with your mentor');
        }
        if (preference === 'email' && !partner.email) {
          throw new ValidationException('Add an email address before choosing email');
        }
        if (['whatsapp', 'phone'].includes(preference) && !partner.phone) {
          throw new ValidationException('Add a phone number before choosing WhatsApp or phone');
        }
        const mentorContactConsentAt = needsConsent ? now : null;

        const kycStatus = partner.kycStatus ?? 'not_started';
        const capabilities = partnerCapabilities(partner);
        if (kycStatus === 'rejected') {
          throw new ConflictException('Identity verification was rejected. Please resubmit before activating.');
        }
        if (!capabilities.kycVerified) {
          throw new ValidationException(
            kycStatus === 'pending'
              ? 'Your identity verification is still under review. Activation opens once it is verified.'
              : 'Verify your identity before activating',
          );
        }

        const product = await this.findProduct(productId, { session });
        if (!product || product.active === false) {
          throw new NotFoundException('Starter product not found');
        }
        // Activation is cash-only: bonus credit unlocks after activation.
        const bonusBalance = Math.max(Number(partner.bonusBalance) || 0, 0);
        const cashAvailable = Math.max(Number(partner.balance) - bonusBalance, 0);
        if (cashAvailable < Number(product.price)) {
          throw new AppError(
            'Insufficient wallet balance. Activation is paid from cash only; bonus credit unlocks after activation.',
            409,
            'INSUFFICIENT_BALANCE',
          );
        }

        const number = orderNumber();
        const cogs = Math.max(Number(product.cogs) || 0, 0);
        const shippingCost = Math.max(Number(product.shippingCost) || 0, 0);
        const paymentFee = Math.round(Number(product.price) * 0.015 * 100) / 100;
        const grossMargin = Math.max(Number(product.price) - cogs - shippingCost - paymentFee, 0);
        const tier = product.tier === 'essential' ? 'essential' : 'signature';
        const planMentorBonus = product.mentorBonus === null || product.mentorBonus === undefined
          ? null
          : Math.max(Number(product.mentorBonus) || 0, 0);
        const [order] = await ActivationOrderModel.create(
          [{
            orderNumber: number,
            partnerId,
            productId: product._id,
            productName: product.name,
            sku: product.sku,
            tier,
            kind: 'activation',
            mentorBonusAmount: planMentorBonus,
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
            mentorContactPreference: preference,
            mentorContactConsentAt,
            activatedAt: now,
          }],
          opts(session),
        );

        const debit = await debitPartnerWallet(
          { partners: PartnersModel },
          {
            partnerId,
            amountNgn: product.price,
            bonusPolicy: 'cash_only',
            filter: { accountState: 'member' },
            set: {
              accountState: 'partner',
              activationTier: tier,
              activatedAt: now,
              activationOrderId: order._id,
              ...(partner.partnerOf ? { systemOwned: false } : {}),
              mentorContactPreference: preference,
              mentorContactConsentAt,
              mentorContactPreferenceUpdatedAt: now,
              address: {
                street: shipping.street,
                city: shipping.city,
                state: shipping.state,
                country: shipping.country ?? 'Nigeria',
              },
            },
          },
          opts(session),
        );
        if (!debit) {
          throw new AppError('Insufficient wallet balance', 409, 'INSUFFICIENT_BALANCE');
        }
        const activated = debit.partner;

        await TransactionModel.create(
          [{
            partnerId,
            amount: product.price,
            bonusAmount: debit.bonusUsed,
            balanceBefore: Number(activated.balance ?? 0) + Number(product.price),
            balanceAfter: activated.balance ?? null,
            reference: number,
            status: 'Completed',
            paymentMethod: 'Wallet',
            transactionType: 'Debit',
            date: now,
          }],
          opts(session),
        );

        const queue = activated.partnerOf
          ? null
          : await ActivationQueueEntryModel.findOneAndUpdate(
            { partnerId },
            {
              $set: {
                status: 'queued',
                tier,
                enteredAt: now,
                allocatedAt: null,
                campaignId: null,
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

  /**
   * Lifetime upgrade quote. The partner's own activation amount is the
   * credit; the Signature price and handling fee are added live, so a price
   * change never leaves a stale fixed upgrade price behind.
   */
  async upgradeQuote(partner, activationOrder) {
    const quote = {
      eligible: false,
      price: null,
      credit: 0,
      handlingFee: UPGRADE_HANDLING_FEE_NGN,
      signaturePrice: null,
      reason: null,
    };
    if (!partner) return { ...quote, reason: 'no_partner' };
    if (partner.accountState !== 'partner') return { ...quote, reason: 'not_activated' };
    if (partner.activationTier !== 'essential') {
      return { ...quote, reason: 'already_signature' };
    }
    if (
      !activationOrder
      || activationOrder.kind === 'upgrade'
      || ['Refunded', 'Cancelled'].includes(activationOrder.status)
    ) {
      return { ...quote, reason: 'no_activation_order' };
    }
    const signature = await StarterProductModel.findOne({
      active: true,
      $or: [{ tier: 'signature' }, { sku: 'MS-STARTER-001' }],
    }).sort({ sortOrder: 1 }).lean();
    if (!signature) return { ...quote, reason: 'unavailable' };
    const credit = Math.max(Number(activationOrder.amount) || 0, 0);
    return {
      eligible: true,
      price: upgradePriceFor({ signaturePrice: signature.price, credit }),
      credit,
      handlingFee: UPGRADE_HANDLING_FEE_NGN,
      signaturePrice: Number(signature.price) || 0,
      reason: null,
    };
  }

  async createUpgrade({ partnerId, shipping, idempotencyKey }) {
    const now = new Date();

    const existingByIdempotency = async (session) => {
      if (!idempotencyKey) return null;
      const order = await ActivationOrderModel.findOne(
        { partnerId, idempotencyKey, kind: 'upgrade' },
        null,
        opts(session),
      ).lean();
      if (!order) return null;
      return {
        order: publicOrder(order),
        partner: partnerSummary(await this.findById(partnerId, { session })),
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
        if (partner.accountState !== 'partner') {
          throw new ConflictException('Activate your account before upgrading');
        }
        if (partner.activationTier !== 'essential') {
          throw new ConflictException('Your account is already on the Signature plan');
        }

        const signature = await StarterProductModel.findOne({
          active: true,
          $or: [{ tier: 'signature' }, { sku: 'MS-STARTER-001' }],
        }).sort({ sortOrder: 1 }).lean();
        if (!signature) throw new NotFoundException('Signature plan is not available');

        const activationOrder = partner.activationOrderId
          ? await ActivationOrderModel.findById(
            partner.activationOrderId,
            null,
            opts(session),
          ).lean()
          : await ActivationOrderModel.findOne(
            { partnerId, kind: 'activation', status: { $in: ['Paid', 'Fulfilled'] } },
            null,
            opts(session),
          ).sort({ createdAt: -1 }).lean();
        if (!activationOrder) {
          throw new ConflictException('No activation order found to upgrade');
        }

        const price = upgradePriceFor({
          signaturePrice: signature.price,
          credit: activationOrder.amount,
        });
        const cogs = Math.max(Number(signature.cogs) || 0, 0);
        const shippingCost = Math.max(Number(signature.shippingCost) || 0, 0);
        const paymentFee = Math.round(price * 0.015 * 100) / 100;
        const grossMargin = Math.max(price - cogs - shippingCost - paymentFee, 0);
        const number = orderNumber();

        const [order] = await ActivationOrderModel.create(
          [{
            orderNumber: number,
            partnerId,
            productId: signature._id,
            productName: signature.name,
            sku: signature.sku,
            tier: 'signature',
            kind: 'upgrade',
            upgradeOfOrderId: activationOrder._id,
            mentorBonusAmount: null,
            amount: price,
            currency: signature.currency ?? 'NGN',
            cogs,
            shippingCost,
            paymentFee,
            grossMargin,
            status: 'Paid',
            shipping,
            paymentMethod: 'Wallet',
            paymentReference: number,
            idempotencyKey: idempotencyKey || undefined,
            mentorContactPreference: partner.mentorContactPreference ?? 'in_app',
            mentorContactConsentAt: partner.mentorContactConsentAt ?? null,
            activatedAt: now,
          }],
          opts(session),
        );

        // Post-activation purchase: bonus may be spent, because the bonus
        // lock only covers the first activation.
        const debit = await debitPartnerWallet(
          { partners: PartnersModel },
          {
            partnerId,
            amountNgn: price,
            filter: { accountState: 'partner', activationTier: 'essential' },
            set: {
              activationTier: 'signature',
              upgradedAt: now,
              upgradeOrderId: order._id,
              address: {
                street: shipping.street,
                city: shipping.city,
                state: shipping.state,
                country: shipping.country ?? 'Nigeria',
              },
            },
          },
          opts(session),
        );
        if (!debit) {
          throw new AppError('Insufficient wallet balance', 409, 'INSUFFICIENT_BALANCE');
        }
        const upgraded = debit.partner;

        await TransactionModel.create(
          [{
            partnerId,
            amount: price,
            bonusAmount: debit.bonusUsed,
            balanceBefore: Number(upgraded.balance ?? 0) + Number(price),
            balanceAfter: upgraded.balance ?? null,
            reference: number,
            status: 'Completed',
            paymentMethod: 'Wallet',
            transactionType: 'Debit',
            date: now,
          }],
          opts(session),
        );

        return {
          order: publicOrder(order.toObject()),
          partner: partnerSummary(upgraded),
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

  async activationSummary({ now = new Date() } = {}) {
    const day = 86400000;
    const cut3 = new Date(now.getTime() - 3 * day);
    const cut7 = new Date(now.getTime() - 7 * day);
    const cut14 = new Date(now.getTime() - 14 * day);
    const [
      members, partners,
      kycPending, kycVerified, kycRejected,
      ordersPaid, ordersFulfilled,
      queueQueued, queueAllocated,
      queue3, queue7, queue14, paid3, paid7,
      activationByTier, upgradeByTier,
    ] = await Promise.all([
      PartnersModel.countDocuments({ accountState: 'member' }),
      PartnersModel.countDocuments({ accountState: { $ne: 'member' } }),
      KycSubmissionModel.countDocuments({ status: 'pending' }),
      KycSubmissionModel.countDocuments({ status: 'verified' }),
      KycSubmissionModel.countDocuments({ status: 'rejected' }),
      ActivationOrderModel.countDocuments({ status: 'Paid' }),
      ActivationOrderModel.countDocuments({ status: 'Fulfilled' }),
      ActivationQueueEntryModel.countDocuments({ status: 'queued' }),
      ActivationQueueEntryModel.countDocuments({ status: 'allocated' }),
      ActivationQueueEntryModel.countDocuments({ status: 'queued', enteredAt: { $lte: cut3 } }),
      ActivationQueueEntryModel.countDocuments({ status: 'queued', enteredAt: { $lte: cut7 } }),
      ActivationQueueEntryModel.countDocuments({ status: 'queued', enteredAt: { $lte: cut14 } }),
      ActivationOrderModel.countDocuments({ status: 'Paid', createdAt: { $lte: cut3 } }),
      ActivationOrderModel.countDocuments({ status: 'Paid', createdAt: { $lte: cut7 } }),
      ActivationOrderModel.aggregate([
        {
          $match: {
            status: { $in: ['Paid', 'Fulfilled'] },
            $or: [{ kind: 'activation' }, { kind: { $exists: false } }],
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$tier', 'signature'] },
            orders: { $sum: 1 },
            revenue: { $sum: '$amount' },
            margin: { $sum: '$grossMargin' },
          },
        },
      ]),
      ActivationOrderModel.aggregate([
        { $match: { kind: 'upgrade', status: { $in: ['Paid', 'Fulfilled'] } } },
        {
          $group: {
            _id: { $ifNull: ['$tier', 'signature'] },
            orders: { $sum: 1 },
            revenue: { $sum: '$amount' },
            margin: { $sum: '$grossMargin' },
          },
        },
      ]),
    ]);
    const memberCount = Number(members) || 0;
    const partnerCount = Number(partners) || 0;
    const planRow = (rows, tier) => {
      const row = (rows ?? []).find((entry) => entry._id === tier);
      return {
        orders: Number(row?.orders) || 0,
        revenue: Math.round((Number(row?.revenue) || 0) * 100) / 100,
        margin: Math.round((Number(row?.margin) || 0) * 100) / 100,
      };
    };
    return {
      generatedAt: now,
      accounts: { total: memberCount + partnerCount, members: memberCount, partners: partnerCount },
      kyc: { pending: Number(kycPending) || 0, verified: Number(kycVerified) || 0, rejected: Number(kycRejected) || 0 },
      orders: { paid: Number(ordersPaid) || 0, fulfilled: Number(ordersFulfilled) || 0 },
      plans: {
        essential: planRow(activationByTier, 'essential'),
        signature: planRow(activationByTier, 'signature'),
        upgrades: planRow(upgradeByTier, 'signature'),
      },
      queue: { queued: Number(queueQueued) || 0, allocated: Number(queueAllocated) || 0 },
      aging: {
        queueOver3Days: Number(queue3) || 0,
        queueOver7Days: Number(queue7) || 0,
        queueOver14Days: Number(queue14) || 0,
        paidOver3Days: Number(paid3) || 0,
        paidOver7Days: Number(paid7) || 0,
      },
      funnel: [
        { stage: 'Accounts', count: memberCount + partnerCount },
        { stage: 'KYC verified', count: Number(kycVerified) || 0 },
        { stage: 'Activated', count: partnerCount },
        { stage: 'Order fulfilled', count: Number(ordersFulfilled) || 0 },
      ],
    };
  }

  async listAdminOrders({ status, tier, kind, page = 1, limit = 25 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const filter = {};
    if (status) filter.status = status;
    if (tier) filter.tier = tier;
    if (kind) filter.kind = kind;
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

      const isUpgrade = order.kind === 'upgrade';

      if (!isUpgrade) {
        const partnerQuery = PartnersModel.findById(order.partnerId).select('upgradeOrderId');
        if (session) partnerQuery.session(session);
        const partnerState = await partnerQuery.lean();
        if (partnerState?.upgradeOrderId) {
          throw new ConflictException(
            'This activation has been upgraded. Refund the upgrade first.',
          );
        }

        const queue = await ActivationQueueEntryModel.findOne(
          { partnerId: order.partnerId },
          null,
          opts(session),
        ).lean();
        if (queue?.status === 'allocated') {
          throw new ConflictException('This partner is already allocated. Resolve the placement before refunding.');
        }
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

      const originalQ = TransactionModel.findOne({
        partnerId: order.partnerId,
        reference: order.orderNumber,
        transactionType: 'Debit',
      }).select('bonusAmount');
      if (session) originalQ.session(session);
      const original = await originalQ.lean();
      const bonusRefund = Math.min(
        Number(order.amount),
        Math.max(0, Number(original?.bonusAmount ?? 0)),
      );
      // An upgrade refund reverts the tier, not the account. An activation
      // refund returns the account to member and clears the tier.
      const partnerUpdate = {
        $inc: { balance: Number(order.amount), bonusBalance: bonusRefund },
        $set: isUpgrade
          ? { activationTier: 'essential', upgradedAt: null, upgradeOrderId: null }
          : { accountState: 'member', activatedAt: null, activationOrderId: null },
      };
      if (!isUpgrade) partnerUpdate.$unset = { activationTier: 1 };

      const settled = await PartnersModel.findOneAndUpdate(
        isUpgrade
          ? { _id: order.partnerId, upgradeOrderId: order._id }
          : { _id: order.partnerId, activationOrderId: order._id },
        partnerUpdate,
        opts(session, { new: true }),
      ).lean();

      if (!settled) {
        await PartnersModel.updateOne(
          { _id: order.partnerId },
          { $inc: { balance: Number(order.amount), bonusBalance: bonusRefund } },
          opts(session),
        );
      }

      let refundedBalance = settled?.balance ?? null;
      if (refundedBalance === null) {
        const refreshed = await PartnersModel.findById(order.partnerId).select('balance').lean();
        refundedBalance = refreshed?.balance ?? null;
      }

      await TransactionModel.create(
        [{
          partnerId: order.partnerId,
          amount: order.amount,
          bonusAmount: bonusRefund,
          balanceBefore: refundedBalance === null ? null : Number(refundedBalance) - Number(order.amount),
          balanceAfter: refundedBalance,
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

      if (!isUpgrade) {
        await ActivationQueueEntryModel.updateOne(
          { partnerId: order.partnerId, status: 'queued' },
          { $set: { status: 'cancelled', cancelledAt: now } },
          opts(session),
        );
      }

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
