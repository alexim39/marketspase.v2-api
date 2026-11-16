import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetAdminSummaryUseCase } from './AdminSummary.usecase.js';

const repo = () => ({
  calls: [],
  async people(window) {
    this.calls.push(['people', window]);
    return { domain: 'people', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
  async finance(window) {
    this.calls.push(['finance', window]);
    return { domain: 'finance', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
});

describe('admin summary use case', () => {
  it('routes the people and finance domains to the repository', async () => {
    const fake = repo();
    const uc = new GetAdminSummaryUseCase({ repo: fake });
    const people = await uc.execute({ domain: 'people', days: 30, now: new Date('2026-11-16T12:00:00Z') });
    const finance = await uc.execute({ domain: 'finance', days: 90, now: new Date('2026-11-16T12:00:00Z') });
    assert.equal(people.domain, 'people');
    assert.equal(finance.domain, 'finance');
    assert.equal(fake.calls[0][1].days, 30);
    assert.equal(fake.calls[1][1].days, 90);
    assert.equal(people.window.days, 30);
  });

  it('rejects an unknown summary domain', async () => {
    const uc = new GetAdminSummaryUseCase({ repo: repo() });
    await assert.rejects(() => uc.execute({ domain: 'nope' }), /Unknown summary domain/);
  });
});
