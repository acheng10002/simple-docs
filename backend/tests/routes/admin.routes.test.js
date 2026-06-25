const request = require("supertest");
const express = require("express");

jest.mock("../../src/services/cleanup.service");
jest.mock("../../src/config/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { runCleanup, OUTPUT_RETENTION_DAYS } = require("../../src/services/cleanup.service");

// Store original env
const originalCleanupSecret = process.env.CLEANUP_SECRET;

let app;

beforeAll(() => {
  process.env.CLEANUP_SECRET = "test-secret-123";

  app = express();
  app.use((req, res, next) => {
    req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    next();
  });
  app.use(express.json());
  app.use("/api", require("../../src/routes/admin.routes"));
});

afterAll(() => {
  process.env.CLEANUP_SECRET = originalCleanupSecret;
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe("verifyCleanupSecret middleware", () => {
  test("returns 401 when no authorization header", async () => {
    const res = await request(app).post("/api/admin/cleanup");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("returns 403 when token is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/cleanup")
      .set("Authorization", "Bearer wrong-secret");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  test("passes through with valid secret", async () => {
    runCleanup.mockResolvedValue({ outputs: { deleted: 0, errors: 0 } });

    const res = await request(app)
      .post("/api/admin/cleanup")
      .set("Authorization", "Bearer test-secret-123");

    expect(res.status).toBe(200);
  });

  test("handles Bearer prefix case-insensitively", async () => {
    runCleanup.mockResolvedValue({ outputs: { deleted: 0, errors: 0 } });

    const res = await request(app)
      .post("/api/admin/cleanup")
      .set("Authorization", "bearer test-secret-123");

    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/cleanup", () => {
  test("returns cleanup results on success", async () => {
    runCleanup.mockResolvedValue({ outputs: { deleted: 5, errors: 1 } });

    const res = await request(app)
      .post("/api/admin/cleanup")
      .set("Authorization", "Bearer test-secret-123");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.mergeOutputs).toEqual({
      deleted: 5,
      errors: 1,
      retentionDays: OUTPUT_RETENTION_DAYS,
    });
    expect(res.body.timestamp).toBeDefined();
  });

  test("returns 500 when cleanup fails", async () => {
    runCleanup.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app)
      .post("/api/admin/cleanup")
      .set("Authorization", "Bearer test-secret-123");

    expect(res.status).toBe(500);
  });
});

describe("GET /api/admin/health", () => {
  test("returns ok with valid secret", async () => {
    const res = await request(app)
      .get("/api/admin/health")
      .set("Authorization", "Bearer test-secret-123");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });

  test("returns 401 without authorization", async () => {
    const res = await request(app).get("/api/admin/health");

    expect(res.status).toBe(401);
  });
});
