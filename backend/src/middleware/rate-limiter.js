const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { PostgresStore } = require("@acpr/rate-limit-postgresql");
const { errorResponse } = require("../utils/errorResponse");

/**
 * Parse PostgreSQL connection URL into config object
 * @param {string} url - PostgreSQL connection URL
 * @returns {object} - pg client config
 */
function parseConnectionUrl(url) {
  const parsed = new URL(url);

  const sslmode = parsed.searchParams.get("sslmode");
  let ssl = false;
  if (sslmode === "disable") {
    // Explicit opt-out — no SSL
    ssl = false;
  } else if (process.env.NODE_ENV !== "production" && !sslmode) {
    // Dev/test with no explicit sslmode — default to no SSL for zero-friction local setup
    ssl = false;
  } else {
    ssl = { rejectUnauthorized: true };
    if (process.env.DATABASE_CA_CERT) {
      ssl.ca = process.env.DATABASE_CA_CERT;
    }
  }

  return {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 5432,
    database: parsed.pathname.slice(1), // Remove leading slash
    ssl,
  };
}

// Use DIRECT_URL for rate limiting (migrations need direct connection, not pooled)
const dbConfig = parseConnectionUrl(process.env.DIRECT_URL || process.env.DATABASE_URL);

/**
 * Create a rate limiter with PostgreSQL-backed store
 * @param {object} options - express-rate-limit options
 * @param {string} prefix - Unique prefix for this limiter's session
 * @returns {Function} - express middleware
 */
function createRateLimiter(options, prefix) {
  const { message, ...restOptions } = options;
  return rateLimit({
    ...restOptions,
    store: new PostgresStore(dbConfig, prefix),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      errorResponse.rateLimited(res, message || "Too many requests");
    },
  });
}

/**
 * Create a user-based rate limiter (uses userId instead of IP when available)
 * @param {object} options - express-rate-limit options
 * @param {string} prefix - Unique prefix for this limiter's session
 * @returns {Function} - express middleware
 */
function createUserRateLimiter(options, prefix) {
  const { message, ...restOptions } = options;
  return rateLimit({
    ...restOptions,
    store: new PostgresStore(dbConfig, prefix),
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise use IP with proper IPv6 handling
      if (req.user?.id) return req.user.id;
      return ipKeyGenerator(req.ip);
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      errorResponse.rateLimited(res, message || "Too many requests");
    },
  });
}

/**
 * Weighted rate limiting (heavy operations cost more)
 * Uses PostgreSQL for distributed state
 * @param {number} maxPoints - Maximum points allowed in window
 * @param {number} windowMs - Window duration in milliseconds
 * @param {string} prefix - Unique prefix for this limiter
 * @param {string} message - Custom error message
 * @returns {Function} - Middleware factory that takes cost parameter
 */
function createWeightedLimiter(maxPoints, windowMs, prefix, message) {
  // For weighted limiting, we use a higher max and track points manually
  const limiter = rateLimit({
    windowMs,
    max: maxPoints,
    store: new PostgresStore(dbConfig, prefix),
    keyGenerator: (req) => {
      if (req.user?.id) return req.user.id;
      return ipKeyGenerator(req.ip);
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      errorResponse.rateLimited(res, message || "Too many requests");
    },
  });

  return (cost = 1) =>
    (req, res, next) => {
      // For now, just use the standard limiter
      // Cost-based logic would require custom store implementation
      limiter(req, res, next);
    };
}

module.exports = {
  createRateLimiter,
  createUserRateLimiter,
  createWeightedLimiter,
  parseConnectionUrl,
  dbConfig,
};
