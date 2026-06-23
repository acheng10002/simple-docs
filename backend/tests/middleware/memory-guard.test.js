const v8 = require("v8");

jest.spyOn(v8, "getHeapStatistics");

const { memoryGuard, getMemoryStats } = require("../../src/middleware/memory-guard");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(v8, "getHeapStatistics");
});

describe("memoryGuard", () => {
  test("calls next() when memory usage is below threshold", () => {
    v8.getHeapStatistics.mockReturnValue({
      used_heap_size: 400 * 1024 * 1024, // 400 MB
      heap_size_limit: 1000 * 1024 * 1024, // 1000 MB → 40% usage
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    memoryGuard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("returns 503 when memory usage exceeds threshold", () => {
    v8.getHeapStatistics.mockReturnValue({
      used_heap_size: 900 * 1024 * 1024, // 900 MB
      heap_size_limit: 1000 * 1024 * 1024, // 1000 MB → 90% usage
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    memoryGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "SERVICE_UNAVAILABLE",
          retryAfter: 5,
        }),
      })
    );
  });

  test("calls next() when usage is exactly at threshold", () => {
    v8.getHeapStatistics.mockReturnValue({
      used_heap_size: 800 * 1024 * 1024, // 800 MB
      heap_size_limit: 1000 * 1024 * 1024, // 1000 MB → exactly 80%
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    memoryGuard(req, res, next);

    // 0.8 is not > 0.8, so should pass through
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("logs warning when rejecting and req.log is available", () => {
    v8.getHeapStatistics.mockReturnValue({
      used_heap_size: 850 * 1024 * 1024,
      heap_size_limit: 1000 * 1024 * 1024,
    });

    const req = { log: { warn: jest.fn() } };
    const res = mockRes();
    const next = jest.fn();

    memoryGuard(req, res, next);

    expect(req.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        usedHeapMB: expect.any(Number),
        heapLimitMB: expect.any(Number),
        usedRatio: expect.any(String),
      }),
      "Request rejected due to memory pressure"
    );
  });

  test("does not throw when req.log is absent", () => {
    v8.getHeapStatistics.mockReturnValue({
      used_heap_size: 850 * 1024 * 1024,
      heap_size_limit: 1000 * 1024 * 1024,
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    expect(() => memoryGuard(req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("getMemoryStats", () => {
  test("returns formatted memory statistics", () => {
    v8.getHeapStatistics.mockReturnValue({
      used_heap_size: 512 * 1024 * 1024,
      heap_size_limit: 1024 * 1024 * 1024,
    });

    const stats = getMemoryStats();

    expect(stats.heapUsedMB).toBe(512);
    expect(stats.heapLimitMB).toBe(1024);
    expect(stats.heapUsedRatio).toBe("0.50");
    expect(stats).toHaveProperty("rssMB");
    expect(stats).toHaveProperty("externalMB");
  });
});
