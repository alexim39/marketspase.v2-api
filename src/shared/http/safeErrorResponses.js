import { defaultCodeForStatus, defaultFixForStatus, isServerError } from '../domain/errorCodes.js';

/**
 * Backstop for legacy controllers that still write their own responses.
 *
 * It never changes a 2xx response. On failures it removes `error`/`stack`
 * leakage, adds the shared `code`/`fix`/`requestId` fields, and replaces
 * every 5xx message with a generic one. New code should throw AppError and
 * let errorMiddleware handle it; this keeps the old routes safe in the
 * meantime.
 */
export const safeErrorResponses = (req, res, next) => {
  if (String(req.path ?? '').startsWith('/health')) return next();
  const sendJson = res.json.bind(res);

  const shape = (body) => {
    const status = res.statusCode;
    const server = isServerError(status);
    const payload = body && typeof body === 'object' && !Array.isArray(body)
      ? { ...body }
      : { message: typeof body === 'string' ? body : 'Request failed' };

    payload.success = false;
    payload.code = typeof payload.code === 'string' && payload.code
      ? payload.code
      : defaultCodeForStatus(status);
    payload.fix = typeof payload.fix === 'string' && payload.fix
      ? payload.fix
      : defaultFixForStatus(status);
    payload.requestId = req.id;
    if (server) payload.message = 'Internal server error';
    delete payload.error;
    delete payload.stack;
    return payload;
  };

  res.json = (body) => {
    if (res.statusCode < 400) {
      if (body && typeof body === 'object' && !Array.isArray(body)
        && Array.isArray(body.data) && body.meta === undefined) {
        return sendJson({
          ...body,
          meta: {
            count: body.data.length,
            reason: body.data.length === 0 ? 'no_items' : 'ok',
            next_action: null,
          },
        });
      }
      return sendJson(body);
    }
    return sendJson(shape(body));
  };

  next();
};

export default safeErrorResponses;
