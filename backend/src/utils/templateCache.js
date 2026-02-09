/* TEMPLATE BUFFER CACHE
LRU cache for template files to avoid repeated downloads during batch processing */

// Safe logger wrapper that handles test environments where logger may be mocked/unavailable
const rawLogger = require('../config/logger');
const logger = {
  debug: (...args) => rawLogger.debug?.(...args),
  info: (...args) => rawLogger.info?.(...args),
  warn: (...args) => rawLogger.warn?.(...args),
  error: (...args) => rawLogger.error?.(...args),
};

// Configuration
const MAX_CACHE_SIZE_BYTES = parseInt(process.env.TEMPLATE_CACHE_MAX_BYTES, 10) || 50 * 1024 * 1024; // 50MB default
const MAX_ENTRY_SIZE_BYTES = parseInt(process.env.TEMPLATE_CACHE_MAX_ENTRY_BYTES, 10) || 5 * 1024 * 1024; // 5MB default
const DEFAULT_TTL_MS = parseInt(process.env.TEMPLATE_CACHE_TTL_MS, 10) || 5 * 60 * 1000; // 5 minutes default

/**
 * LRU Cache implementation for template buffers
 */
class TemplateCache {
  constructor(options = {}) {
    this.maxSizeBytes = options.maxSizeBytes || MAX_CACHE_SIZE_BYTES;
    this.maxEntrySizeBytes = options.maxEntrySizeBytes || MAX_ENTRY_SIZE_BYTES;
    this.defaultTtlMs = options.defaultTtlMs || DEFAULT_TTL_MS;

    // Map preserves insertion order, we'll use it for LRU
    this.cache = new Map();
    this.currentSizeBytes = 0;

    // Stats
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0,
    };
  }

  /**
   * Generate cache key from template ID and storage key
   * Using both ensures cache invalidation on template updates
   */
  _makeKey(templateId, storageKey) {
    return `${templateId}:${storageKey}`;
  }

  /**
   * Check if entry is expired
   */
  _isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Evict least recently used entries until we have space
   */
  _evictUntilSpace(neededBytes) {
    // Iterate from oldest to newest (Map iteration order)
    for (const [key, entry] of this.cache) {
      if (this.currentSizeBytes + neededBytes <= this.maxSizeBytes) {
        break;
      }

      this.cache.delete(key);
      this.currentSizeBytes -= entry.buffer.length;
      this.stats.evictions++;

      logger.debug({ key, freedBytes: entry.buffer.length }, 'Template cache eviction');
    }
  }

  /**
   * Clean up expired entries
   */
  _cleanExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.currentSizeBytes -= entry.buffer.length;
        this.stats.evictions++;
      }
    }
  }

  /**
   * Get a template buffer from cache
   * @param {string} templateId - Template ID
   * @param {string} storageKey - Storage key (for versioning)
   * @returns {Buffer|null} - Cached buffer or null if not found/expired
   */
  get(templateId, storageKey) {
    const key = this._makeKey(templateId, storageKey);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (this._isExpired(entry)) {
      this.cache.delete(key);
      this.currentSizeBytes -= entry.buffer.length;
      this.stats.misses++;
      return null;
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.buffer;
  }

  /**
   * Store a template buffer in cache
   * @param {string} templateId - Template ID
   * @param {string} storageKey - Storage key (for versioning)
   * @param {Buffer} buffer - Template buffer
   * @param {number} ttlMs - Optional TTL in milliseconds
   */
  set(templateId, storageKey, buffer, ttlMs = this.defaultTtlMs) {
    // Don't cache if buffer is too large
    if (buffer.length > this.maxEntrySizeBytes) {
      logger.debug(
        { templateId, bufferSize: buffer.length, maxSize: this.maxEntrySizeBytes },
        'Template too large to cache'
      );
      return;
    }

    const key = this._makeKey(templateId, storageKey);

    // If already in cache, remove old entry first
    const existing = this.cache.get(key);
    if (existing) {
      this.cache.delete(key);
      this.currentSizeBytes -= existing.buffer.length;
    }

    // Clean expired entries periodically
    if (this.stats.sets % 10 === 0) {
      this._cleanExpired();
    }

    // Evict if needed to make space
    if (this.currentSizeBytes + buffer.length > this.maxSizeBytes) {
      this._evictUntilSpace(buffer.length);
    }

    // Store new entry
    this.cache.set(key, {
      buffer,
      expiresAt: Date.now() + ttlMs,
      templateId,
      storageKey,
    });

    this.currentSizeBytes += buffer.length;
    this.stats.sets++;

    logger.debug(
      { templateId, bufferSize: buffer.length, cacheSize: this.currentSizeBytes },
      'Template cached'
    );
  }

  /**
   * Invalidate a specific template
   * @param {string} templateId - Template ID
   * @param {string} storageKey - Optional storage key (if not provided, invalidates all versions)
   */
  invalidate(templateId, storageKey = null) {
    if (storageKey) {
      const key = this._makeKey(templateId, storageKey);
      const entry = this.cache.get(key);
      if (entry) {
        this.cache.delete(key);
        this.currentSizeBytes -= entry.buffer.length;
      }
    } else {
      // Invalidate all versions of this template
      for (const [key, entry] of this.cache) {
        if (entry.templateId === templateId) {
          this.cache.delete(key);
          this.currentSizeBytes -= entry.buffer.length;
        }
      }
    }
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
    this.currentSizeBytes = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
      : 0;

    return {
      entries: this.cache.size,
      sizeBytes: this.currentSizeBytes,
      sizeMB: (this.currentSizeBytes / 1024 / 1024).toFixed(2),
      maxSizeMB: (this.maxSizeBytes / 1024 / 1024).toFixed(2),
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      evictions: this.stats.evictions,
      sets: this.stats.sets,
    };
  }
}

// Singleton instance
const templateCache = new TemplateCache();

module.exports = {
  templateCache,
  TemplateCache,
};
