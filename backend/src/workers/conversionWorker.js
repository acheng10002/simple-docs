#!/usr/bin/env node
/* ISOLATED CONVERSION WORKER
Runs document conversions in a separate process with no access to app secrets.
Communicates via JSON over stdin/stdout.

Security properties:
- No access to DATABASE_URL, JWT_SECRET, etc.
- Chrome sandbox enabled in production (disabled in dev for local setup)
- SSRF protection via request interception (only data: URLs allowed)
- Can be run with restricted seccomp profile
- Network access can be disabled
- Crashes don't affect main process
*/

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

// Only allow specific env vars needed for conversion
const ALLOWED_ENV = ['SOFFICE_BIN', 'PUPPETEER_EXECUTABLE_PATH', 'NODE_ENV', 'PATH', 'HOME', 'TMPDIR'];
for (const key of Object.keys(process.env)) {
  if (!ALLOWED_ENV.includes(key)) {
    delete process.env[key];
  }
}

// Chrome sandbox is enabled in production, disabled in development for easier local setup
const isDev = process.env.NODE_ENV === 'development';
const CHROME_SANDBOX_ARGS = isDev
  ? ['--no-sandbox', '--disable-setuid-sandbox']
  : []; // Sandbox enabled in production

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
 * Run soffice CLI command with timeout
 */
function runSoffice(cmd, args, cwd, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '', stdout = '';
    let killed = false;

    const killTimer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
      reject(new Error(`soffice timeout after ${timeoutMs / 1000}s`));
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
      reject(e);
    });
  });
}

/**
 * Convert document to PDF using LibreOffice
 */
async function convertToPdf(inputBuffer, inputExt) {
  const soffice = await resolveSoffice();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `conv-${inputExt}-`));
  const inputFile = path.join(tmpDir, `input.${inputExt}`);
  const outputFile = path.join(tmpDir, 'input.pdf');

  await fs.writeFile(inputFile, inputBuffer);

  try {
    await runSoffice(soffice, [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      inputFile,
    ], tmpDir);

    await fs.access(outputFile);
    return await fs.readFile(outputFile);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Convert HTML to PDF using Puppeteer
 */
async function convertHtmlToPdf(htmlBuffer) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        ...CHROME_SANDBOX_ARGS,
      ],
    });

    const page = await browser.newPage();

    // Block all network requests (SSRF protection)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('data:')) {
        request.continue();
      } else {
        request.abort('blockedbyclient');
      }
    });

    await page.setContent(htmlBuffer.toString('utf-8'), {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const pdfBuffer = await page.pdf({ format: 'Letter' });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

/**
 * Convert HTML to DOCX using LibreOffice
 */
async function convertHtmlToDocx(htmlBuffer) {
  const soffice = await resolveSoffice();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html2docx-'));
  const inHtml = path.join(tmpDir, 'source.html');
  const midOdt = path.join(tmpDir, 'source.odt');
  const outDocx = path.join(tmpDir, 'source.docx');

  await fs.writeFile(inHtml, htmlBuffer);

  try {
    // HTML -> ODT
    await runSoffice(soffice, [
      '--headless',
      '--infilter=HTML (StarWriter)',
      '--convert-to', 'odt',
      '--outdir', tmpDir,
      inHtml,
    ], tmpDir);

    await fs.access(midOdt);

    // ODT -> DOCX
    await runSoffice(soffice, [
      '--headless',
      '--convert-to', 'docx',
      '--outdir', tmpDir,
      midOdt,
    ], tmpDir);

    return await fs.readFile(outDocx);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Convert PDF to JPG using Puppeteer
 */
async function convertPdfToJpg(pdfBuffer) {
  const path = require('path');
  const fsSync = require('fs');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        ...CHROME_SANDBOX_ARGS,
      ],
    });

    const page = await browser.newPage();

    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfjsDir = path.join(require.resolve('pdfjs-dist/package.json'), '..');
    const pdfjsScript = fsSync.readFileSync(path.join(pdfjsDir, 'legacy', 'build', 'pdf.mjs'), 'utf-8');
    const workerScript = fsSync.readFileSync(path.join(pdfjsDir, 'legacy', 'build', 'pdf.worker.mjs'), 'utf-8');
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

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 25000 });

    await page.waitForFunction(
      () => document.body.getAttribute('data-ready') === 'true',
      { timeout: 30000 }
    );

    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 90,
      fullPage: true,
    });

    return Buffer.from(screenshot);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

/**
 * Process a conversion request
 */
async function processRequest(request) {
  const { type, inputBase64, inputExt } = request;
  const inputBuffer = Buffer.from(inputBase64, 'base64');

  let outputBuffer;

  switch (type) {
    case 'toPdf':
      outputBuffer = await convertToPdf(inputBuffer, inputExt);
      break;
    case 'htmlToPdf':
      outputBuffer = await convertHtmlToPdf(inputBuffer);
      break;
    case 'htmlToDocx':
      outputBuffer = await convertHtmlToDocx(inputBuffer);
      break;
    case 'pdfToJpg':
      outputBuffer = await convertPdfToJpg(inputBuffer);
      break;
    default:
      throw new Error(`Unknown conversion type: ${type}`);
  }

  return { outputBase64: outputBuffer.toString('base64') };
}

/**
 * Main loop - read requests from stdin, write responses to stdout
 */
async function main() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Signal ready
  console.log(JSON.stringify({ status: 'ready', pid: process.pid }));

  for await (const line of rl) {
    if (!line.trim()) continue;

    let request;
    try {
      request = JSON.parse(line);
    } catch (err) {
      console.log(JSON.stringify({ error: 'Invalid JSON', requestId: null }));
      continue;
    }

    const { requestId } = request;

    try {
      const result = await processRequest(request);
      console.log(JSON.stringify({ requestId, ...result }));
    } catch (err) {
      console.log(JSON.stringify({ requestId, error: err.message }));
    }
  }
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
