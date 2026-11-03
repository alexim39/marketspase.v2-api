/**
 * Shared domain errors.
 * Domain + Application layers throw these.
 * `errorMiddleware` maps them to HTTP status codes.
 * No Express / Mongoose imports allowed here.
 */

export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} code machine-readable code, e.g. 'NOT_FOUND'
   * @param {unknown} [details]
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationException extends AppError {
  constructor(message = 'Invalid request data', details) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundException extends AppError {
  constructor(message = 'Resource not found', details) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ConflictException extends AppError {
  constructor(message = 'Resource conflict', details) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class UnauthorizedException extends AppError {
  constructor(message = 'Unauthenticated', details) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenException extends AppError {
  constructor(message = 'Forbidden', details) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class ServiceUnavailableException extends AppError {
  constructor(message = 'Service temporarily unavailable', details) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details);
  }
}
