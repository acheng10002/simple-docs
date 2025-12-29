/* CSV INJECTION PREVENTION
- sanitizes formula-like values to prevent CSV injection attacks
- prepends dangerous characters with single quote to neutralize formulas
- protects against: Excel formulas, DDE attacks, command execution */

/**
 * Sanitizes a value to prevent CSV formula injection
 * @param {any} value - The value to sanitize
 * @returns {string} - Sanitized value safe for CSV/Excel
 */
function sanitizeCsvValue(value) {
  // converts to string, handles null/undefined
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // dangerous formula characters that can trigger execution
  const dangerousChars = [
    '=',  // Excel formula
    '+',  // Excel formula
    '-',  // Excel formula
    '@',  // Excel formula
    '|',  // Pipe (command separator)
    '%',  // Batch variable
  ];

  // checks if value starts with dangerous character (after trimming whitespace)
  const trimmed = str.trimStart();

  if (dangerousChars.some(char => trimmed.startsWith(char))) {
    // prepends single quote to neutralize formula
    // Excel/Google Sheets will treat as literal text
    return "'" + str;
  }

  // also checks for tab character at start (another injection vector)
  if (trimmed.startsWith('\t')) {
    return "'" + str;
  }

  return str;
}

/**
 * Sanitizes all values in a CSV row object
 * @param {Object} row - CSV row object with key-value pairs
 * @returns {Object} - Sanitized row object
 */
function sanitizeCsvRow(row) {
  // handles non-object inputs
  if (typeof row !== 'object' || row === null) {
    return {};
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(row)) {
    sanitized[key] = sanitizeCsvValue(value);
  }

  return sanitized;
}

/**
 * Sanitizes all rows in a CSV data array
 * @param {Array<Object>} rows - Array of CSV row objects
 * @returns {Array<Object>} - Array of sanitized row objects
 */
function sanitizeCsvRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(row => sanitizeCsvRow(row));
}

module.exports = {
  sanitizeCsvValue,
  sanitizeCsvRow,
  sanitizeCsvRows,
};
