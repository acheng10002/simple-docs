const { ZodError } = require("zod");
const { errorResponse, ErrorCodes } = require("../utils/errorResponse");

/**
 * Creates Express middleware that validates request data against Zod schemas
 *
 * @param {Object} schemas - Object containing optional body, query, params schemas
 * @param {import('zod').ZodSchema} [schemas.body] - Schema for req.body
 * @param {import('zod').ZodSchema} [schemas.query] - Schema for req.query
 * @param {import('zod').ZodSchema} [schemas.params] - Schema for req.params
 * @returns {Function} Express middleware
 */
function validate(schemas) {
  return async (req, res, next) => {
    try {
      // Validate each source if schema is provided
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return errorResponse.badRequest(
          res,
          formatZodError(error),
          ErrorCodes.VALIDATION_ERROR,
          { details: formatZodDetails(error) }
        );
      }
      // Unexpected error - pass to error handler
      next(error);
    }
  };
}

/**
 * Formats Zod errors into a human-readable message
 * Returns the first error message (matches current single-error behavior)
 */
function formatZodError(error) {
  const firstIssue = error.issues[0];
  if (!firstIssue) return "Validation failed";

  const path = firstIssue.path.join('.');
  // For root-level or simple errors, just return the message
  if (!path || path === '') {
    return firstIssue.message;
  }
  // For nested paths, include the field name
  return `${firstIssue.message}`;
}

/**
 * Formats Zod errors into detailed structure for error.details
 * Compatible with existing errorResponse format
 */
function formatZodDetails(error) {
  return error.issues.map(issue => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));
}

module.exports = { validate, formatZodError, formatZodDetails };
