import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '../../../shared/domain/AppError.js';
import { RecordTutorialViewUseCase } from './Tutorial.usecases.js';

const tutorialId = '507f1f77bcf86cd799439011';
const partnerId = '507f1f77bcf86cd799439012';

const chain = (value) => ({
  select: () => chain(value),
  lean: async () => value,
});

const tutorials = ({ tutorial = { _id: tutorialId, viewCount: 4 }, current = tutorial, updated = null } = {}) => {
  const calls = { findOne: 0, findById: 0, findByIdAndUpdate: 0 };
  return {
    calls,
    findOne: () => { calls.findOne += 1; return chain(tutorial); },
    findById: () => { calls.findById += 1; return chain(current); },
    findByIdAndUpdate: () => { calls.findByIdAndUpdate += 1; return chain(updated); },
  };
};

describe('RecordTutorialViewUseCase', () => {
  it('counts a first view and increments the tutorial total', async () => {
    const repo = tutorials({ updated: { viewCount: 5 } });
    const views = { updateOne: async () => ({ upsertedCount: 1 }) };
    const useCase = new RecordTutorialViewUseCase({ tutorials: repo, views });

    const result = await useCase.execute({ tutorialId, partnerId });

    assert.deepEqual(result, { viewCount: 5, counted: true });
    assert.equal(repo.calls.findByIdAndUpdate, 1);
  });

  it('does not increment when the same partner views again', async () => {
    const repo = tutorials({ current: { viewCount: 7 } });
    const views = { updateOne: async () => ({ upsertedCount: 0 }) };
    const useCase = new RecordTutorialViewUseCase({ tutorials: repo, views });

    const result = await useCase.execute({ tutorialId, partnerId });

    assert.deepEqual(result, { viewCount: 7, counted: false });
    assert.equal(repo.calls.findByIdAndUpdate, 0);
  });

  it('treats a concurrent first-view race as already counted', async () => {
    const repo = tutorials({ current: { viewCount: 9 } });
    const views = { updateOne: async () => { const err = new Error('duplicate'); err.code = 11000; throw err; } };
    const useCase = new RecordTutorialViewUseCase({ tutorials: repo, views });

    const result = await useCase.execute({ tutorialId, partnerId });

    assert.deepEqual(result, { viewCount: 9, counted: false });
    assert.equal(repo.calls.findByIdAndUpdate, 0);
  });

  it('rejects a view for a tutorial that is missing or inactive', async () => {
    const repo = tutorials({ tutorial: null });
    const views = { updateOne: async () => { throw new Error('should not be called'); } };
    const useCase = new RecordTutorialViewUseCase({ tutorials: repo, views });

    await assert.rejects(
      () => useCase.execute({ tutorialId, partnerId }),
      (err) => err instanceof NotFoundException,
    );
  });
});
