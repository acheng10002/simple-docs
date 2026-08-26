const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("fs/promises", () => ({
  access: jest.fn(),
  mkdtemp: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
}));

const { spawn } = require("child_process");
const fs = require("fs/promises");
const { resolveSoffice, runSoffice, convertToPdf } = require("../../src/utils/libreoffice");

function createFakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = jest.fn(() => {
    proc.killed = true;
  });
  return proc;
}

describe("libreoffice", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.SOFFICE_BIN;
  });

  describe("resolveSoffice", () => {
    it("should return SOFFICE_BIN env var if set", async () => {
      process.env.SOFFICE_BIN = "/custom/path/soffice";
      const result = await resolveSoffice();
      expect(result).toBe("/custom/path/soffice");
    });

    it("should return macOS path if accessible on darwin", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });
      fs.access.mockResolvedValue(undefined);

      const result = await resolveSoffice();
      expect(result).toBe("/Applications/LibreOffice.app/Contents/MacOS/soffice");

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should fall back to 'soffice' on darwin if macOS path not found", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });
      fs.access.mockRejectedValue(new Error("ENOENT"));

      const result = await resolveSoffice();
      expect(result).toBe("soffice");

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should return 'soffice' on non-darwin platforms", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      const result = await resolveSoffice();
      expect(result).toBe("soffice");

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("runSoffice", () => {
    it("should resolve on successful exit (code 0)", async () => {
      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      const promise = runSoffice("soffice", ["--headless"], "/tmp");

      setImmediate(() => {
        proc.emit("close", 0);
      });

      const result = await promise;
      expect(result).toEqual({ stdout: "", stderr: "" });
    });

    it("should reject on non-zero exit code", async () => {
      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      const promise = runSoffice("soffice", ["--headless"], "/tmp");

      setImmediate(() => {
        proc.stderr.write("conversion error");
        proc.emit("close", 1);
      });

      await expect(promise).rejects.toThrow("soffice exit code 1");
    });

    it("should reject on spawn error", async () => {
      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      const promise = runSoffice("soffice", ["--headless"], "/tmp");

      setImmediate(() => {
        proc.emit("error", new Error("ENOENT"));
      });

      await expect(promise).rejects.toThrow("ENOENT");
    });

    it("should reject on timeout and kill the process", async () => {
      jest.useFakeTimers();
      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      const promise = runSoffice("soffice", ["--headless"], "/tmp", 100);

      jest.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow("soffice timeout");
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

      jest.useRealTimers();
    });
  });

  describe("convertToPdf", () => {
    it("should write input, run soffice, and return PDF buffer", async () => {
      const inputBuffer = Buffer.from("test content");
      const outputBuffer = Buffer.from("pdf content");

      fs.mkdtemp.mockResolvedValue("/tmp/xlsx2pdf-123");
      fs.writeFile.mockResolvedValue(undefined);
      fs.access.mockResolvedValue(undefined);
      fs.readFile.mockResolvedValue(outputBuffer);
      fs.rm.mockResolvedValue(undefined);

      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      // Set SOFFICE_BIN to avoid platform detection
      process.env.SOFFICE_BIN = "soffice";

      const promise = convertToPdf(inputBuffer, "xlsx");

      setImmediate(() => {
        proc.emit("close", 0);
      });

      const result = await promise;
      expect(result).toEqual(outputBuffer);
      expect(fs.writeFile).toHaveBeenCalledWith("/tmp/xlsx2pdf-123/input.xlsx", inputBuffer);
      expect(fs.rm).toHaveBeenCalledWith("/tmp/xlsx2pdf-123", { recursive: true, force: true });
    });

    it("should clean up temp directory even on error", async () => {
      const inputBuffer = Buffer.from("test content");

      fs.mkdtemp.mockResolvedValue("/tmp/docx2pdf-456");
      fs.writeFile.mockResolvedValue(undefined);
      fs.rm.mockResolvedValue(undefined);

      const proc = createFakeProcess();
      spawn.mockReturnValue(proc);

      process.env.SOFFICE_BIN = "soffice";

      const promise = convertToPdf(inputBuffer, "docx");

      setImmediate(() => {
        proc.emit("close", 1);
      });

      await expect(promise).rejects.toThrow();
      expect(fs.rm).toHaveBeenCalledWith("/tmp/docx2pdf-456", { recursive: true, force: true });
    });
  });
});
