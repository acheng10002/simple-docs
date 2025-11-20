const crypto = require("crypto");
const express = require("express");
const request = require("supertest");

// tests the verifyHmac middleware in isolation
describe("HMAC verification middleware", () => {
  let app;
  let verifyHmac;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET = "test-webhook-secret";
  });

  beforeEach(() => {
    // creates fresh app for each test
    app = express();

    // applies raw body parser (same as App.js)
    app.use(
      express.raw({
        type: ["application/json", "application/**json", "text/csv"],
      })
    );

    verifyHmac = (req, res, next) => {
      const sigHex = (req.get("x-signature") || "").trim();
      if (!sigHex) return res.status(401).json({ error: "Unauthorized" });

      const raw = req.body;
      if (!Buffer.isBuffer(raw)) {
        return res.status(400).json({ error: "Webhook requires raw body" });
      }

      const expectedSignature = crypto
        .createHmac("sha256", process.env.WEBHOOK_SECRET)
        .update(raw)
        .digest();

      let provided;
      try {
        provided = Buffer.from(sigHex, "hex");
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (
        !provided ||
        provided.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(provided, expectedSignature)
      ) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      next();
    };

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

    expect(response.body.error).toBe("Unauthorized");
  });

  test("should reject request with empty x-signature header", async () => {
    const body = JSON.stringify({ data: "test" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", "  ")
      .send(body)
      .expect(401);

    expect(response.body.error).toBe("Unauthorized");
  });

  test("should reject request with invalid hex signature", async () => {
    const body = JSON.stringify({ data: "test" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", "not-valid-hex!")
      .send(body)
      .expect(401);

    expect(response.body.error).toBe("Unauthorized");
  });

  test("should reject request with wrong signature", async () => {
    const body = JSON.stringify({ data: "test" });

    // generates HMAC for different body
    const wrongSignature = generateHMAC(JSON.stringify({ data: "wrong" }));

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", wrongSignature)
      .send(body)
      .expect(401);

    expect(response.body.error).toBe("Unauthorized");
  });

  test("should reject request when body is tampered after signing", async () => {
    const originalBody = JSON.stringify({ data: "original" });
    const wrongSignature = generateHMAC(originalBody);
    const tamperedBody = JSON.stringify({ data: "tampered" });

    const response = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("x-signature", wrongSignature)
      .send(tamperedBody)
      .expect(401);

    expect(response.body.error).toBe("Unauthorized");
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
