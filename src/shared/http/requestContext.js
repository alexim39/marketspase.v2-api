import { randomUUID } from 'node:crypto';
import { logger } from '../observability/logger.js';

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Attach a stable request ID to every request and emit one structured
 * completion line. The ID is echoed in `X-Request-Id`, error envelopes and
 * money-audit details, so an operator can join a user report to the logs.
 */
export const requestContext = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = typeof incoming === 'string' && REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const path = req.originalUrl?.split('?')[0] ?? req.path;
    const fields = {
      requestId: req.id,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      partnerId: req.auth?.partnerId ?? null,
      ip: req.ip ?? null,
    };
    if (res.statusCode >= 500) {
      logger.error('http_request', fields);
    } else if (!path.startsWith('/health')) {
      logger.info('http_request', fields);
    }
  });

  next();
};

export default requestContext;
