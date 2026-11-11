import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateWithdrawalUseCase } from './Withdrawal.usecases.js';
import { GetSavedPayoutAccountUseCase } from './SavedPayoutAccount.usecases.js';

const account = {
  bankCode: '058',
  bankName: 'Guaranty Trust Bank',
  accountName: 'Ada Obi',
  accountNumber: '0123456789',
  accountLast4: '6789',
  savedAt: '2026-11-11T10:00:00.000Z',
};

const withdrawalDeps = (savedCalls = []) => {
  const created = [];
  const savedAccounts = {
    upsert: async (partnerId, value) => {
      savedCalls.push({ action: 'upsert', partnerId, value });
      return { ...value, accountLast4: value.accountNumber.slice(-4) };
    },
    remove: async (partnerId) => {
      savedCalls.push({ action: 'remove', partnerId });
      return { removed: true };
    },
  };
  return {
    created,
    savedCalls,
    deps: {
      partners: {
        findOneAndUpdate: async () => ({ _id: 'p1', balance: 4000 }),
      },
      transactions: {
        create: async ([doc]) => {
          created.push(doc);
          return [{ ...doc, _id: 't1' }];
        },
      },
      paystack: {
        enabled: true,
        resolveAccount: async () => ({ accountName: 'Ada Obi', accountNumber: '0123456789' }),
        listBanks: async () => [{ name: 'Guaranty Trust Bank', code: '058' }],
      },
      savedAccounts,
      autoPayout: false,
    },
  };
};

describe('saved payout account', () => {
  it('returns the signed-in partner saved account', async () => {
    const uc = new GetSavedPayoutAccountUseCase({
      savedAccounts: { findByPartner: async (partnerId) => ({ ...account, partnerId }) },
    });
    const result = await uc.execute({ partnerId: 'p1' });
    assert.equal(result.saved, true);
    assert.equal(result.account.accountName, 'Ada Obi');
  });

  it('reports no saved account without throwing', async () => {
    const uc = new GetSavedPayoutAccountUseCase({
      savedAccounts: { findByPartner: async () => null },
    });
    const result = await uc.execute({ partnerId: 'p1' });
    assert.deepEqual(result, { saved: false, account: null });
  });

  it('saves the resolved account when saveAccount is true', async () => {
    const fake = withdrawalDeps();
    const uc = new CreateWithdrawalUseCase(fake.deps);
    const result = await uc.execute({
      partnerId: 'p1',
      bankCode: '058',
      bankName: 'Client label',
      accountNumber: '0123456789',
      amountNgn: 1000,
      saveAccount: true,
    });
    assert.equal(result.status, 'Pending');
    assert.equal(fake.savedCalls.length, 1);
    assert.equal(fake.savedCalls[0].action, 'upsert');
    assert.deepEqual(fake.savedCalls[0].value, {
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountName: 'Ada Obi',
      accountNumber: '0123456789',
    });
  });

  it('removes the saved account only when the toggle is switched off', async () => {
    const fake = withdrawalDeps();
    const uc = new CreateWithdrawalUseCase(fake.deps);
    await uc.execute({
      partnerId: 'p1',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountNumber: '0123456789',
      amountNgn: 1000,
      saveAccount: false,
    });
    assert.deepEqual(fake.savedCalls, [{ action: 'remove', partnerId: 'p1' }]);
  });

  it('leaves the saved account unchanged when the flag is omitted', async () => {
    const fake = withdrawalDeps();
    const uc = new CreateWithdrawalUseCase(fake.deps);
    await uc.execute({
      partnerId: 'p1',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountNumber: '0123456789',
      amountNgn: 1000,
    });
    assert.equal(fake.savedCalls.length, 0);
  });

  it('never fails a valid withdrawal when saving the preference fails', async () => {
    const fake = withdrawalDeps();
    fake.deps.savedAccounts.upsert = async () => { throw new Error('database unavailable'); };
    const uc = new CreateWithdrawalUseCase(fake.deps);
    const result = await uc.execute({
      partnerId: 'p1',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountNumber: '0123456789',
      amountNgn: 1000,
      saveAccount: true,
    });
    assert.equal(result.status, 'Pending');
    assert.equal(fake.created.length, 1);
  });

  it('does not change the preference when the wallet debit fails', async () => {
    const fake = withdrawalDeps();
    fake.deps.partners.findOneAndUpdate = async () => null;
    const uc = new CreateWithdrawalUseCase(fake.deps);
    await assert.rejects(
      uc.execute({
        partnerId: 'p1',
        bankCode: '058',
        bankName: 'Guaranty Trust Bank',
        accountNumber: '0123456789',
        amountNgn: 1000,
        saveAccount: true,
      }),
      /balance is too low/,
    );
    assert.equal(fake.savedCalls.length, 0);
  });
});
