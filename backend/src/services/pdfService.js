const { PDFDocument, StandardFonts, PDFName } = require('pdf-lib');
const path = require('path');
const fs = require('fs').promises;

/**
 * Extract form field names from a fillable PDF
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string[]>} - Array of field names
 */
async function extractPdfFields(pdfBuffer) {
  try {
    // Try form fields first
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (fields.length > 0) {
      return fields.map((field) => field.getName());
    }

    // Fall back to text-based {{placeholder}} extraction
    return await extractPdfTextPlaceholders(pdfBuffer);
  } catch (error) {
    console.error('Error extracting PDF fields:', error);
    throw new Error(`Failed to extract PDF fields: ${error.message}`);
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

    // Update field appearances and attempt to flatten
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
    try {
      form.flatten();
    } catch (flattenError) {
      console.warn('Form flatten failed, continuing without flatten:', flattenError.message);
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error('Error filling PDF form:', error);
    throw new Error(`Failed to fill PDF form: ${error.message}`);
  }
}

/**
 * Extract text-based {{placeholder}} names from PDF content
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string[]>} - Array of placeholder names
 */
async function extractPdfTextPlaceholders(pdfBuffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerSrc = path.join(require.resolve('pdfjs-dist/package.json'), '..', 'legacy', 'build', 'pdf.worker.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const fields = new Set();

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    // Concatenate all text items to handle placeholders split across items
    const fullText = textContent.items.map(item => item.str).join('');
    const matches = fullText.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g);
    for (const match of matches) {
      fields.add(match[1]);
    }
  }

  return Array.from(fields);
}

/**
 * Check if a PDF has form fields (returns true) or text placeholders (returns false)
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<boolean>} - true if form-based, false if text-based
 */
async function isFormBasedPdf(pdfBuffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    return fields.length > 0;
  } catch {
    return false;
  }
}

/**
 * Fill text-based {{placeholder}} values in a PDF using overlay approach.
 * Uses pdfjs-dist to find placeholder positions and pdf-lib to draw replacements.
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {Object} data - Field name/value pairs
 * @returns {Promise<Buffer>} - Filled PDF buffer
 */
async function fillPdfTextPlaceholders(pdfBuffer, data) {
  try {
    const { rgb } = require('pdf-lib');
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerSrc = path.join(require.resolve('pdfjs-dist/package.json'), '..', 'legacy', 'build', 'pdf.worker.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    // Step 1: Use pdfjs-dist to find placeholder positions
    const readDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
    const replacements = []; // { pageIndex, x, y, width, height, fontSize, value }

    for (let pageNum = 1; pageNum <= readDoc.numPages; pageNum++) {
      const page = await readDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      // Accumulate text items to handle placeholders split across items
      const items = textContent.items.filter(item => item.str !== undefined);

      // Build a list of items with their positions and accumulated text
      const lineGroups = [];
      let currentLine = [];
      let lastY = null;

      for (const item of items) {
        const ty = item.transform[5]; // y position in PDF coords
        // Group items on the same line (similar y position)
        if (lastY !== null && Math.abs(ty - lastY) > 2) {
          if (currentLine.length > 0) lineGroups.push(currentLine);
          currentLine = [];
        }
        currentLine.push(item);
        lastY = ty;
      }
      if (currentLine.length > 0) lineGroups.push(currentLine);

      // Search each line group for placeholders
      for (const lineItems of lineGroups) {
        const fullText = lineItems.map(it => it.str).join('');
        const regex = /\{\{\s*([\w.]+)\s*\}\}/g;
        let match;

        while ((match = regex.exec(fullText)) !== null) {
          const fieldName = match[1];
          if (!(fieldName in data)) continue;

          const matchStart = match.index;
          const matchEnd = match.index + match[0].length;

          // Find which items span this match
          let charOffset = 0;
          let startItem = null;
          let endItem = null;

          for (const item of lineItems) {
            const itemStart = charOffset;
            const itemEnd = charOffset + item.str.length;

            if (startItem === null && itemEnd > matchStart) {
              startItem = item;
            }
            if (itemEnd >= matchEnd) {
              endItem = item;
              break;
            }
            charOffset = itemEnd;
          }

          if (!startItem || !endItem) continue;

          // Calculate bounding box in PDF coordinates
          // transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
          const fontSize = Math.abs(startItem.transform[3]) || Math.abs(startItem.transform[0]);
          const y = startItem.transform[5];

          // Calculate x offset within the start item
          // Find how many chars into the startItem the match begins
          let charsBeforeMatch = matchStart;
          let charsBefore = 0;
          for (const item of lineItems) {
            if (item === startItem) break;
            charsBefore += item.str.length;
          }
          const charsIntoStartItem = matchStart - charsBefore;
          const startItemCharWidth = startItem.str.length > 0 ? startItem.width / startItem.str.length : 0;
          const x = startItem.transform[4] + (charsIntoStartItem * startItemCharWidth);

          // Calculate width of the placeholder text
          let placeholderWidth = 0;
          let inMatch = false;
          let matchCharsRemaining = match[0].length;
          charsBefore = 0;

          for (const item of lineItems) {
            const itemStart = charsBefore;
            const itemEnd = charsBefore + item.str.length;

            if (!inMatch && itemEnd > matchStart) {
              inMatch = true;
              const offsetInItem = matchStart - itemStart;
              const charsFromItem = Math.min(item.str.length - offsetInItem, matchCharsRemaining);
              const itemCharWidth = item.str.length > 0 ? item.width / item.str.length : 0;
              placeholderWidth += charsFromItem * itemCharWidth;
              matchCharsRemaining -= charsFromItem;
            } else if (inMatch && matchCharsRemaining > 0) {
              const charsFromItem = Math.min(item.str.length, matchCharsRemaining);
              const itemCharWidth = item.str.length > 0 ? item.width / item.str.length : 0;
              placeholderWidth += charsFromItem * itemCharWidth;
              matchCharsRemaining -= charsFromItem;
            }

            if (matchCharsRemaining <= 0) break;
            charsBefore = itemEnd;
          }

          const width = placeholderWidth;
          const height = fontSize * 1.2;

          replacements.push({
            pageIndex: pageNum - 1,
            x,
            y,
            width,
            height,
            fontSize,
            value: String(data[fieldName]),
          });
        }
      }
    }

    // Step 2: Use pdf-lib to apply replacements
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const r of replacements) {
      const page = pages[r.pageIndex];

      // Draw white rectangle to cover the placeholder
      // y is the text baseline; rectangle starts below baseline (descender) and extends above (ascender)
      page.drawRectangle({
        x: r.x - 1,
        y: r.y - r.fontSize * 0.25,
        width: r.width + 2,
        height: r.fontSize * 1.2,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });

      // Draw replacement text at the baseline position
      page.drawText(r.value, {
        x: r.x,
        y: r.y,
        size: r.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error('Error filling PDF text placeholders:', error);
    throw new Error(`Failed to fill PDF text placeholders: ${error.message}`);
  }
}

module.exports = {
  extractPdfFields,
  extractPdfTextPlaceholders,
  isFormBasedPdf,
  fillPdfForm,
  fillPdfTextPlaceholders,
};
