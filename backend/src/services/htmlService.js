/* HTML SERVICE - HTML-SPECIFIC OPERATIONS
Handles field extraction, merging, sanitization, and conversions for HTML templates */

const { JSDOM } = require('jsdom');
const Mustache = require('mustache');
const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const logger = require('../config/logger');
const { resolveSoffice, runSoffice } = require('../utils/libreoffice');
const { withTimeout } = require('../utils/timeout');

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

/**
 * Extract field placeholders from HTML template
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @returns {Promise<string[]>} - Array of field names
 */
async function extractHtmlFields(htmlBuffer) {
  const html = htmlBuffer.toString('utf-8');
  const dom = new JSDOM(html);
  const text = dom.window.document.body.textContent || '';

  // Find all placeholders in format {{ fieldName }} or {{fieldName}}
  const matches = text.match(/{{\s*([\w\.]+)\s*}}/g) || [];

  // Extract unique field names
  return [...new Set(matches.map((m) => m.replace(/{{\s*|\s*}}/g, '')))];
}

/**
 * Fill HTML template with data using Mustache
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @param {Object} data - Field name/value pairs
 * @returns {Buffer} - Filled HTML buffer
 */
function fillHtmlTemplate(htmlBuffer, data) {
  const raw = htmlBuffer.toString('utf-8');
  const merged = Mustache.render(raw, data);
  return Buffer.from(merged, 'utf-8');
}

/**
 * Sanitize HTML buffer to remove dangerous content
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @returns {Buffer} - Sanitized HTML buffer
 */
function sanitizeHtml(htmlBuffer) {
  const dom = new JSDOM(htmlBuffer.toString('utf8'));
  const doc = dom.window.document;

  // Remove dangerous elements
  doc
    .querySelectorAll("script, iframe, object, embed, link[rel='import']")
    .forEach((n) => n.remove());

  // Strip event handlers and javascript URLs
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = String(attr.value || '');

      if (/^on/.test(name)) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(val)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  const htmlOut = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  return Buffer.from(htmlOut, 'utf8');
}

/**
 * Convert HTML to PDF using Puppeteer
 * Uses isolated worker in production, in-process in development/test
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function convertHtmlToPdf(htmlBuffer) {
  const htmlBuf = Buffer.isBuffer(htmlBuffer) ? htmlBuffer : Buffer.from(htmlBuffer, 'utf-8');

  // Try isolated worker first
  const wm = getWorkerManager();
  if (wm) {
    try {
      return await wm.convertHtmlToPdf(htmlBuf);
    } catch (err) {
      logger.warn({ err }, 'Worker HTML->PDF failed, falling back to in-process');
    }
  }

  // Fallback to in-process
  return convertHtmlToPdfInProcess(htmlBuf);
}

/**
 * In-process HTML to PDF conversion using Puppeteer
 */
async function convertHtmlToPdfInProcess(htmlBuffer) {
  let browser;
  try {
    browser = await withTimeout(
      puppeteer.launch({
        headless: 'new',
        args: [
          '--disable-dev-shm-usage', // Use /tmp instead of /dev/shm for shared memory
          // Sandbox enabled in production for security when processing untrusted content
          // Disabled in development for easier local setup
          ...(process.env.NODE_ENV === 'development' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
        ],
      }),
      30000,
      'Puppeteer launch'
    );

    const page = await withTimeout(browser.newPage(), 10000, 'Page creation');

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

    await withTimeout(
      page.setContent(htmlBuffer.toString('utf-8'), {
        waitUntil: 'domcontentloaded', // Changed from networkidle0 since we block network
        timeout: 20000,
      }),
      25000,
      'Page load'
    );

    const pdfBuffer = await withTimeout(
      page.pdf({ format: 'Letter' }),
      30000,
      'PDF generation'
    );

    return pdfBuffer;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        try {
          logger.warn({ err }, 'Error closing Puppeteer browser during cleanup');
        } catch (logErr) {
          console.error('Error closing browser:', err.message);
        }
      }
    }
  }
}

/**
 * Convert HTML to DOCX using LibreOffice CLI
 * Uses isolated worker in production, in-process in development/test
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @returns {Promise<Buffer>} - DOCX buffer
 */
async function convertHtmlToDocx(htmlBuffer) {
  const htmlBuf = Buffer.isBuffer(htmlBuffer) ? htmlBuffer : Buffer.from(htmlBuffer, 'utf-8');

  // Try isolated worker first
  const wm = getWorkerManager();
  if (wm) {
    try {
      return await wm.convertHtmlToDocx(htmlBuf);
    } catch (err) {
      logger.warn({ err }, 'Worker HTML->DOCX failed, falling back to in-process');
    }
  }

  // Fallback to in-process
  return convertHtmlToDocxInProcess(htmlBuf);
}

/**
 * In-process HTML to DOCX conversion using LibreOffice CLI
 */
async function convertHtmlToDocxInProcess(htmlBuffer) {
  const soffice = await resolveSoffice();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html2docx-'));
  const inHtml = path.join(tmpDir, 'source.html');
  const midOdt = path.join(tmpDir, 'source.odt');
  const outDocx = path.join(tmpDir, 'source.docx');

  await fs.writeFile(inHtml, htmlBuffer);

  try {
    // 1. HTML -> ODT (force Writer import)
    await runSoffice(
      soffice,
      [
        '--headless',
        '--infilter=HTML (StarWriter)',
        '--convert-to',
        'odt',
        '--outdir',
        tmpDir,
        inHtml,
      ],
      tmpDir
    );

    await fs.access(midOdt);

    // 2. ODT -> DOCX
    await runSoffice(
      soffice,
      ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, midOdt],
      tmpDir
    );

    return await fs.readFile(outDocx);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = {
  extractHtmlFields,
  fillHtmlTemplate,
  sanitizeHtml,
  convertHtmlToPdf,
  convertHtmlToDocx,
};
