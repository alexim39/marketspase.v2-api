import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateActivationOrderUseCase,
  ListStarterProductsUseCase,
  RefundActivationOrderUseCase,
} from './Onboarding.usecases.js';
import { partnerSummary, publicQueue } from '../infrastructure/Onboarding.mongo.repository.js';
import {
  CreateActivationOrderSchema,
  SubmitKycSchema,
} from '../interface/Onboarding.validator.js';

const order = {
  id: 'order-1',
  orderNumber: 'MSA-TEST-1',
  amount: 38000,
  currency: 'NGN',
  activatedAt: new Date('2026-11-03T10:00:00Z'),
};

describe('activation order use case', () => {
  it('emits partner.activated once for a new order', async () => {
    const emitted = [];
    const useCase = new CreateActivationOrderUseCase({
      repo: {
        createOrder: async () => ({ order, queue: null, repeated: false, grossMargin: 18430 }),
      },
      events: { emit: async (name, payload) => emitted.push({ name, payload }) },
    });

    const result = await useCase.execute({
      partnerId: 'partner-1',
      productId: 'product-1',
      shipping: { fullName: 'Ada Obi' },
      idempotencyKey: 'idem-key-123',
    });

    assert.equal(result.order.id, 'order-1');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, 'partner.activated');
    assert.equal(emitted[0].payload.partnerId, 'partner-1');
    assert.equal(emitted[0].payload.amount, 38000);
    assert.equal(emitted[0].payload.grossMargin, 18430);
    assert.equal('grossMargin' in result, false);
  });

  it('does not emit again when the idempotency replay returns the same order', async () => {
    const emitted = [];
    const useCase = new CreateActivationOrderUseCase({
      repo: {
        createOrder: async () => ({ order, queue: null, repeated: true }),
      },
      events: { emit: async (name, payload) => emitted.push({ name, payload }) },
    });

    const result = await useCase.execute({
      partnerId: 'partner-1',
      productId: 'product-1',
      shipping: {},
      idempotencyKey: 'idem-key-123',
    });

    assert.equal(result.repeated, true);
    assert.equal(emitted.length, 0);
  });

  it('never lets an event-subscriber failure roll back a paid activation', async () => {
    const useCase = new CreateActivationOrderUseCase({
      repo: {
        createOrder: async () => ({ order, queue: null, repeated: false }),
      },
      events: { emit: async () => { throw new Error('subscriber down'); } },
    });

    const result = await useCase.execute({
      partnerId: 'partner-1',
      productId: 'product-1',
      shipping: {},
    });

    assert.equal(result.order.orderNumber, 'MSA-TEST-1');
  });

  it('snapshots the activation contact preference onto the event', async () => {
    const emitted = [];
    const received = [];
    const useCase = new CreateActivationOrderUseCase({
      repo: {
        createOrder: async (input) => {
          received.push(input);
          return {
            order: {
              ...order,
              mentorContactPreference: 'email',
              mentorContactConsentAt: new Date('2026-11-03T10:00:00Z'),
            },
            queue: null,
            repeated: false,
          };
        },
      },
      events: { emit: async (name, payload) => emitted.push({ name, payload }) },
    });

    await useCase.execute({
      partnerId: 'partner-1',
      productId: 'product-1',
      shipping: {},
      mentorContactPreference: 'email',
      mentorContactConsent: true,
    });

    assert.equal(received[0].mentorContactPreference, 'email');
    assert.equal(received[0].mentorContactConsent, true);
    assert.equal(emitted[0].payload.mentorContactPreference, 'email');
    assert.ok(emitted[0].payload.mentorContactConsentAt instanceof Date);
  });

  it('defaults the activation preference to in-app chat', async () => {
    const received = [];
    const useCase = new CreateActivationOrderUseCase({
      repo: {
        createOrder: async (input) => {
          received.push(input);
          return { order, queue: null, repeated: true };
        },
      },
      events: { emit: async () => null },
    });

    await useCase.execute({
      partnerId: 'partner-1',
      productId: 'product-1',
      shipping: {},
    });

    assert.equal(received[0].mentorContactPreference, 'in_app');
    assert.equal(received[0].mentorContactConsent, false);
  });
});

describe('activation refund use case', () => {
  it('emits the refund with the partner and order identity', async () => {
    const emitted = [];
    const useCase = new RefundActivationOrderUseCase({
      repo: {
        refundOrder: async () => ({
          order: { ...order, status: 'Refunded' },
          partner: { id: 'partner-1' },
          repeated: false,
        }),
      },
      events: { emit: async (name, payload) => emitted.push({ name, payload }) },
    });

    await useCase.execute('order-1', 'admin-1', 'Faulty item');

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, 'partner.activation_refunded');
    assert.equal(emitted[0].payload.partnerId, 'partner-1');
    assert.equal(emitted[0].payload.reason, 'Faulty item');
  });
});

describe('starter product payload', () => {
  it('exposes sellable fields but never internal cost', async () => {
    const useCase = new ListStarterProductsUseCase({
      repo: {
        listProducts: async () => [{
          _id: 'product-1',
          sku: 'MS-STARTER-001',
          name: 'Signature Set',
          description: 'Clothing set',
          price: 38000,
          currency: 'NGN',
          shippingCost: 3000,
          cogs: 16000,
          imageUrl: '',
        }],
      },
    });

    const result = await useCase.execute();

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'product-1');
    assert.equal(result[0].price, 38000);
    assert.equal('cogs' in result[0], false);
  });
});

describe('onboarding read models', () => {
  it('treats legacy partners as activated and explicit members as unactivated', () => {
    const legacy = partnerSummary({ _id: 'a', name: 'Ada', accountState: undefined, emailVerified: undefined });
    const member = partnerSummary({ _id: 'b', name: 'Bola', accountState: 'member', kycStatus: 'pending' });

    assert.equal(legacy.accountState, 'partner');
    assert.equal(legacy.kycStatus, 'verified');
    assert.equal(legacy.emailVerified, true);
    assert.equal(member.accountState, 'member');
    assert.equal(member.kycStatus, 'pending');
  });

  it('only exposes a queue position while actually queued', () => {
    assert.equal(publicQueue({ status: 'queued', enteredAt: new Date() }, 2).position, 2);
    assert.equal(publicQueue({ status: 'allocated', enteredAt: new Date() }, 2).position, null);
  });

  it('passes the saved profile address through for shipping prefill', () => {
    const partner = partnerSummary({
      _id: 'c',
      address: { street: '12 Market Road', city: 'Lagos', state: 'Lagos', country: 'Nigeria' },
    });
    assert.deepEqual(partner.address, {
      street: '12 Market Road', city: 'Lagos', state: 'Lagos', country: 'Nigeria',
    });
  });
});

describe('onboarding input validation', () => {
  it('accepts an empty KYC submission for automatic completion', () => {
    const result = SubmitKycSchema.parse({ admin: true });
    assert.deepEqual(result, {});
  });

  it('still validates optional identity fields when they are supplied', () => {
    assert.throws(() => SubmitKycSchema.parse({
      dateOfBirth: '12/04/1998',
      idNumber: '123',
    }));
    const parsed = SubmitKycSchema.parse({
      dateOfBirth: '1998-04-12',
      idType: 'nin',
      idNumber: '12345678901',
    });
    assert.equal(parsed.idType, 'nin');
  });

  it('validates the activation contact preference and consent', () => {
    const shipping = {
      fullName: 'Ada Obi',
      phone: '+2348012345678',
      street: '12 Market Road',
      city: 'Lagos',
      state: 'Lagos',
    };
    const base = { productId: '507f1f77bcf86cd799439011', shipping };

    const parsed = CreateActivationOrderSchema.parse({
      ...base,
      mentorContactPreference: 'whatsapp',
      mentorContactConsent: true,
    });
    assert.equal(parsed.mentorContactPreference, 'whatsapp');
    assert.equal(parsed.mentorContactConsent, true);

    assert.equal(CreateActivationOrderSchema.parse(base).mentorContactPreference, 'in_app');
    assert.equal(CreateActivationOrderSchema.parse(base).mentorContactConsent, false);
    assert.throws(() => CreateActivationOrderSchema.parse({
      ...base,
      mentorContactPreference: 'carrier-pigeon',
    }));
  });

  it('accepts a real product id and rejects a loose reference', () => {
    const shipping = {
      fullName: 'Ada Obi',
      phone: '+2348012345678',
      street: '12 Market Road',
      city: 'Lagos',
      state: 'Lagos',
    };

    assert.equal(CreateActivationOrderSchema.parse({
      productId: '507f1f77bcf86cd799439011',
      shipping,
    }).shipping.country, 'Nigeria');

    assert.throws(() => CreateActivationOrderSchema.parse({
      productId: 'starter',
      shipping,
    }));
  });
});
