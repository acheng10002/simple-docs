const rateLimit = require("express-rate-limit");
// User-based rate limiting for authenticated routes
function createUserRateLimiter(options) {
  return rateLimit({
    ...options,
    // Use userId instead of IP for authenticated users
    keyGenerator: (req) => {
      return req.user?.id || req.ip;
    },
  });
}

// Weighted rate limiting (heavy operations cost more)
function createWeightedLimiter(maxPoints, windowMs) {
  const store = new Map();

  return (cost = 1) =>
    (req, res, next) => {
      const key = req.user?.id || req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Clean old entries
      if (!store.has(key)) {
        store.set(key, []);
      }

      const requests = store.get(key).filter((time) => time > windowStart);
      const points = requests.reduce((sum, r) => sum + (r.cost || 1), 0);

      if (points + cost > maxPoints) {
        return res.status(429).json({
          error: "Rate limit exceeded",
          retryAfter: Math.ceil((windowStart + windowMs - now) / 1000),
        });
      }

      requests.push({ time: now, cost });
      store.set(key, requests);
      next();
    };
}

module.exports = { createUserRateLimiter, createWeightedLimiter };
