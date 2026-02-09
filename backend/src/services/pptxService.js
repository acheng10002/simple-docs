const PptxGenJS = require('pptxgenjs');
const AdmZip = require('adm-zip');

/**
 * Escape special regex characters in a string to prevent regex injection
 * @param {string} string - String to escape
 * @returns {string} - Escaped string safe for use in RegExp
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract field placeholders from a PPTX template
 * Looks for text containing {{fieldName}} or ${fieldName} patterns
 * @param {Buffer} pptxBuffer - PPTX file buffer
 * @returns {Promise<string[]>} - Array of unique field names
 */
async function extractPptxFields(pptxBuffer) {
  try {
    const zip = new AdmZip(pptxBuffer);
    const fields = new Set();
    const placeholderRegex = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;

    // Extract all slide XML files
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
        const content = entry.getData().toString('utf8');

        let match;
        while ((match = placeholderRegex.exec(content)) !== null) {
          const fieldName = match[1] || match[2];
          fields.add(fieldName.trim());
        }
      }
    }

    return Array.from(fields);
  } catch (error) {
    console.error('Error extracting PPTX fields:', error);
    throw new Error(`Failed to extract PPTX fields: ${error.message}`);
  }
}

/**
 * Fill PPTX template with provided data
 * Replaces {{fieldName}} or ${fieldName} patterns with actual values
 * @param {Buffer} pptxBuffer - PPTX file buffer
 * @param {Object} data - Field name/value pairs
 * @param {string} outputFormat - 'pptx', 'ppsx', 'pdf', or 'jpg'
 * @returns {Promise<Buffer>} - Filled PPTX buffer
 */
async function fillPptxTemplate(pptxBuffer, data, outputFormat = 'pptx') {
  try {
    const zip = new AdmZip(pptxBuffer);

    // Process all slide XML files
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
        let content = entry.getData().toString('utf8');

        // Replace all placeholders
        for (const [fieldName, fieldValue] of Object.entries(data)) {
          const escapedFieldName = escapeRegExp(fieldName);
          const patterns = [
            new RegExp(`\\{\\{${escapedFieldName}\\}\\}`, 'g'),
            new RegExp(`\\$\\{${escapedFieldName}\\}`, 'g'),
          ];

          patterns.forEach((pattern) => {
            content = content.replace(pattern, fieldValue);
          });
        }

        zip.updateFile(entry, Buffer.from(content, 'utf8'));
      }
    }

    // Generate output based on format
    let outputBuffer = zip.toBuffer();

    if (outputFormat === 'ppsx') {
      // PPSX is essentially PPTX with different extension
      // Just need to change the content type
      const contentTypesEntry = zip.getEntry('[Content_Types].xml');
      if (contentTypesEntry) {
        let contentTypes = contentTypesEntry.getData().toString('utf8');
        contentTypes = contentTypes.replace(
          /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/g,
          'application/vnd.openxmlformats-officedocument.presentationml.slideshow'
        );
        zip.updateFile(contentTypesEntry, Buffer.from(contentTypes, 'utf8'));
        outputBuffer = zip.toBuffer();
      }
    } else if (outputFormat === 'pdf' || outputFormat === 'jpg') {
      console.warn(`${outputFormat.toUpperCase()} output for PPTX requires conversion, returning PPTX for now`);
      // TODO: Implement PPTX to PDF/JPG conversion using LibreOffice or similar
    }

    return outputBuffer;
  } catch (error) {
    console.error('Error filling PPTX template:', error);
    throw new Error(`Failed to fill PPTX template: ${error.message}`);
  }
}

module.exports = {
  extractPptxFields,
  fillPptxTemplate,
};
