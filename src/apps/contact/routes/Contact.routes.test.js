import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildContactRouter } from './Contact.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

let seen = null;
const app = express();
app.use(express.json());
app.use('/v1/contact', buildContactRouter({
  submit: (req, res) => {
    seen = req.body;
    return res.status(200).json({ data: req.body, success: true });
  },
  preapproach: (req, res) => {
    seen = req.body;
    return res.status(200).json({ data: req.body, success: true });
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

describe('v1 contact routes', () => {
  it('accepts a valid contact form and strips unknown fields', async () => {
    const result = await request('/v1/contact/submit', {
      name: 'Ada',
      surname: 'Obi',
      email: 'Ada@Example.com',
      subject: 'Hello',
      message: 'I would like to know more.',
      $where: 'x',
      deletedAt: '2026-01-01',
    });

    assert.equal(result.status, 200);
    assert.equal(seen.email, 'ada@example.com');
    assert.equal(seen.$where, undefined);
    assert.equal(seen.deletedAt, undefined);
  });

  it('rejects an invalid email with a safe 400', async () => {
    const result = await request('/v1/contact/submit', {
      name: 'Ada',
      surname: 'Obi',
      email: 'not-an-email',
      subject: 'Hello',
      message: 'Body',
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
  });

  it('requires a username on the pre-approach form', async () => {
    const result = await request('/v1/contact/pre-approach', {
      name: 'Ada',
      surname: 'Obi',
      email: 'ada@example.com',
      phone: '08030000000',
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
  });

  it('accepts a valid pre-approach form', async () => {
    const result = await request('/v1/contact/pre-approach', {
      name: 'Ada',
      surname: 'Obi',
      email: 'ada@example.com',
      phone: '08030000000',
      username: 'ada',
    });

    assert.equal(result.status, 200);
    assert.equal(seen.username, 'ada');
  });
});
