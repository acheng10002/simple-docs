const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;

/**
 * Extract form field names from a fillable PDF
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string[]>} - Array of field names
 */
async function extractPdfFields(pdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const fieldNames = fields.map((field) => field.getName());
    return fieldNames;
  } catch (error) {
    console.error('Error extracting PDF fields:', error);
    throw new Error(`Failed to extract PDF form fields: ${error.message}`);
  }
}

/**
 * Fill PDF form fields with provided data
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {Object} data - Field name/value pairs
 * @returns {Promise<Buffer>} - Filled PDF buffer
 */
async function fillPdfForm(pdfBuffer, data) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();

    // Fill each field with provided data
    for (const [fieldName, value] of Object.entries(data)) {
      try {
        const field = form.getField(fieldName);
        const fieldType = field.constructor.name;

        // Handle different field types
        if (fieldType === 'PDFTextField') {
          field.setText(String(value));
        } else if (fieldType === 'PDFCheckBox') {
          if (value === 'true' || value === true || value === 'Yes') {
            field.check();
          } else {
            field.uncheck();
          }
        } else if (fieldType === 'PDFRadioGroup') {
          field.select(String(value));
        } else if (fieldType === 'PDFDropdown') {
          field.select(String(value));
        }
      } catch (fieldError) {
        console.warn(`Warning: Could not fill field "${fieldName}":`, fieldError.message);
        // Continue with other fields
      }
    }

    // Flatten the form to make it non-editable (optional)
    // form.flatten();

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error('Error filling PDF form:', error);
    throw new Error(`Failed to fill PDF form: ${error.message}`);
  }
}

/**
 * Convert PDF to JPG (first page only)
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {Object} puppeteerInstance - Puppeteer browser instance
 * @returns {Promise<Buffer>} - JPG image buffer
 */
async function convertPdfToJpg(pdfBuffer, puppeteerInstance) {
  try {
    const page = await puppeteerInstance.newPage();

    // SSRF protection: Block all network requests (defense-in-depth)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Only allow data: URLs (inline content), block everything else
      if (request.url().startsWith('data:')) {
        request.continue();
      } else {
        request.abort('blockedbyclient');
      }
    });

    // Convert PDF buffer to base64
    const pdfBase64 = pdfBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${pdfBase64}`;

    await page.goto(dataUrl, { waitUntil: 'domcontentloaded' });

    // Take screenshot of the first page
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 90,
      fullPage: true,
    });

    await page.close();
    return screenshot;
  } catch (error) {
    console.error('Error converting PDF to JPG:', error);
    throw new Error(`Failed to convert PDF to JPG: ${error.message}`);
  }
}

module.exports = {
  extractPdfFields,
  fillPdfForm,
  convertPdfToJpg,
};
