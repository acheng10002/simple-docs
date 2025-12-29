/* ERROR LOGGING UTILITY
- logs application errors to PostgreSQL ErrorLog table
- replacement for Sentry/GlitchTip error tracking */
const prisma = require("../config/prisma");
const logger = require("../config/logger");

/**
 * Logs an error to the database
 * @param {Object} options - Error logging options
 * @param {string} options.level - Log level: 'error', 'warn', or 'info'
 * @param {string} options.message - Error message
 * @param {Error} [options.error] - Error object (will extract stack trace)
 * @param {Object} [options.context] - Additional context (user, request, etc.)
 * @returns {Promise<void>}
 */
async function logError({ level = "error", message, error, context = {} }) {
  try {
    // extracts stack trace from Error object if provided
    const stack = error?.stack || null;

    // builds context object with useful debugging info
    const enrichedContext = {
      ...context,
      // adds error details if available
      errorName: error?.name,
      errorCode: error?.code,
      // adds timestamp for reference
      loggedAt: new Date().toISOString(),
    };

    // writes to database
    await prisma.errorLog.create({
      data: {
        level,
        message,
        stack,
        context: enrichedContext,
      },
    });

    // also logs to console/file via Pino for immediate visibility
    logger[level]({ error, context: enrichedContext }, message);
  } catch (dbError) {
    // if database logging fails, fall back to console/file logging only
    logger.error(
      { originalError: error, dbError, context },
      `Failed to log error to database: ${message}`
    );
  }
}

/**
 * Logs an error-level message
 * @param {string} message - Error message
 * @param {Error} [error] - Error object
 * @param {Object} [context] - Additional context
 */
async function error(message, error = null, context = {}) {
  return logError({ level: "error", message, error, context });
}

/**
 * Logs a warning-level message
 * @param {string} message - Warning message
 * @param {Error} [error] - Error object
 * @param {Object} [context] - Additional context
 */
async function warn(message, error = null, context = {}) {
  return logError({ level: "warn", message, error, context });
}

/**
 * Logs an info-level message
 * @param {string} message - Info message
 * @param {Error} [error] - Error object
 * @param {Object} [context] - Additional context
 */
async function info(message, error = null, context = {}) {
  return logError({ level: "info", message, error, context });
}

/**
 * Express error handler middleware that logs errors to database
 * Use this as your error handler in Express
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
async function expressErrorHandler(err, req, res, next) {
  // extracts useful request context
  const context = {
    requestId: req.id,
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    userEmail: req.user?.email,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };

  // logs to database
  await error(err.message || "Unhandled error", err, context);

  // sends response to client
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    // provides request ID for support/debugging
    requestId: req.id,
  });
}

module.exports = {
  logError,
  error,
  warn,
  info,
  expressErrorHandler,
};
