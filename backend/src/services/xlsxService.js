const ExcelJS = require('exceljs');

/**
 * Escape special regex characters in a string to prevent regex injection
 * @param {string} string - String to escape
 * @returns {string} - Escaped string safe for use in RegExp
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract field placeholders from an XLSX template
 * Looks for cells containing {{fieldName}} or ${fieldName} patterns
 * @param {Buffer} xlsxBuffer - XLSX file buffer
 * @returns {Promise<string[]>} - Array of unique field names
 */
async function extractXlsxFields(xlsxBuffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer);

    const fields = new Set();
    const placeholderRegex = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;

    // Iterate through all worksheets
    workbook.eachSheet((worksheet) => {
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          const value = cell.value;

          if (typeof value === 'string') {
            let match;
            while ((match = placeholderRegex.exec(value)) !== null) {
              const fieldName = match[1] || match[2];
              fields.add(fieldName.trim());
            }
          }
        });
      });
    });

    return Array.from(fields);
  } catch (error) {
    console.error('Error extracting XLSX fields:', error);
    throw new Error(`Failed to extract XLSX fields: ${error.message}`);
  }
}

/**
 * Fill XLSX template with provided data
 * Replaces {{fieldName}} or ${fieldName} patterns with actual values
 * @param {Buffer} xlsxBuffer - XLSX file buffer
 * @param {Object} data - Field name/value pairs
 * @param {string} outputFormat - 'xlsx' or 'pdf'
 * @returns {Promise<Buffer>} - Filled XLSX buffer
 */
async function fillXlsxTemplate(xlsxBuffer, data, outputFormat = 'xlsx') {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer);

    // Iterate through all worksheets
    workbook.eachSheet((worksheet) => {
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          const value = cell.value;

          if (typeof value === 'string') {
            let newValue = value;

            // Replace all placeholders in the cell
            for (const [fieldName, fieldValue] of Object.entries(data)) {
              const escapedFieldName = escapeRegExp(fieldName);
              const patterns = [
                new RegExp(`\\{\\{${escapedFieldName}\\}\\}`, 'g'),
                new RegExp(`\\$\\{${escapedFieldName}\\}`, 'g'),
              ];

              patterns.forEach((pattern) => {
                newValue = newValue.replace(pattern, fieldValue);
              });
            }

            if (newValue !== value) {
              cell.value = newValue;
            }
          }
        });
      });
    });

    // For PDF output, we would need a conversion library
    // For now, we'll just return the XLSX
    if (outputFormat === 'pdf') {
      console.warn('PDF output for XLSX not yet implemented, returning XLSX');
      // TODO: Implement XLSX to PDF conversion using a library like xlsx-pdf or headless browser
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.error('Error filling XLSX template:', error);
    throw new Error(`Failed to fill XLSX template: ${error.message}`);
  }
}

module.exports = {
  extractXlsxFields,
  fillXlsxTemplate,
};
