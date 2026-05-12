/* DOCX SERVICE - DOCX-SPECIFIC OPERATIONS
Handles field extraction, merging, and conversions for DOCX templates */

const mammoth = require('mammoth');
const libre = require('libreoffice-convert');
const { promisify, types } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const {
  renderDocxBufferOrThrow,
  TemplateParseError,
} = require('../utils/docx-templating');
const { withTimeout } = require('../utils/timeout');

// Promisify libre.convert if needed
const convertAsync = types.isAsyncFunction(libre.convert)
  ? libre.convert
  : promisify(libre.convert);

/**
 * Extract field placeholders from DOCX template
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @returns {Promise<string[]>} - Array of field names
 */
async function extractDocxFields(docxBuffer) {
  // Use mammoth to extract raw text from DOCX
  const { value: text } = await mammoth.extractRawText({ buffer: docxBuffer });

  // Find all placeholders in format {{ fieldName }}
  const matches = text.match(/{{\s*([\w\.]+)\s*}}/g) || [];

  // Extract unique field names
  return [...new Set(matches.map((m) => m.replace(/{{\s*|\s*}}/g, '')))];
}

/**
 * Fill DOCX template with data using docxtemplater
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @param {Object} data - Field name/value pairs
 * @returns {Promise<Buffer>} - Filled DOCX buffer
 */
async function fillDocxTemplate(docxBuffer, data) {
  try {
    return renderDocxBufferOrThrow(docxBuffer, data);
  } catch (err) {
    if (err instanceof TemplateParseError) {
      err.status = 422;
      throw err;
    }
    throw err;
  }
}

/**
 * Convert DOCX to PDF using LibreOffice
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function convertDocxToPdf(docxBuffer) {
  return withTimeout(
    convertAsync(docxBuffer, '.pdf', undefined),
    45000,
    'DOCX to PDF conversion'
  );
}

/**
 * Convert DOCX to HTML using LibreOffice
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @returns {Promise<Buffer>} - HTML buffer
 */
async function convertDocxToHtml(docxBuffer) {
  // First try in-process converter
  try {
    return await withTimeout(
      convertAsync(docxBuffer, '.html', undefined),
      45000,
      'DOCX to HTML conversion'
    );
  } catch (e) {
    // Fallback to CLI
    const soffice = await resolveSoffice();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx2html-'));
    const inDocx = path.join(tmpDir, 'source.docx');
    const outHtml = path.join(tmpDir, 'source.html');

    await fs.writeFile(inDocx, docxBuffer);

    try {
      await runSoffice(
        soffice,
        [
          '--headless',
          '--convert-to',
          'html:"HTML (StarWriter)"',
          '--outdir',
          tmpDir,
          inDocx,
        ],
        tmpDir
      );

      const html = await fs.readFile(outHtml);
      return html;
    } finally {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {}
    }
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
  extractDocxFields,
  fillDocxTemplate,
  convertDocxToPdf,
  convertDocxToHtml,
};
