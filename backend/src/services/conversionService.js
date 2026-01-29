/* CONVERSION SERVICE - FORMAT CONVERSION OPERATIONS
Handles conversions between formats, especially to JPG output using Puppeteer */

const puppeteer = require('puppeteer');
const logger = require('../config/logger');

let browserInstance = null;

/**
 * Timeout wrapper for promises
 */
function withTimeout(promise, ms, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timeout after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

/**
 * Get or create a shared Puppeteer browser instance
 * @returns {Promise<Browser>}
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return browserInstance;
}

/**
 * Convert HTML content to JPG using Puppeteer
 * @param {string|Buffer} htmlContent - HTML string or buffer
 * @returns {Promise<Buffer>} - JPG image buffer
 */
async function convertHtmlToJpg(htmlContent) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
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

    const html = Buffer.isBuffer(htmlContent)
      ? htmlContent.toString('utf-8')
      : htmlContent;

    await withTimeout(
      page.setContent(html, { waitUntil: 'domcontentloaded' }), // Changed from networkidle0
      25000,
      'HTML page load'
    );

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2, // For better quality
    });

    const screenshot = await withTimeout(
      page.screenshot({
        type: 'jpeg',
        quality: 90,
        fullPage: true,
      }),
      30000,
      'Screenshot capture'
    );

    return screenshot;
  } catch (error) {
    logger.error({ error }, 'Error converting HTML to JPG');
    throw new Error(`Failed to convert HTML to JPG: ${error.message}`);
  } finally {
    await page.close();
  }
}

/**
 * Convert PDF buffer to JPG using Puppeteer
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<Buffer>} - JPG image buffer (first page only)
 */
async function convertPdfToJpg(pdfBuffer) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
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

    // Convert PDF buffer to base64 data URL
    const pdfBase64 = pdfBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${pdfBase64}`;

    await withTimeout(
      page.goto(dataUrl, { waitUntil: 'domcontentloaded' }),
      25000,
      'PDF page load'
    );

    // Set viewport for PDF rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2,
    });

    const screenshot = await withTimeout(
      page.screenshot({
        type: 'jpeg',
        quality: 90,
        fullPage: true,
      }),
      30000,
      'Screenshot capture'
    );

    return screenshot;
  } catch (error) {
    logger.error({ error }, 'Error converting PDF to JPG');
    throw new Error(`Failed to convert PDF to JPG: ${error.message}`);
  } finally {
    await page.close();
  }
}

/**
 * Convert DOCX to JPG by first converting to HTML, then to JPG
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @param {Function} docxToHtmlFn - Function that converts DOCX buffer to HTML buffer
 * @returns {Promise<Buffer>} - JPG image buffer
 */
async function convertDocxToJpg(docxBuffer, docxToHtmlFn) {
  try {
    // First convert DOCX to HTML
    const htmlBuffer = await docxToHtmlFn(docxBuffer);

    // Then convert HTML to JPG
    return await convertHtmlToJpg(htmlBuffer);
  } catch (error) {
    logger.error({ error }, 'Error converting DOCX to JPG');
    throw new Error(`Failed to convert DOCX to JPG: ${error.message}`);
  }
}

/**
 * Convert PPTX to JPG (placeholder - requires PPTX to HTML/PDF conversion first)
 * @param {Buffer} pptxBuffer - PPTX file buffer
 * @param {Function} pptxToPdfFn - Function that converts PPTX to PDF (if available)
 * @returns {Promise<Buffer>} - JPG image buffer
 */
async function convertPptxToJpg(pptxBuffer, pptxToPdfFn) {
  try {
    // Convert PPTX to PDF first (requires LibreOffice or similar)
    const pdfBuffer = await pptxToPdfFn(pptxBuffer);

    // Then convert PDF to JPG
    return await convertPdfToJpg(pdfBuffer);
  } catch (error) {
    logger.error({ error }, 'Error converting PPTX to JPG');
    throw new Error(`Failed to convert PPTX to JPG: ${error.message}`);
  }
}

/**
 * Clean up browser instance
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
      browserInstance = null;
    } catch (error) {
      logger.warn({ error }, 'Error closing browser instance');
    }
  }
}

// Clean up on process exit
process.on('exit', async () => {
  await closeBrowser();
});

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

module.exports = {
  getBrowser,
  convertHtmlToJpg,
  convertPdfToJpg,
  convertDocxToJpg,
  convertPptxToJpg,
  closeBrowser,
};
