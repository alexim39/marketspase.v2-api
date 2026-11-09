import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildSurveyRouter } from './Survey.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

let seen = null;
const app = express();
app.use(express.json());
app.use('/v1/survey', buildSurveyRouter({
  prospect: (req, res) => {
    seen = req.body;
    return res.status(200).json({ success: true });
  },
  partner: (req, res) => {
    seen = req.body;
    return res.status(200).json({ success: true });
  },
}));
app.use(errorMiddleware);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const request = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const prospect = (over = {}) => ({
  ageRange: '25-34',
  socialMedia: ['Instagram', 'Facebook'],
  employedStatus: 'Employed',
  importanceOfPassiveIncome: 'High',
  onlinePurchaseSchedule: 'Weekly',
  primaryOnlineBusinessMotivation: 'Extra income',
  comfortWithTech: 'High',
  onlineBusinessTimeDedication: '5-10 hours',
  phoneNumber: '08030000000',
  email: 'ada@example.com',
  name: 'Ada',
  surname: 'Obi',
  username: 'ada',
  state: 'Rivers',
  ...over,
});

describe('v1 survey routes', () => {
  it('accepts a valid prospect survey', async () => {
    const result = await request('/v1/survey/submit', prospect());

    assert.equal(result.status, 200);
    assert.equal(seen.username, 'ada');
    assert.deepEqual(seen.socialMedia, ['Instagram', 'Facebook']);
  });

  it('normalizes a comma-separated socialMedia value', async () => {
    const result = await request('/v1/survey/submit', prospect({ socialMedia: 'Instagram, Facebook' }));

    assert.equal(result.status, 200);
    assert.deepEqual(seen.socialMedia, ['Instagram', 'Facebook']);
  });

  it('strips unknown and server-owned fields', async () => {
    const result = await request('/v1/survey/submit', prospect({
      stateNorm: 'tampered',
      prospectStatus: 'Moved',
      $where: 'x',
    }));

    assert.equal(result.status, 200);
    assert.equal(seen.stateNorm, undefined);
    assert.equal(seen.prospectStatus, undefined);
    assert.equal(seen.$where, undefined);
  });

  it('rejects incomplete prospect surveys', async () => {
    const result = await request('/v1/survey/submit', { name: 'Ada' });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
  });
});
