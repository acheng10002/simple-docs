const { withTimeout } = require("../../src/utils/timeout");

describe("withTimeout", () => {
  test("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      1000,
      "test-op"
    );
    expect(result).toBe("done");
  });

  test("rejects with timeout error when promise takes too long", async () => {
    let timer;
    const slowPromise = new Promise((resolve) => {
      timer = setTimeout(resolve, 5000);
    });

    await expect(
      withTimeout(slowPromise, 50, "slow-op")
    ).rejects.toThrow("slow-op timeout after 50ms");

    clearTimeout(timer);
  });

  test("rejects with original error if promise fails before timeout", async () => {
    const failingPromise = Promise.reject(new Error("original error"));

    await expect(
      withTimeout(failingPromise, 1000, "fail-op")
    ).rejects.toThrow("original error");
  });
});
