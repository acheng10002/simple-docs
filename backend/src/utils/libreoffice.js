/* LIBREOFFICE CONVERSION UTILITIES
Shared functions for document conversion using LibreOffice CLI */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/**
 * Resolve soffice executable path
 * @returns {Promise<string>} - Path to soffice binary
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
 * Run soffice CLI command with timeout
 * @param {string} cmd - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout in milliseconds (default 45000)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function runSoffice(cmd, args, cwd, timeoutMs = 45000) {
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
        new Error(`soffice timeout after ${timeoutMs / 1000} seconds\n${stderr || stdout}`.trim())
      );
    }, timeoutMs);

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

/**
 * Convert a document to PDF using LibreOffice
 * @param {Buffer} inputBuffer - Input file buffer
 * @param {string} inputExt - Input file extension (e.g., 'xlsx', 'pptx')
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function convertToPdf(inputBuffer, inputExt) {
  const soffice = await resolveSoffice();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `${inputExt}2pdf-`));
  const inputFile = path.join(tmpDir, `input.${inputExt}`);
  const outputFile = path.join(tmpDir, 'input.pdf');

  await fs.writeFile(inputFile, inputBuffer);

  try {
    await runSoffice(
      soffice,
      [
        '--headless',
        `-env:UserInstallation=file://${tmpDir}`,
        '--convert-to',
        'pdf',
        '--outdir',
        tmpDir,
        inputFile,
      ],
      tmpDir
    );

    // Verify output exists
    await fs.access(outputFile);
    return await fs.readFile(outputFile);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Convert XLSX to PDF using LibreOffice
 * @param {Buffer} xlsxBuffer - XLSX file buffer
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function convertXlsxToPdf(xlsxBuffer) {
  return convertToPdf(xlsxBuffer, 'xlsx');
}

/**
 * Convert PPTX to PDF using LibreOffice
 * @param {Buffer} pptxBuffer - PPTX file buffer
 * @returns {Promise<Buffer>} - PDF buffer
 */
async function convertPptxToPdf(pptxBuffer) {
  return convertToPdf(pptxBuffer, 'pptx');
}

module.exports = {
  resolveSoffice,
  runSoffice,
  convertToPdf,
  convertXlsxToPdf,
  convertPptxToPdf,
};
