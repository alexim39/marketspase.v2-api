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
  async commerce(window) {
    this.calls.push(['commerce', window]);
    return { domain: 'commerce', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
  async growth(window) {
    this.calls.push(['growth', window]);
    return { domain: 'growth', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
  async support(window) {
    this.calls.push(['support', window]);
    return { domain: 'support', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
  async content(window) {
    this.calls.push(['content', window]);
    return { domain: 'content', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
  async communications(window) {
    this.calls.push(['communications', window]);
    return { domain: 'communications', window: { days: window.days }, kpis: [], trends: [], distributions: [], alerts: [] };
  },
});

describe('admin summary use case', () => {
  it('routes every supported domain to the repository', async () => {
    const fake = repo();
    const uc = new GetAdminSummaryUseCase({ repo: fake });
    const domains = ['people', 'finance', 'commerce', 'growth', 'support', 'content', 'communications'];
    for (const domain of domains) {
      const result = await uc.execute({ domain, days: 30, now: new Date('2026-11-16T12:00:00Z') });
      assert.equal(result.domain, domain);
      assert.equal(result.window.days, 30);
    }
    assert.equal(fake.calls.length, domains.length);
  });
  it('rejects an unknown summary domain', async () => {
    const uc = new GetAdminSummaryUseCase({ repo: repo() });
    await assert.rejects(() => uc.execute({ domain: 'nope' }), /Unknown summary domain/);
  });
});
