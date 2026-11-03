import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';
import { buildProlificWomanLeadRouter } from './Lead.routes.js';

const payload = {
  name: 'Amaka Okafor',
  phone: '08031234567',
  location: 'Ikeja, Lagos',
  readyToBeMentored: 'yes',
  headOfficeInvite: 'yes',
  availability: 'weekdays',
  submittedAt: '2026-10-29T08:00:00.000Z',
};

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('POST /leads returns the frontend-compatible success envelope', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    buildProlificWomanLeadRouter({
      submit: {
        async execute(input) {
          return {
            ...input,
            id: 'lead-1',
            createdAt: new Date('2026-10-29T08:01:00.000Z'),
          };
        },
      },
    }),
  );

  const server = await listen(app);
  t.after(() => close(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.message, 'Application received');
  assert.equal(body.success, true);
  assert.equal(body.data.id, 'lead-1');
});

test('POST /leads rejects invalid form values before persistence', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    buildProlificWomanLeadRouter({
      submit: {
        async execute() {
          throw new Error('should not be called');
        },
      },
    }),
  );
  app.use(errorMiddleware);

  const server = await listen(app);
  t.after(() => close(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, readyToBeMentored: 'maybe' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.equal(body.success, false);
});
