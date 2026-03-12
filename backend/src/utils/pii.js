/* PII UTILITY - Safe handling of personally identifiable information for logging
   Provides hashing and masking functions to prevent PII leakage in logs */

const crypto = require('crypto');

/**
 * Hash PII for safe logging
 * Returns first 12 chars of SHA-256 hash - enough for correlation, not reversible
 * @param {string} value - PII value to hash
 * @returns {string|null} - Truncated hash or null if no value
 */
function hashForLog(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/**
 * Mask email for logging (shows domain only)
 * user@example.com → ***@example.com
 * @param {string} email - Email to mask
 * @returns {string} - Masked email
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '[invalid]';
  const [, domain] = email.split('@');
  return `***@${domain}`;
}

module.exports = { hashForLog, maskEmail };
