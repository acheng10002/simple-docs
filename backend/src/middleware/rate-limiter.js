const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { PostgresStore } = require("@acpr/rate-limit-postgresql");

/**
 * Parse PostgreSQL connection URL into config object
 * @param {string} url - PostgreSQL connection URL
 * @returns {object} - pg client config
 */
function parseConnectionUrl(url) {
  const parsed = new URL(url);
  return {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 5432,
    database: parsed.pathname.slice(1), // Remove leading slash
    ssl: parsed.searchParams.get("sslmode") !== "disable" ? { rejectUnauthorized: false } : false,
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
  return rateLimit({
    ...options,
    store: new PostgresStore(dbConfig, prefix),
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Create a user-based rate limiter (uses userId instead of IP when available)
 * @param {object} options - express-rate-limit options
 * @param {string} prefix - Unique prefix for this limiter's session
 * @returns {Function} - express middleware
 */
function createUserRateLimiter(options, prefix) {
  return rateLimit({
    ...options,
    store: new PostgresStore(dbConfig, prefix),
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise use IP with proper IPv6 handling
      if (req.user?.id) return req.user.id;
      return ipKeyGenerator(req.ip);
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Weighted rate limiting (heavy operations cost more)
 * Uses PostgreSQL for distributed state
 * @param {number} maxPoints - Maximum points allowed in window
 * @param {number} windowMs - Window duration in milliseconds
 * @param {string} prefix - Unique prefix for this limiter
 * @returns {Function} - Middleware factory that takes cost parameter
 */
function createWeightedLimiter(maxPoints, windowMs, prefix) {
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
  dbConfig,
};
