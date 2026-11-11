import { AppError } from '../domain/AppError.js';
import { defaultFixForStatus } from '../domain/errorCodes.js';
import { logger, serializeError } from '../observability/logger.js';

const envelope = (req, { message, code, fix, details, retryAfter, statusCode = 400 }) => ({
  message,
  success: false,
  code,
  fix: fix ?? defaultFixForStatus(statusCode),
  requestId: req?.id ?? null,
  ...(details !== undefined ? { details } : {}),
  ...(retryAfter !== undefined ? { retry_after: retryAfter } : {}),
});

/**
 * Global error middleware — MUST be registered after all routes.
 * Maps domain exceptions to HTTP codes, hides internals on 500.
 */
// eslint-disable-next-line no-unused-vars
export const errorMiddleware = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('request_failed', {
        requestId: req?.id,
        method: req?.method,
        path: req?.originalUrl?.split('?')[0] ?? req?.path,
        status: err.statusCode,
        code: err.code,
        error: serializeError(err),
      });
    }
    return res.status(err.statusCode).json(envelope(req, {
      message: err.message,
      code: err.code,
      fix: err.fix,
      details: err.details,
      retryAfter: err.retryAfter,
      statusCode: err.statusCode,
    }));
  }

  // Provider/infra clients (DeepSeek, Cloudinary) throw plain Errors with
  // an intentional statusCode + code (they must stay framework-free).
  // Honor them so the UI gets "Ora is not configured yet" (503) instead
  // of a generic 500. Uncoded 5xx stay generic — never leak internals.
  if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600) {
    const safe = err.statusCode < 500 || typeof err.code === 'string';
    if (err.statusCode >= 500) {
      logger.error('request_failed', {
        requestId: req?.id,
        method: req?.method,
        path: req?.originalUrl?.split('?')[0] ?? req?.path,
        status: err.statusCode,
        code: typeof err.code === 'string' ? err.code : 'PROVIDER_ERROR',
        error: serializeError(err),
      });
    }
    return res.status(err.statusCode).json(envelope(req, {
      message: safe ? (err.message || 'Request failed') : 'Internal server error',
      code: typeof err.code === 'string' ? err.code : 'PROVIDER_ERROR',
      fix: err.fix,
      retryAfter: err.retryAfter,
      statusCode: err.statusCode,
    }));
  }

  // Multer upload errors (size caps, field limits) — client errors, not 500s.
  if (err?.name === 'MulterError') {
    return res.status(400).json(envelope(req, {
      message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large for this upload' : 'Invalid upload',
      code: 'VALIDATION_ERROR',
      fix: 'Choose a smaller supported file and try again.',
      statusCode: 400,
    }));
  }

  // Mongoose validation / cast errors from any not-yet-migrated path
  if (err?.name === 'ValidationError') {
    return res.status(400).json(envelope(req, {
      message: 'Invalid request data',
      code: 'VALIDATION_ERROR',
      details: err.message,
      fix: 'Correct the highlighted fields and try again.',
      statusCode: 400,
    }));
  }
  if (err?.name === 'CastError') {
    return res.status(400).json(envelope(req, {
      message: `Invalid ${err.path}: ${err.value}`,
      code: 'VALIDATION_ERROR',
      fix: 'Check the value format and try again.',
      statusCode: 400,
    }));
  }
  if (err?.code === 11000) {
    return res.status(409).json(envelope(req, {
      message: 'Duplicate value',
      code: 'CONFLICT',
      fix: 'Refresh the page and use a unique value.',
      statusCode: 409,
    }));
  }

  if (err?.code === 50 || /maxTimeMS|operation timed out|buffering timed out/i.test(String(err?.message ?? ''))) {
    return res.status(503).json({
      ...envelope(req, {
        message: 'This request took too long to complete.',
        code: 'SLOW_QUERY',
        fix: 'Retry once. If it keeps timing out, narrow the filter or try again shortly.',
        statusCode: 503,
      }),
      status: 'slow',
      partial_cached_data: null,
    });
  }

  logger.error('request_failed', {
    requestId: req?.id,
    method: req?.method,
    path: req?.originalUrl?.split('?')[0] ?? req?.path,
    status: 500,
    code: 'INTERNAL_ERROR',
    error: serializeError(err),
  });
  return res.status(500).json(envelope(req, {
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
    fix: defaultFixForStatus(500),
    statusCode: 500,
  }));
};
