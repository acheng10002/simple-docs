jest.mock("../../src/config/prisma");
jest.mock("../../src/config/logger", () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const prisma = require("../../src/config/prisma");
const logger = require("../../src/config/logger");
const { logError, error, warn, info, expressErrorHandler } = require("../../src/utils/error-logger");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.errorLog = { create: jest.fn().mockResolvedValue({}) };
});

describe("error-logger", () => {
  describe("logError", () => {
    it("should write to database and log via pino", async () => {
      const testError = new Error("test error");

      await logError({
        level: "error",
        message: "Something failed",
        error: testError,
        context: { userId: "user-1" },
      });

      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: {
          level: "error",
          message: "Something failed",
          stack: testError.stack,
          context: expect.objectContaining({
            userId: "user-1",
            errorName: "Error",
            loggedAt: expect.any(String),
          }),
        },
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: testError }),
        "Something failed"
      );
    });

    it("should handle null error gracefully", async () => {
      await logError({
        level: "warn",
        message: "Warning message",
      });

      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: {
          level: "warn",
          message: "Warning message",
          stack: null,
          context: expect.objectContaining({
            errorName: undefined,
            errorCode: undefined,
          }),
        },
      });

      expect(logger.warn).toHaveBeenCalled();
    });

    it("should fall back to pino logging if database write fails", async () => {
      prisma.errorLog.create.mockRejectedValue(new Error("DB connection failed"));
      const testError = new Error("original error");

      await logError({
        level: "error",
        message: "Something failed",
        error: testError,
      });

      // Should log the DB failure via pino
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          originalError: testError,
          dbError: expect.any(Error),
        }),
        expect.stringContaining("Failed to log error to database")
      );
    });

    it("should default level to 'error'", async () => {
      await logError({ message: "Default level" });

      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ level: "error" }),
      });
    });
  });

  describe("convenience functions", () => {
    it("error() should call logError with level 'error'", async () => {
      await error("Error message");
      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ level: "error", message: "Error message" }),
      });
    });

    it("warn() should call logError with level 'warn'", async () => {
      await warn("Warn message");
      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ level: "warn", message: "Warn message" }),
      });
    });

    it("info() should call logError with level 'info'", async () => {
      await info("Info message");
      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ level: "info", message: "Info message" }),
      });
    });
  });

  describe("expressErrorHandler", () => {
    const mockReq = {
      id: "req-123",
      method: "POST",
      url: "/api/merge",
      user: { id: "user-1", email: "test@example.com" },
      ip: "127.0.0.1",
      get: jest.fn().mockReturnValue("Mozilla/5.0"),
    };

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const mockNext = jest.fn();

    it("should log error to database and return 500", async () => {
      const err = new Error("Unhandled error");

      await expressErrorHandler(err, mockReq, mockRes, mockNext);

      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          level: "error",
          message: "Unhandled error",
        }),
      });

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-123" })
      );
    });

    it("should use err.status if provided", async () => {
      const err = new Error("Not found");
      err.status = 404;

      await expressErrorHandler(err, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it("should return generic message in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const err = new Error("Sensitive internal details");
      await expressErrorHandler(err, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Internal server error",
        requestId: "req-123",
      });

      process.env.NODE_ENV = originalEnv;
    });

    it("should return actual error message in development", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const err = new Error("Detailed error info");
      await expressErrorHandler(err, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Detailed error info",
        requestId: "req-123",
      });

      process.env.NODE_ENV = originalEnv;
    });

    it("should hash PII in context", async () => {
      const err = new Error("test");
      await expressErrorHandler(err, mockReq, mockRes, mockNext);

      const createCall = prisma.errorLog.create.mock.calls[0][0];
      const context = createCall.data.context;

      // emailHash and ipHash should be hashed (12 char hex), not raw values
      expect(context.emailHash).not.toBe("test@example.com");
      expect(context.ipHash).not.toBe("127.0.0.1");
      expect(context.emailHash).toMatch(/^[a-f0-9]{12}$/);
      expect(context.ipHash).toMatch(/^[a-f0-9]{12}$/);
    });
  });
});
