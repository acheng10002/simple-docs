const crypto = require("crypto");
const express = require("express");
const request = require("supertest");

// Mock dependencies that merge.routes.js imports
jest.mock("../../src/config/prisma");
jest.mock("../../src/middleware/supabase-auth", () => jest.fn((req, res, next) => next()));
jest.mock("../../src/middleware/rate-limiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
  createUserRateLimiter: () => (req, res, next) => next(),
  createWeightedLimiter: () => () => (req, res, next) => next(),
}));
jest.mock("../../src/storage/supabase-storage");
jest.mock("../../src/services/merge.service", () => ({ mergeTemplate: jest.fn() }));
jest.mock("../../src/services/batchJob.service", () => ({
  shouldProcessInline: jest.fn(),
  processRowsInline: jest.fn(),
  createBatchJob: jest.fn(),
  getBatchJobStatus: jest.fn(),
  listBatchJobs: jest.fn(),
}));
jest.mock("../../src/services/template.service", () => ({
  extractFieldsFromTemplate: jest.fn(),
  storeTemplateAndFields: jest.fn(),
}));

// Import the actual verifyHmac from merge.routes.js
const { verifyHmac } = require("../../src/routes/merge.routes");

describe("HMAC verification middleware", () => {
  let app;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET = "test-webhook-secret";
  });

  beforeEach(() => {
    app = express();

    // Raw body parser (same as app.js)
    app.use(
      express.raw({
        type: ["application/json", "application/*+json", "text/csv"],
      })
    );

    // Add mock logger
    app.use((req, res, next) => {
      req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      next();
    });

    app.post("/test", verifyHmac, (req, res) => {
      res.json({ success: true });
    });
  });

  afterAll(() => {
    delete process.env.WEBHOOK_SECRET;
  });

  function generateHMAC(body) {
    return crypto
      .createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(body)
      .digest("hex");
  }

  test("should accept request with valid HMAC signature", async () => {
    const body = JSON.stringify({ data: "test" });
    const signature = generateHMAC(body);

    await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", signature)
      .send(body)
      .expect(200);
  });

  test("should reject request without x-signature header", async () => {
    const body = JSON.stringify({ data: "test" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(401);

    expect(response.body.error.message).toBe("Unauthorized");
  });

  test("should reject request with empty x-signature header", async () => {
    const body = JSON.stringify({ data: "test" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", "  ")
      .send(body)
      .expect(401);

    expect(response.body.error.message).toBe("Unauthorized");
  });

  test("should reject request with invalid hex signature", async () => {
    const body = JSON.stringify({ data: "test" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", "not-valid-hex!")
      .send(body)
      .expect(401);

    expect(response.body.error.message).toBe("Unauthorized");
  });

  test("should reject request with wrong signature", async () => {
    const body = JSON.stringify({ data: "test" });
    const wrongSignature = generateHMAC(JSON.stringify({ data: "wrong" }));

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", wrongSignature)
      .send(body)
      .expect(401);

    expect(response.body.error.message).toBe("Unauthorized");
  });

  test("should reject request when body is tampered after signing", async () => {
    const originalBody = JSON.stringify({ data: "original" });
    const signature = generateHMAC(originalBody);
    const tamperedBody = JSON.stringify({ data: "tampered" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", signature)
      .send(tamperedBody)
      .expect(401);

    expect(response.body.error.message).toBe("Unauthorized");
  });

  test("should accept request with CSV content type", async () => {
    const body = "name,email\nJohn,john@example.com";
    const signature = generateHMAC(body);

    await request(app)
      .post("/test")
      .set("Content-Type", "text/csv")
      .set("x-signature", signature)
      .send(body)
      .expect(200);
  });

  test("should handle special characters and unicode in body", async () => {
    const body = JSON.stringify({
      data: "Special: émojis 🎉 quotes \"' 你好世界",
    });
    const signature = generateHMAC(body);

    await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", signature)
      .send(body)
      .expect(200);
  });
});
