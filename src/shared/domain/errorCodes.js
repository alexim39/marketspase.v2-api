/**
 * Shared error vocabulary.
 *
 * One place decides the machine code and the human next step for an HTTP
 * status. Domain and HTTP layers both import this so a `code` or `fix`
 * never drifts between the API, the web client and the logs.
 */

export const FIX_BY_STATUS = Object.freeze({
  400: 'Check the highlighted fields and try again.',
  401: 'Sign in again, then retry the action.',
  403: 'Use an account with the required role, or ask a MarketSpase admin.',
  404: 'Check the link or reference, then try again.',
  409: 'Refresh the page and retry once the current state is visible.',
  410: 'This feature has moved or is no longer available.',
  413: 'Reduce the file or request size and try again.',
  415: 'Use a supported file type and try again.',
  422: 'Correct the highlighted values and try again.',
  429: 'Wait for the retry_after period, then retry once.',
  500: 'Try again. If it keeps failing, contact support with the request ID.',
  502: 'The provider did not confirm the result. Wait a moment and retry once.',
  503: 'The service is temporarily unavailable. Retry after the stated delay.',
  504: 'The request took too long. Retry once; if it repeats, contact support.',
});

export const CODE_BY_STATUS = Object.freeze({
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'PROVIDER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
});

export const defaultFixForStatus = (statusCode) =>
  FIX_BY_STATUS[Number(statusCode)] ?? FIX_BY_STATUS[400];

export const defaultCodeForStatus = (statusCode) =>
  CODE_BY_STATUS[Number(statusCode)] ?? 'REQUEST_FAILED';

export const isServerError = (statusCode) => Number(statusCode) >= 500;
