/* CONVERSION SERVICE - FORMAT CONVERSION OPERATIONS
Handles conversions between formats using isolated worker process for security.
Falls back to in-process conversion if worker is disabled. */

const puppeteer = require('puppeteer');

// Safe logger wrapper
let logger;
try {
  const rawLogger = require('../config/logger');
  logger = {
    debug: (...args) => rawLogger.debug?.(...args),
    info: (...args) => rawLogger.info?.(...args),
    warn: (...args) => rawLogger.warn?.(...args),
    error: (...args) => rawLogger.error?.(...args),
  };
} catch {
  logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

// Use isolated worker by default in production
const USE_ISOLATED_WORKER = process.env.CONVERSION_USE_WORKER !== 'false' &&
  process.env.NODE_ENV !== 'test';

// Lazy load worker manager to avoid circular dependencies
let workerManager = null;
function getWorkerManager() {
  if (!workerManager && USE_ISOLATED_WORKER) {
    workerManager = require('../workers/workerManager').workerManager;
  }
  return workerManager;
}

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
 * Get or create a shared Puppeteer browser instance (for in-process mode)
 * @returns {Promise<Browser>}
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    const isDev = process.env.NODE_ENV === 'development';

    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        ...(isDev ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      ],
    });
  }
  return browserInstance;
}

/**
 * Convert HTML content to JPG
 * Uses isolated worker in production, in-process in development/test
 */
async function convertHtmlToJpg(htmlContent) {
  const htmlBuffer = Buffer.isBuffer(htmlContent)
    ? htmlContent
    : Buffer.from(htmlContent, 'utf-8');

  // Try isolated worker first
  const wm = getWorkerManager();
  if (wm) {
    try {
      // Worker converts HTML -> PDF -> JPG
      const pdfBuffer = await wm.convertHtmlToPdf(htmlBuffer);
      return await wm.convertPdfToJpg(pdfBuffer);
    } catch (err) {
      logger.warn({ err }, 'Worker conversion failed, falling back to in-process');
    }
  }

  // Fallback to in-process
  return convertHtmlToJpgInProcess(htmlBuffer);
}

/**
 * In-process HTML to JPG conversion
 */
async function convertHtmlToJpgInProcess(htmlContent) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
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
      page.setContent(html, { waitUntil: 'domcontentloaded' }),
      25000,
      'HTML page load'
    );

    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2,
    });

    const screenshot = await withTimeout(
      page.screenshot({ type: 'jpeg', quality: 90, fullPage: true }),
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
 * Convert PDF buffer to JPG
 * Uses isolated worker in production
 */
async function convertPdfToJpg(pdfBuffer) {
  // Try isolated worker first
  const wm = getWorkerManager();
  if (wm) {
    try {
      return await wm.convertPdfToJpg(pdfBuffer);
    } catch (err) {
      logger.warn({ err }, 'Worker conversion failed, falling back to in-process');
    }
  }

  // Fallback to in-process
  return convertPdfToJpgInProcess(pdfBuffer);
}

/**
 * In-process PDF to JPG conversion
 */
async function convertPdfToJpgInProcess(pdfBuffer) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const path = require('path');
    const fs = require('fs');

    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfjsDir = path.join(require.resolve('pdfjs-dist/package.json'), '..');
    const pdfjsScript = fs.readFileSync(path.join(pdfjsDir, 'legacy', 'build', 'pdf.mjs'), 'utf-8');
    const workerScript = fs.readFileSync(path.join(pdfjsDir, 'legacy', 'build', 'pdf.worker.mjs'), 'utf-8');
    const workerBlob = Buffer.from(workerScript).toString('base64');

    const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { background: white; }
  canvas { display: block; }
</style></head><body>
<div id="pages"></div>
<script type="module">
${pdfjsScript}

GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([atob('${workerBlob}')], { type: 'application/javascript' })
);

const data = atob('${pdfBase64}');
const uint8 = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) uint8[i] = data.charCodeAt(i);

const pdf = await getDocument({ data: uint8 }).promise;
const container = document.getElementById('pages');

for (let i = 1; i <= pdf.numPages; i++) {
  const pg = await pdf.getPage(i);
  const viewport = pg.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  container.appendChild(canvas);
  await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}

document.body.setAttribute('data-ready', 'true');
</script></body></html>`;

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('data:') || request.url() === 'about:blank') {
        request.continue();
      } else {
        request.abort('blockedbyclient');
      }
    });

    await withTimeout(
      page.setContent(html, { waitUntil: 'domcontentloaded' }),
      25000,
      'HTML page load'
    );

    await withTimeout(
      page.waitForFunction(() => document.body.getAttribute('data-ready') === 'true'),
      30000,
      'PDF rendering'
    );

    const screenshot = await withTimeout(
      page.screenshot({ type: 'jpeg', quality: 90, fullPage: true }),
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
 * Convert DOCX to JPG
 */
async function convertDocxToJpg(docxBuffer, docxToHtmlFn) {
  try {
    const htmlBuffer = await docxToHtmlFn(docxBuffer);
    return await convertHtmlToJpg(htmlBuffer);
  } catch (error) {
    logger.error({ error }, 'Error converting DOCX to JPG');
    throw new Error(`Failed to convert DOCX to JPG: ${error.message}`);
  }
}

/**
 * Convert PPTX to JPG
 */
async function convertPptxToJpg(pptxBuffer, pptxToPdfFn) {
  try {
    const pdfBuffer = await pptxToPdfFn(pptxBuffer);
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

/**
 * Shutdown worker and browser
 */
async function shutdown() {
  const wm = getWorkerManager();
  if (wm) {
    await wm.shutdown();
  }
  await closeBrowser();
}

/**
 * Get worker stats (for health endpoint)
 */
function getWorkerStats() {
  const wm = getWorkerManager();
  return wm ? wm.getStats() : { mode: 'in-process' };
}

module.exports = {
  getBrowser,
  convertHtmlToJpg,
  convertPdfToJpg,
  convertDocxToJpg,
  convertPptxToJpg,
  closeBrowser,
  shutdown,
  getWorkerStats,
  USE_ISOLATED_WORKER,
};
