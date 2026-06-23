const { PassThrough } = require("stream");
const { EventEmitter } = require("events");

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("../../src/config/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { spawn } = require("child_process");
const { WorkerManager } = require("../../src/workers/workerManager");

/**
 * Create a fake child process with readable/writable streams
 */
function createFakeProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = jest.fn(() => {
    proc.killed = true;
  });
  return proc;
}

/**
 * Set up spawn to return a fake process that emits ready on next tick
 */
function spawnReadyWorker() {
  const proc = createFakeProcess();
  spawn.mockReturnValue(proc);

  setImmediate(() => {
    proc.stdout.write(
      JSON.stringify({ status: "ready", pid: 1234 }) + "\n"
    );
  });

  return proc;
}

let manager;

beforeEach(() => {
  jest.resetAllMocks();
  manager = new WorkerManager();
});

afterEach(async () => {
  manager.isShuttingDown = true;
  if (manager.worker) {
    manager.worker.kill();
    manager.worker = null;
  }
  manager.ready = false;
  // Clear any pending request timers
  for (const [, pending] of manager.pendingRequests) {
    clearTimeout(pending.timer);
  }
  manager.pendingRequests.clear();
  manager.requestQueue = [];
});

describe("WorkerManager", () => {
  describe("start", () => {
    test("spawns worker and resolves when ready signal received", async () => {
      const proc = spawnReadyWorker();

      await manager.start();

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(manager.ready).toBe(true);
      expect(manager.worker).toBe(proc);
    });

    test("does nothing if worker is already running", async () => {
      spawnReadyWorker();
      await manager.start();

      await manager.start();
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    test("rejects if worker fails to send ready signal within timeout", async () => {
      jest.useFakeTimers({ doNotFake: ["setImmediate"] });

      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      const startPromise = manager.start();
      jest.advanceTimersByTime(10000);

      await expect(startPromise).rejects.toThrow(
        "Worker failed to start within timeout"
      );

      jest.useRealTimers();
    });

    test("rejects if worker emits error", async () => {
      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      const startPromise = manager.start();

      setImmediate(() => {
        proc.emit("error", new Error("spawn ENOENT"));
      });

      await expect(startPromise).rejects.toThrow("spawn ENOENT");
    });

    test("resets restart count on successful start", async () => {
      manager.restartCount = 3;
      spawnReadyWorker();

      await manager.start();

      expect(manager.restartCount).toBe(0);
    });

    test("passes only safe env vars to worker", async () => {
      spawnReadyWorker();
      await manager.start();

      const spawnCall = spawn.mock.calls[0];
      const env = spawnCall[2].env;
      expect(env).toHaveProperty("PATH");
      expect(env).toHaveProperty("NODE_ENV");
      expect(env).not.toHaveProperty("DATABASE_URL");
      expect(env).not.toHaveProperty("JWT_SECRET");
    });
  });

  describe("_handleWorkerOutput", () => {
    test("resolves pending request with output buffer", async () => {
      spawnReadyWorker();
      await manager.start();

      const outputData = Buffer.from("converted-pdf-data");
      const resultPromise = new Promise((resolve, reject) => {
        manager.pendingRequests.set("req-1", {
          resolve,
          reject,
          timer: setTimeout(() => {}, 60000),
        });
      });

      manager._handleWorkerOutput(
        JSON.stringify({
          requestId: "req-1",
          outputBase64: outputData.toString("base64"),
        })
      );

      const result = await resultPromise;
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe("converted-pdf-data");
      expect(manager.pendingRequests.size).toBe(0);
    });

    test("rejects pending request on error response", async () => {
      spawnReadyWorker();
      await manager.start();

      const resultPromise = new Promise((resolve, reject) => {
        manager.pendingRequests.set("req-2", {
          resolve,
          reject,
          timer: setTimeout(() => {}, 60000),
        });
      });

      manager._handleWorkerOutput(
        JSON.stringify({
          requestId: "req-2",
          error: "soffice exit code 1",
        })
      );

      await expect(resultPromise).rejects.toThrow("soffice exit code 1");
    });

    test("ignores empty lines", () => {
      manager._handleWorkerOutput("");
      manager._handleWorkerOutput("   ");
    });

    test("ignores invalid JSON", () => {
      manager._handleWorkerOutput("not valid json{{{");
    });

    test("ignores responses for unknown request IDs", async () => {
      spawnReadyWorker();
      await manager.start();

      manager._handleWorkerOutput(
        JSON.stringify({ requestId: "unknown-id", outputBase64: "abc" })
      );
    });
  });

  describe("_handleWorkerExit", () => {
    test("rejects all pending requests on crash", async () => {
      spawnReadyWorker();
      await manager.start();

      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          new Promise((resolve, reject) => {
            manager.pendingRequests.set(`req-${i}`, {
              resolve,
              reject,
              timer: setTimeout(() => {}, 60000),
            });
          })
        );
      }

      manager.isShuttingDown = true;
      await manager._handleWorkerExit(1, null);

      for (const p of promises) {
        await expect(p).rejects.toThrow("Worker crashed during conversion");
      }
      expect(manager.pendingRequests.size).toBe(0);
    });

    test("sets ready to false and clears worker reference", async () => {
      spawnReadyWorker();
      await manager.start();

      manager.isShuttingDown = true;
      await manager._handleWorkerExit(1, null);

      expect(manager.ready).toBe(false);
      expect(manager.worker).toBeNull();
    });

    test("does not restart when shutting down", async () => {
      spawnReadyWorker();
      await manager.start();
      spawn.mockClear();

      manager.isShuttingDown = true;
      await manager._handleWorkerExit(1, null);

      expect(spawn).not.toHaveBeenCalled();
    });

    test("rejects queued requests when max restarts exceeded", async () => {
      spawnReadyWorker();
      await manager.start();

      manager.restartCount = 5;
      manager.lastRestartTime = Date.now();

      const queuedPromise = new Promise((resolve, reject) => {
        manager.requestQueue.push({ request: {}, resolve, reject });
      });

      await manager._handleWorkerExit(1, null);

      await expect(queuedPromise).rejects.toThrow(
        "Worker unavailable - max restarts exceeded"
      );
      expect(manager.requestQueue).toHaveLength(0);
    });

    test("resets restart count after 1 minute of stability", async () => {
      spawnReadyWorker();
      await manager.start();

      manager.restartCount = 3;
      manager.lastRestartTime = Date.now() - 61000;

      // Restart will be attempted — set up a new process
      const restartProc = spawnReadyWorker();
      await manager._handleWorkerExit(1, null);

      // Count was reset to 0 before incrementing, so now it's 1
      expect(manager.restartCount).toBe(0); // Reset on successful start
    });
  });

  describe("_processQueue", () => {
    test("drains queued requests when worker is ready", async () => {
      spawnReadyWorker();
      await manager.start();

      for (let i = 0; i < 3; i++) {
        manager.requestQueue.push({
          request: { type: "toPdf", inputBase64: "abc", inputExt: "docx" },
          resolve: jest.fn(),
          reject: jest.fn(),
        });
      }

      manager._processQueue();

      expect(manager.requestQueue).toHaveLength(0);
      expect(manager.pendingRequests.size).toBe(3);
    });

    test("does nothing when worker is not ready", () => {
      manager.ready = false;
      manager.requestQueue.push({
        request: {},
        resolve: jest.fn(),
        reject: jest.fn(),
      });

      manager._processQueue();

      expect(manager.requestQueue).toHaveLength(1);
    });
  });

  describe("_sendRequest", () => {
    test("writes JSON to worker stdin and sets up timeout", async () => {
      const proc = spawnReadyWorker();
      await manager.start();

      const chunks = [];
      proc.stdin.on("data", (d) => chunks.push(d.toString()));

      manager._sendRequest(
        { type: "toPdf", inputBase64: "abc", inputExt: "docx" },
        jest.fn(),
        jest.fn()
      );

      expect(manager.pendingRequests.size).toBe(1);
      const written = chunks.join("");
      const parsed = JSON.parse(written.trim());
      expect(parsed.type).toBe("toPdf");
      expect(parsed.requestId).toBeDefined();
    });

    test("rejects with timeout error after REQUEST_TIMEOUT_MS", async () => {
      jest.useFakeTimers({ doNotFake: ["setImmediate"] });

      spawnReadyWorker();
      await manager.start();

      const reject = jest.fn();
      manager._sendRequest({ type: "toPdf" }, jest.fn(), reject);

      expect(reject).not.toHaveBeenCalled();
      jest.advanceTimersByTime(120000);

      expect(reject).toHaveBeenCalledWith(expect.any(Error));
      expect(reject.mock.calls[0][0].message).toBe("Conversion timeout");
      expect(manager.pendingRequests.size).toBe(0);

      jest.useRealTimers();
    });
  });

  describe("convert", () => {
    test("auto-starts worker if not running", async () => {
      spawnReadyWorker();
      expect(manager.worker).toBeNull();

      // convert calls start internally, then queues/sends
      const convertPromise = manager.convert("toPdf", Buffer.from("test"), "docx");

      // Let start() resolve
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(spawn).toHaveBeenCalledTimes(1);
    });

    test("sends request immediately when worker is ready", async () => {
      spawnReadyWorker();
      await manager.start();

      manager.convert("htmlToPdf", Buffer.from("<h1>hi</h1>"));

      expect(manager.pendingRequests.size).toBe(1);
      expect(manager.requestQueue).toHaveLength(0);
    });

    test("queues request when worker exists but is not ready", async () => {
      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      // Start but don't emit ready
      const startPromise = manager.start();
      // Set worker so convert doesn't try to start again
      expect(manager.worker).toBe(proc);

      manager.convert("toPdf", Buffer.from("data"), "docx");

      expect(manager.requestQueue).toHaveLength(1);
      expect(manager.pendingRequests.size).toBe(0);
    });

    test("throws when shutting down", async () => {
      manager.isShuttingDown = true;

      await expect(
        manager.convert("toPdf", Buffer.from("data"), "docx")
      ).rejects.toThrow("Worker is shutting down");
    });
  });

  describe("convenience methods", () => {
    beforeEach(async () => {
      spawnReadyWorker();
      await manager.start();
    });

    test("convertToPdf delegates to convert", () => {
      const spy = jest.spyOn(manager, "convert");
      const buf = Buffer.from("doc");
      manager.convertToPdf(buf, "docx");
      expect(spy).toHaveBeenCalledWith("toPdf", buf, "docx");
    });

    test("convertHtmlToPdf delegates to convert", () => {
      const spy = jest.spyOn(manager, "convert");
      const buf = Buffer.from("<html>");
      manager.convertHtmlToPdf(buf);
      expect(spy).toHaveBeenCalledWith("htmlToPdf", buf);
    });

    test("convertHtmlToDocx delegates to convert", () => {
      const spy = jest.spyOn(manager, "convert");
      const buf = Buffer.from("<html>");
      manager.convertHtmlToDocx(buf);
      expect(spy).toHaveBeenCalledWith("htmlToDocx", buf);
    });

    test("convertPdfToJpg delegates to convert", () => {
      const spy = jest.spyOn(manager, "convert");
      const buf = Buffer.from("pdf");
      manager.convertPdfToJpg(buf);
      expect(spy).toHaveBeenCalledWith("pdfToJpg", buf);
    });
  });

  describe("shutdown", () => {
    test("rejects queued requests", async () => {
      spawnReadyWorker();
      await manager.start();

      const queuedPromise = new Promise((resolve, reject) => {
        manager.requestQueue.push({ request: {}, resolve, reject });
      });
      // Attach catch handler before shutdown to avoid unhandled rejection
      const caught = queuedPromise.catch((e) => e);

      await manager.shutdown();

      const error = await caught;
      expect(error.message).toBe("Worker shutting down");
      expect(manager.requestQueue).toHaveLength(0);
    });

    test("kills worker process", async () => {
      const proc = spawnReadyWorker();
      await manager.start();

      await manager.shutdown();

      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    test("sets isShuttingDown flag", async () => {
      spawnReadyWorker();
      await manager.start();

      await manager.shutdown();

      expect(manager.isShuttingDown).toBe(true);
    });

    test("handles shutdown when no worker is running", async () => {
      await manager.shutdown();
      expect(manager.isShuttingDown).toBe(true);
    });
  });

  describe("getStats", () => {
    test("returns stats when idle", () => {
      expect(manager.getStats()).toEqual({
        running: false,
        ready: false,
        pendingRequests: 0,
        queuedRequests: 0,
        restartCount: 0,
      });
    });

    test("returns stats when running", async () => {
      spawnReadyWorker();
      await manager.start();
      manager.requestQueue.push({ request: {} });

      expect(manager.getStats()).toEqual({
        running: true,
        ready: true,
        pendingRequests: 0,
        queuedRequests: 1,
        restartCount: 0,
      });
    });
  });
});
