/* CONCURRENCY LIMITER
Prevents memory exhaustion by limiting parallel operations that buffer large files */

/**
 * Creates a semaphore-based concurrency limiter
 * @param {number} maxConcurrent - Maximum concurrent operations allowed
 * @returns {Object} - Limiter with acquire/release methods
 */
function createLimiter(maxConcurrent) {
  let running = 0;
  const queue = [];

  return {
    /**
     * Get current stats
     */
    stats() {
      return { running, queued: queue.length, limit: maxConcurrent };
    },

    /**
     * Acquire a slot - resolves when slot is available
     * @param {number} timeoutMs - Optional timeout in ms (default: 30000)
     * @returns {Promise<Function>} - Release function to call when done
     */
    acquire(timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const tryAcquire = () => {
          if (running < maxConcurrent) {
            running++;
            resolve(() => {
              running--;
              if (queue.length > 0) {
                const next = queue.shift();
                clearTimeout(next.timer);
                next.tryAcquire();
              }
            });
            return true;
          }
          return false;
        };

        if (!tryAcquire()) {
          const timer = setTimeout(() => {
            const idx = queue.findIndex((q) => q.timer === timer);
            if (idx !== -1) queue.splice(idx, 1);
            reject(new Error('Queue timeout - server is busy, please retry later'));
          }, timeoutMs);

          queue.push({ tryAcquire, timer });
        }
      });
    },

    /**
     * Run a function with concurrency limiting
     * @param {Function} fn - Async function to run
     * @param {number} timeoutMs - Optional timeout for acquiring slot
     * @returns {Promise<*>} - Result of fn
     */
    async run(fn, timeoutMs = 30000) {
      const release = await this.acquire(timeoutMs);
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

// Shared limiter for merge operations (template processing)
// Limit to 3 concurrent merges to cap memory at ~180MB for buffers (3 × 60MB)
const mergeLimiter = createLimiter(
  parseInt(process.env.MAX_CONCURRENT_MERGES, 10) || 3
);

// Shared limiter for file conversions (PDF generation, format conversion)
// These are CPU and memory intensive
const conversionLimiter = createLimiter(
  parseInt(process.env.MAX_CONCURRENT_CONVERSIONS, 10) || 2
);

module.exports = {
  createLimiter,
  mergeLimiter,
  conversionLimiter,
};
