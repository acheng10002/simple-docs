/* MEMORY GUARD MIDDLEWARE
Rejects requests when memory usage is too high to prevent OOM crashes */

const v8 = require('v8');

// Default threshold: reject if heap used exceeds 80% of heap limit
const MEMORY_THRESHOLD = parseFloat(process.env.MEMORY_THRESHOLD) || 0.8;

/**
 * Middleware that rejects requests when memory is critically high
 * Helps prevent OOM during concurrent file processing
 */
function memoryGuard(req, res, next) {
  const heapStats = v8.getHeapStatistics();
  const usedRatio = heapStats.used_heap_size / heapStats.heap_size_limit;

  if (usedRatio > MEMORY_THRESHOLD) {
    // Log the memory pressure event
    if (req.log) {
      req.log.warn(
        {
          usedHeapMB: Math.round(heapStats.used_heap_size / 1024 / 1024),
          heapLimitMB: Math.round(heapStats.heap_size_limit / 1024 / 1024),
          usedRatio: usedRatio.toFixed(2),
        },
        'Request rejected due to memory pressure'
      );
    }

    return res.status(503).json({
      error: 'Server is under heavy load, please retry in a few seconds',
      retryAfter: 5,
    });
  }

  next();
}

/**
 * Get current memory stats (useful for health checks)
 */
function getMemoryStats() {
  const heapStats = v8.getHeapStatistics();
  const processMemory = process.memoryUsage();

  return {
    heapUsedMB: Math.round(heapStats.used_heap_size / 1024 / 1024),
    heapLimitMB: Math.round(heapStats.heap_size_limit / 1024 / 1024),
    heapUsedRatio: (heapStats.used_heap_size / heapStats.heap_size_limit).toFixed(2),
    rssMB: Math.round(processMemory.rss / 1024 / 1024),
    externalMB: Math.round(processMemory.external / 1024 / 1024),
  };
}

module.exports = {
  memoryGuard,
  getMemoryStats,
  MEMORY_THRESHOLD,
};
