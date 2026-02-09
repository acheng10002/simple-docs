/* CONVERSION WORKER MANAGER
Manages isolated worker processes for document conversion.
Provides crash recovery, timeout handling, and request queuing.
*/

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');

// Get logger safely
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

// Configuration
const WORKER_SCRIPT = path.join(__dirname, 'conversionWorker.js');
const REQUEST_TIMEOUT_MS = parseInt(process.env.CONVERSION_TIMEOUT_MS, 10) || 120000; // 2 minutes
const MAX_RESTARTS = parseInt(process.env.CONVERSION_MAX_RESTARTS, 10) || 5;
const RESTART_DELAY_MS = 1000;

/**
 * Worker Manager - spawns and manages conversion worker processes
 */
class WorkerManager extends EventEmitter {
  constructor() {
    super();
    this.worker = null;
    this.ready = false;
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timer }
    this.requestQueue = [];
    this.restartCount = 0;
    this.lastRestartTime = 0;
    this.isShuttingDown = false;
    this.rl = null;
  }

  /**
   * Start the worker process
   */
  async start() {
    if (this.worker) {
      return;
    }

    return new Promise((resolve, reject) => {
      logger.info('Starting conversion worker');

      // Spawn worker with minimal environment
      this.worker = spawn(process.execPath, [WORKER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          // Only pass safe env vars
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR || '/tmp',
          NODE_ENV: process.env.NODE_ENV,
          SOFFICE_BIN: process.env.SOFFICE_BIN,
          PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
        },
      });

      // Set up line reader for stdout
      this.rl = readline.createInterface({
        input: this.worker.stdout,
        crlfDelay: Infinity,
      });

      this.rl.on('line', (line) => this._handleWorkerOutput(line));

      // Handle stderr (log but don't fail)
      this.worker.stderr.on('data', (data) => {
        logger.warn({ stderr: data.toString() }, 'Worker stderr');
      });

      // Handle worker exit
      this.worker.on('exit', (code, signal) => {
        logger.warn({ code, signal }, 'Worker exited');
        this._handleWorkerExit(code, signal);
      });

      this.worker.on('error', (err) => {
        logger.error({ err }, 'Worker error');
        reject(err);
      });

      // Wait for ready signal with timeout
      const readyTimeout = setTimeout(() => {
        reject(new Error('Worker failed to start within timeout'));
      }, 10000);

      this.once('ready', () => {
        clearTimeout(readyTimeout);
        this.restartCount = 0;
        resolve();
      });
    });
  }

  /**
   * Handle output from worker
   */
  _handleWorkerOutput(line) {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      logger.warn({ line }, 'Invalid JSON from worker');
      return;
    }

    // Handle ready signal
    if (message.status === 'ready') {
      this.ready = true;
      logger.info({ pid: message.pid }, 'Conversion worker ready');
      this.emit('ready');
      this._processQueue();
      return;
    }

    // Handle response
    const { requestId, outputBase64, error } = message;
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      logger.warn({ requestId }, 'Received response for unknown request');
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(Buffer.from(outputBase64, 'base64'));
    }
  }

  /**
   * Handle worker exit
   */
  async _handleWorkerExit(code, signal) {
    this.ready = false;
    this.worker = null;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Worker crashed during conversion'));
    }
    this.pendingRequests.clear();

    // Restart unless shutting down or too many restarts
    if (this.isShuttingDown) {
      return;
    }

    const now = Date.now();
    if (now - this.lastRestartTime > 60000) {
      // Reset restart count after 1 minute of stability
      this.restartCount = 0;
    }

    this.restartCount++;
    this.lastRestartTime = now;

    if (this.restartCount > MAX_RESTARTS) {
      logger.error({ restartCount: this.restartCount }, 'Worker exceeded max restarts');
      // Reject queued requests
      for (const queued of this.requestQueue) {
        queued.reject(new Error('Worker unavailable - max restarts exceeded'));
      }
      this.requestQueue = [];
      return;
    }

    logger.info({ restartCount: this.restartCount }, 'Restarting worker');
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));

    try {
      await this.start();
    } catch (err) {
      logger.error({ err }, 'Failed to restart worker');
    }
  }

  /**
   * Process queued requests
   */
  _processQueue() {
    while (this.requestQueue.length > 0 && this.ready) {
      const queued = this.requestQueue.shift();
      this._sendRequest(queued.request, queued.resolve, queued.reject);
    }
  }

  /**
   * Send a request to the worker
   */
  _sendRequest(request, resolve, reject) {
    const requestId = randomUUID();
    request.requestId = requestId;

    // Set up timeout
    const timer = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      reject(new Error('Conversion timeout'));
    }, REQUEST_TIMEOUT_MS);

    this.pendingRequests.set(requestId, { resolve, reject, timer });

    // Send to worker
    this.worker.stdin.write(JSON.stringify(request) + '\n');
  }

  /**
   * Queue a conversion request
   */
  async convert(type, inputBuffer, inputExt = null) {
    if (this.isShuttingDown) {
      throw new Error('Worker is shutting down');
    }

    // Start worker if not running
    if (!this.worker) {
      await this.start();
    }

    const request = {
      type,
      inputBase64: inputBuffer.toString('base64'),
      inputExt,
    };

    return new Promise((resolve, reject) => {
      if (this.ready) {
        this._sendRequest(request, resolve, reject);
      } else {
        // Queue for when worker is ready
        this.requestQueue.push({ request, resolve, reject });
      }
    });
  }

  /**
   * Convert document to PDF
   */
  async convertToPdf(inputBuffer, inputExt) {
    return this.convert('toPdf', inputBuffer, inputExt);
  }

  /**
   * Convert HTML to PDF
   */
  async convertHtmlToPdf(htmlBuffer) {
    return this.convert('htmlToPdf', htmlBuffer);
  }

  /**
   * Convert HTML to DOCX
   */
  async convertHtmlToDocx(htmlBuffer) {
    return this.convert('htmlToDocx', htmlBuffer);
  }

  /**
   * Convert PDF to JPG
   */
  async convertPdfToJpg(pdfBuffer) {
    return this.convert('pdfToJpg', pdfBuffer);
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.isShuttingDown = true;

    // Reject queued requests
    for (const queued of this.requestQueue) {
      queued.reject(new Error('Worker shutting down'));
    }
    this.requestQueue = [];

    // Wait for pending requests (with timeout)
    if (this.pendingRequests.size > 0) {
      await Promise.race([
        new Promise((r) => {
          const check = () => {
            if (this.pendingRequests.size === 0) r();
            else setTimeout(check, 100);
          };
          check();
        }),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    }

    // Kill worker
    if (this.worker) {
      this.worker.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1000));
      if (this.worker && !this.worker.killed) {
        this.worker.kill('SIGKILL');
      }
    }

    logger.info('Conversion worker shutdown complete');
  }

  /**
   * Get worker stats
   */
  getStats() {
    return {
      running: this.worker !== null,
      ready: this.ready,
      pendingRequests: this.pendingRequests.size,
      queuedRequests: this.requestQueue.length,
      restartCount: this.restartCount,
    };
  }
}

// Singleton instance
const workerManager = new WorkerManager();

module.exports = {
  workerManager,
  WorkerManager,
};
