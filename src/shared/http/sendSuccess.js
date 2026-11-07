/**
 * Uniform success envelope for NEW routes.
 * Legacy routes return `{ message, ticket, success }` shapes;
 * new slices return this shape and keep a `ticket` alias
 * where needed for backward compatibility.
 */
export const sendSuccess = (res, { message = 'OK', data = null, statusCode = 200, meta } = {}) => {
  const body = { message, success: true, data };
  if (meta !== undefined) {
    body.meta = meta;
  } else if (Array.isArray(data)) {
    // Never return a bare []: give the client a stable shape it can explain.
    body.meta = {
      count: data.length,
      reason: data.length === 0 ? 'no_items' : 'ok',
      next_action: null,
    };
  }
  return res.status(statusCode).json(body);
};
