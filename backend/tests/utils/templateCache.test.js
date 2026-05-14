jest.mock("../../src/config/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { TemplateCache } = require("../../src/utils/templateCache");

describe("TemplateCache", () => {
  let cache;

  beforeEach(() => {
    cache = new TemplateCache({
      maxSizeBytes: 1000,
      maxEntrySizeBytes: 500,
      defaultTtlMs: 5000,
    });
  });

  test("stores and retrieves a buffer", () => {
    const buf = Buffer.from("hello");
    cache.set("tpl-1", "key-1", buf);

    const result = cache.get("tpl-1", "key-1");
    expect(result).toEqual(buf);
  });

  test("returns null for cache miss", () => {
    expect(cache.get("tpl-1", "key-1")).toBeNull();
    expect(cache.getStats().misses).toBe(1);
  });

  test("returns null for expired entry", async () => {
    const buf = Buffer.from("hello");
    cache.set("tpl-1", "key-1", buf, 10); // 10ms TTL

    await new Promise((r) => setTimeout(r, 20));

    expect(cache.get("tpl-1", "key-1")).toBeNull();
    expect(cache.getStats().misses).toBe(1);
  });

  test("rejects entries larger than maxEntrySizeBytes", () => {
    const largeBuf = Buffer.alloc(600); // exceeds 500 byte limit
    cache.set("tpl-1", "key-1", largeBuf);

    expect(cache.get("tpl-1", "key-1")).toBeNull();
    expect(cache.getStats().sets).toBe(0);
  });

  test("evicts oldest entries when cache is full", () => {
    cache.set("tpl-1", "key-1", Buffer.alloc(400));
    cache.set("tpl-2", "key-2", Buffer.alloc(400));

    // This should evict tpl-1 to make space
    cache.set("tpl-3", "key-3", Buffer.alloc(400));

    expect(cache.get("tpl-1", "key-1")).toBeNull();
    expect(cache.get("tpl-3", "key-3")).not.toBeNull();
    expect(cache.getStats().evictions).toBeGreaterThan(0);
  });

  test("updates existing entry in place", () => {
    cache.set("tpl-1", "key-1", Buffer.from("old"));
    cache.set("tpl-1", "key-1", Buffer.from("new"));

    const result = cache.get("tpl-1", "key-1");
    expect(result.toString()).toBe("new");
  });

  test("invalidate removes specific entry", () => {
    cache.set("tpl-1", "key-1", Buffer.from("data"));
    cache.invalidate("tpl-1", "key-1");

    expect(cache.get("tpl-1", "key-1")).toBeNull();
  });

  test("invalidate without storageKey removes all versions", () => {
    cache.set("tpl-1", "key-1", Buffer.from("v1"));
    cache.set("tpl-1", "key-2", Buffer.from("v2"));

    cache.invalidate("tpl-1");

    expect(cache.get("tpl-1", "key-1")).toBeNull();
    expect(cache.get("tpl-1", "key-2")).toBeNull();
  });

  test("clear empties the cache", () => {
    cache.set("tpl-1", "key-1", Buffer.from("data"));
    cache.clear();

    expect(cache.get("tpl-1", "key-1")).toBeNull();
    expect(cache.getStats().entries).toBe(0);
  });

  test("getStats returns accurate statistics", () => {
    cache.set("tpl-1", "key-1", Buffer.from("hello"));
    cache.get("tpl-1", "key-1"); // hit
    cache.get("tpl-2", "key-2"); // miss

    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.sets).toBe(1);
    expect(stats.hitRate).toBe("50.0%");
  });

  test("moves accessed entries to most recently used position", () => {
    cache.set("tpl-1", "key-1", Buffer.alloc(400));
    cache.set("tpl-2", "key-2", Buffer.alloc(400));

    // Access tpl-1 to make it most recently used
    cache.get("tpl-1", "key-1");

    // Add tpl-3 — should evict tpl-2 (least recently used), not tpl-1
    cache.set("tpl-3", "key-3", Buffer.alloc(400));

    expect(cache.get("tpl-1", "key-1")).not.toBeNull();
    expect(cache.get("tpl-2", "key-2")).toBeNull();
  });
});
