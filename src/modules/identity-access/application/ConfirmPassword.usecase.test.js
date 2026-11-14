import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmPasswordUseCase } from './ConfirmPassword.usecase.js';

const make = (hash = 'hash:secret') => new ConfirmPasswordUseCase({
  partners: { findPasswordHash: async () => hash },
  hasher: { compare: async (plain, stored) => stored === `hash:${plain}` },
});

describe('ConfirmPasswordUseCase', () => {
  it('confirms the signed-in partner password', async () => {
    const result = await make().execute({ partnerId: 'p1', password: 'secret' });
    assert.deepEqual(result, { confirmed: true });
  });

  it('rejects a wrong password with a non-401 step-up error', async () => {
    await assert.rejects(
      () => make().execute({ partnerId: 'p1', password: 'wrong' }),
      (error) => {
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, 'INVALID_PASSWORD');
        assert.match(error.message, /not started/i);
        return true;
      },
    );
  });

  it('requires a password value', async () => {
    await assert.rejects(
      () => make().execute({ partnerId: 'p1', password: '   ' }),
      /Enter your account password/,
    );
  });

  it('fails closed when the account has no password hash', async () => {
    await assert.rejects(
      () => make(null).execute({ partnerId: 'p1', password: 'secret' }),
      /unavailable/i,
    );
  });
});
