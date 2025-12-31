/* HTML SERVICE - HTML-SPECIFIC OPERATIONS
Handles field extraction, merging, sanitization, and conversions for HTML templates */

const { JSDOM } = require('jsdom');
const Mustache = require('mustache');
const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const logger = require('../config/logger');

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
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function convertHtmlToPdf(htmlBuffer) {
  let browser;
  try {
    browser = await withTimeout(
      puppeteer.launch({
        headless: 'new',
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      }),
      30000,
      'Puppeteer launch'
    );

    const page = await withTimeout(browser.newPage(), 10000, 'Page creation');

    await withTimeout(
      page.setContent(htmlBuffer.toString('utf-8'), {
        waitUntil: 'networkidle0',
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
 * @param {Buffer} htmlBuffer - HTML file buffer
 * @returns {Promise<Buffer>} - DOCX buffer
 */
async function convertHtmlToDocx(htmlBuffer) {
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

/**
 * Resolve soffice executable path
 */
async function resolveSoffice() {
  if (process.env.SOFFICE_BIN) return process.env.SOFFICE_BIN;

  if (process.platform === 'darwin') {
    const macPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    try {
      await fs.access(macPath);
      return macPath;
    } catch {}
  }

  return 'soffice';
}

/**
 * Run soffice CLI command
 */
function runSoffice(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd });

    let stderr = '',
      stdout = '';
    let killed = false;

    const killTimer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');

      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      reject(
        new Error(`soffice timeout after 45 seconds\n${stderr || stdout}`.trim())
      );
    }, 45000);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.once('error', (e) => {
      clearTimeout(killTimer);
      if (!killed) reject(e);
    });

    proc.once('close', (code) => {
      clearTimeout(killTimer);
      if (killed) return;

      if (code === 0) return resolve({ stdout, stderr });

      const e = new Error(`soffice exit code ${code}\n${stderr || stdout}`.trim());
      e.code = code;
      e.stdout = stdout;
      e.stderr = stderr;
      reject(e);
    });
  });
}

module.exports = {
  extractHtmlFields,
  fillHtmlTemplate,
  sanitizeHtml,
  convertHtmlToPdf,
  convertHtmlToDocx,
};
