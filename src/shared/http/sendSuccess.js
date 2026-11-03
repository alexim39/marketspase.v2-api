/**
 * Uniform success envelope for NEW routes.
 * Legacy routes return `{ message, ticket, success }` shapes;
 * new slices return this shape and keep a `ticket` alias
 * where needed for backward compatibility.
 */
export const sendSuccess = (res, { message = 'OK', data = null, statusCode = 200, meta } = {}) => {
  const body = { message, success: true, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
};
