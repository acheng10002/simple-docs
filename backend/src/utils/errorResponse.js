/* ERROR RESPONSE UTILITY
Standardized error response format for consistent API error handling.

Response format:
{
  error: {
    code: "ERROR_CODE",       // machine-readable error code
    message: "...",           // human-readable message
    details: { ... },         // optional additional context
    retryAfter: 5             // optional, seconds to wait before retry
  }
}
*/

// Error codes grouped by category
const ErrorCodes = {
  // Authentication (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  AUTH_FAILED: 'AUTH_FAILED',

  // Authorization (403)
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  // Validation (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_FORMAT: 'INVALID_FORMAT',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',

  // Not Found (404)
  NOT_FOUND: 'NOT_FOUND',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',

  // Conflict (409)
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',

  // Payload (413)
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // Unsupported (415)
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // Unprocessable (422)
  TEMPLATE_PARSE_ERROR: 'TEMPLATE_PARSE_ERROR',
  FIELD_MISMATCH: 'FIELD_MISMATCH',
  EMPTY_DATA: 'EMPTY_DATA',

  // Rate Limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // Server Errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
};

/**
 * Build a standardized error response object
 * @param {string} code - Error code from ErrorCodes
 * @param {string} message - Human-readable error message
 * @param {Object} options - Optional additional fields
 * @param {any} options.details - Additional error context
 * @param {number} options.retryAfter - Seconds to wait before retry
 * @returns {Object} Error response object
 */
function buildError(code, message, options = {}) {
  const error = { code, message };

  if (options.details !== undefined) {
    error.details = options.details;
  }

  if (options.retryAfter !== undefined) {
    error.retryAfter = options.retryAfter;
  }

  return { error };
}

/**
 * Send a standardized error response
 * @param {Response} res - Express response object
 * @param {number} status - HTTP status code
 * @param {string} code - Error code from ErrorCodes
 * @param {string} message - Human-readable error message
 * @param {Object} options - Optional additional fields
 */
function sendError(res, status, code, message, options = {}) {
  return res.status(status).json(buildError(code, message, options));
}

// Convenience methods for common error responses
const errorResponse = {
  // 400 Bad Request
  badRequest: (res, message, code = ErrorCodes.VALIDATION_ERROR, options = {}) =>
    sendError(res, 400, code, message, options),

  // 401 Unauthorized
  unauthorized: (res, message = 'Unauthorized', code = ErrorCodes.UNAUTHORIZED) =>
    sendError(res, 401, code, message),

  // 403 Forbidden
  forbidden: (res, message = 'Forbidden', code = ErrorCodes.FORBIDDEN) =>
    sendError(res, 403, code, message),

  // 404 Not Found
  notFound: (res, message = 'Not found', code = ErrorCodes.NOT_FOUND) =>
    sendError(res, 404, code, message),

  // 409 Conflict
  conflict: (res, message, code = ErrorCodes.CONFLICT) =>
    sendError(res, 409, code, message),

  // 413 Payload Too Large
  payloadTooLarge: (res, message, options = {}) =>
    sendError(res, 413, ErrorCodes.PAYLOAD_TOO_LARGE, message, options),

  // 415 Unsupported Media Type
  unsupportedMediaType: (res, message) =>
    sendError(res, 415, ErrorCodes.UNSUPPORTED_MEDIA_TYPE, message),

  // 422 Unprocessable Entity
  unprocessable: (res, message, code = ErrorCodes.TEMPLATE_PARSE_ERROR, options = {}) =>
    sendError(res, 422, code, message, options),

  // 429 Too Many Requests
  rateLimited: (res, message = 'Too many requests', retryAfter = 60) =>
    sendError(res, 429, ErrorCodes.RATE_LIMITED, message, { retryAfter }),

  // 500 Internal Server Error
  internal: (res, message = 'Internal server error') =>
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, message),

  // 503 Service Unavailable
  serviceUnavailable: (res, message, options = {}) =>
    sendError(res, 503, ErrorCodes.SERVICE_UNAVAILABLE, message, options),

  // 504 Gateway Timeout
  timeout: (res, message = 'Request timeout') =>
    sendError(res, 504, ErrorCodes.TIMEOUT, message),
};

module.exports = {
  ErrorCodes,
  buildError,
  sendError,
  errorResponse,
};
