import { ValidationException } from '../domain/AppError.js';

/**
 * Zod validation middleware for the Interface layer.
 * Only whitelisted fields reach controllers — unknown keys
 * (e.g. `$where`, `__proto__`) are stripped by Zod, which
 * blocks the main NoSQL-injection vector.
 *
 * Usage: `router.post('/', validate({ body: SubmitTicketSchema }), handler)`
 *
 * @param {{body?:any, params?:any, query?:any}} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    req.validated = req.validated || {};
    if (schemas.body) req.validated.body = schemas.body.parse(req.body);
    if (schemas.params) req.validated.params = schemas.params.parse(req.params);
    if (schemas.query) req.validated.query = schemas.query.parse(req.query);
    next();
  } catch (err) {
    // ZodError -> 400 with field-level details, no stack leak
    next(
      new ValidationException('Invalid request data', {
        issues: err?.issues ?? err?.errors ?? String(err),
      }),
    );
  }
};
