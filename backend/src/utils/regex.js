/**
 * Escape special regex characters in a string to prevent regex injection
 * @param {string} string - String to escape
 * @returns {string} - Escaped string safe for use in RegExp
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegExp };
