const { createLimiter } = require("../../src/utils/concurrency");

describe("concurrency limiter", () => {
  test("allows operations up to the concurrency limit", async () => {
    const limiter = createLimiter(2);

    const release1 = await limiter.acquire();
    const release2 = await limiter.acquire();

    expect(limiter.stats()).toEqual({ running: 2, queued: 0, limit: 2 });

    release1();
    release2();

    expect(limiter.stats()).toEqual({ running: 0, queued: 0, limit: 2 });
  });

  test("queues operations beyond the limit", async () => {
    const limiter = createLimiter(1);

    const release1 = await limiter.acquire();
    expect(limiter.stats().running).toBe(1);

    // This should queue
    let release2Resolved = false;
    const acquire2 = limiter.acquire().then((release) => {
      release2Resolved = true;
      return release;
    });

    expect(limiter.stats().queued).toBe(1);
    expect(release2Resolved).toBe(false);

    // Release first slot — queued operation should proceed
    release1();

    const release2 = await acquire2;
    expect(release2Resolved).toBe(true);
    expect(limiter.stats().running).toBe(1);

    release2();
  });

  test("rejects with timeout when queue wait exceeds limit", async () => {
    const limiter = createLimiter(1);

    const release = await limiter.acquire();

    await expect(limiter.acquire(50)).rejects.toThrow("Queue timeout");

    release();
  }, 10000);

  test("run() executes function and releases slot", async () => {
    const limiter = createLimiter(1);

    const result = await limiter.run(async () => {
      expect(limiter.stats().running).toBe(1);
      return "result";
    });

    expect(result).toBe("result");
    expect(limiter.stats().running).toBe(0);
  });

  test("run() releases slot even if function throws", async () => {
    const limiter = createLimiter(1);

    await expect(
      limiter.run(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(limiter.stats().running).toBe(0);
  });
});
