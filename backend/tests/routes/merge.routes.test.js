const request = require("supertest");
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Readable } = require("stream");

// mocks prisma
jest.mock("../../src/config/prisma");
const prisma = require("../../src/config/prisma");

// mocks passport
jest.mock("../../src/config/passport", () => {
  const passport = require("passport");
  const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");

  passport.use(
    new JwtStrategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: process.env.JWT_SECRET || "test-secret",
      },
      async (payload, done) => {
        if (payload.id === "user-123") {
          return done(null, { id: "user-123", email: "test@example.com" });
        }
        return done(null, false);
      }
    )
  );
  return { passport };
});

// mocks S3 client
jest.mock("../../src/storage/supabase-storage");

const { s3 } = require("../../src/storage/supabase-storage");

// mocks merge service
jest.mock("../../src/services/merge.service", () => ({
  mergeTemplate: jest.fn(),
}));

const { mergeTemplate } = require("../../src/services/merge.service");

// mocks template service
jest.mock("../../src/services/template.service", () => ({
  resolveTemplateFile: jest.fn(),
}));

const { resolveTemplateFile } = require("../../src/services/template.service");

// mocks multer upload middleware
jest.mock("../../src/middleware/upload.middleware", () => ({
  uploadCsv: {
    single: () => (req, res, next) => {
      if (req.body && req.body._mockFile) {
        req.file = req.npdu._mockFile;
      }
      next();
    },
  },
}));

describe("Merge Routes", () => {
  let app;
  let validToken;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.WEBHOOK_SECRET = "test-webhook-secret";
    process.env.S3_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // creates express app
    app = express();

    // initializes passport
    const { passport } = require("../../src/config/passport");
    app.use(passport.initialize());

    // body parsers
    const rawJson = express.raw({
      type: ["application/json", "application.*+json", "text/csv"],
    });

    app.use("/api/webhooks", rawJson);
    app.use(express.json({ limit: "10mb" }));

    // mount routes
    const mergeRouter = require("../../src/routes/merge.routes");
    app.use("/api", mergeRouter);

    // generate valid JWT token
    validToken = jwt.sign({ id: "user-123" }, process.env.JWT_SECRET);
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.S3_BUCKET;
  });

  function generateHMAC(body) {
    return crypto
      .createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(body)
      .digest("hex");
  }

  describe("GET /api/templates/:templateId/download", () => {
    test("should download template with valid JWT", async () => {
      const mockStream = Readable.from([Buffer.from("file contents")]);

      resolveTemplateFile.mockResolvedValue({
        s3Key: "uploads/test.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordpressingml.document",
        downloadName: "test.docx",
        stat: { size: 1234 },
      });

      s3.send.mockResolvedValue({
        Body: mockStream,
      });

      const response = await request(app)
        .get("/api/templates/template-1/download")
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(resolveTemplateFile).toHaveBeenCalledWith("template-1");
      expect(response.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.wordpressingml.document"
      );
      expect(response.headers["content-disposition"]).toContain("test.docx");
    });

    test("should return 401 without JWT", async () => {
      await request(app).get("/api/templates/template-1/download").expect(401);
    });

    test("should return 404 when template not found", async () => {
      resolveTemplateFile.mockResolvedValue(null);

      await request(app)
        .get("/api/templates/nonexistent/download")
        .et("Authorization", `Bearer ${validToken}`)
        .expect(404);
    });

    test("should return 404 when file missing in storage", async () => {
      resolveTemplateFile.mockResolvedValue({
        missing: true,
      });

      const response = await request(app)
        .get("/api/templates/template-1/download")
        .set("Authorization", `Bearer ${validToken}`)
        .expect(404);

      expect(response.body.error).toBe("Template file missing in storage");
    });
  });

  describe("POST /api/templates/:templateId/merge", () => {
    test("should merge template with valid JWT and data", async () => {
      mergeTemplate.mockResolvedValue({
        jobId: 101,
        filePath: "s3://test-bucket/outputs/result.pdf",
      });

      const response = await request(app)
        .get("/api/templates/template-1/merge")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          data: { name: "John Doe", email: "john@example.com" },
          outputType: "pdf",
        })
        .expect(200);

      expect(response.body.jobId).toBe(101);
      expect(response.body.filePath).toContain("s3://test-bucket/outputs");
      expect(mergeTemplate).toHaveBeenCalledWith({
        templateId: "template-1",
        data: { name: "John Doe", email: "john@example.com" },
        outputType: "pdf",
        userId: "user-123",
      });
    });

    test("should return 401 without JWT", async () => {
      await request(app)
        .post("/api/templates/template-1/merge")
        .send({ data: { name: "John" } })
        .expect(401);
    });

    test("should use default outputType of docx", async () => {
      mergeTemplate.mockResolveValue({
        jobId: 102,
        filePath: "s3://test-bucket/outputs/result.docx",
      });

      await request(app)
        .post("/api/templates/template-1/merge")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ data: { name: "Jane" } })
        .expect(200);

      expect(mergeTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          outputType: "docx",
        })
      );
    });

    test("should return 422 for template parse errors", async () => {
      const parseError = new Error("TEMPLATE_PARSE_ERROR");
      parseError.details = [
        {
          id: "duplicate_open_tag",
          explanation: "Duplicate open tag",
        },
      ];
      mergeTemplate.mockRejectedValue(parseError);

      const response = await request(app)
        .post("/api/templates/template-1/merge")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ data: { name: "Test" } })
        .expect(422);

      expect(response.body.error).toBe(
        "Template has invalid Docxtemplater tags"
      );
      expect(response.body.details).toBeDefined();
    });

    test("should return 400 for other errors", async () => {
      mergeTemplate.mockRejectedValue(new Error("Something went wrong"));

      const response = await request(app)
        .post("/api/templates/template-1/merge")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ data: { name: "Test" } })
        .expect(400);

      expect(response.body.error).toBe("Something went wrong");
    });
  });

  describe("POST /api/templates/:templateId/merge-csv", () => {
    test("should merge CSV with valid JWT and file", async () => {
      mergeTemplate
        .mockResolvedValueOnce({
          jobId: 201,
          filePath: "s3://test-bucket/outputs.result1.pdf",
        })
        .mockResolvedValueOnce({
          jobId: 202,
          filePath: "s3://test-bucket/outputs.result2.pdf",
        });

      const csvContent =
        "name,email\nJohn,john@example.com\nJane,jane@example.com";

      const response = await request(app)
        .post("/api/templates/template-1/merge-csv")
        .set("Authorization", `Bearer ${validToken}`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(2);
      expect(mergeTemplate).toHaveBeenCalledTimes(2);
    });

    test("should return 401 without JWT", async () => {
      await request(app)
        .post("/api/templates/template-1/merge-csv")
        .expect(401);
    });

    test("should return 400 with invalid outputType", async () => {
      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post("/api/templates/template-1/merge-csv")
        .set("Authorization", `Bearer ${validToken}`)
        .field("outputType", "invalid")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(400);

      expect(response.body.error).toContain("Invalid outputType");
    });

    test("should return 400 when CSV is empty", async () => {
      const response = await request(app)
        .post("/api/templates/template-1/merge-csv")
        .set("Authorization", `Bearer ${validToken}`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(""), "data.csv")
        .expect(400);

      expect(response.body.error).toContain("empty");
    });

    test("should return 400 with invalid CSV format", async () => {
      const invalidCsv = 'name,email\ninvalid csv content "unclosed quote';

      const response = await request(app)
        .post("/api/templates/template-1/merge-csv")
        .set("Authorization", `Bearer ${validToken}`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(invalidCsv), "data.csv")
        .expect(400);

      expect(response.body.error).toContain("Invalid CSV format");
    });

    test("should return 400 when CSV has no data rows", async () => {
      const csvContent = "name,email\n";

      const response = await request(app)
        .post("/api/templates/template-1/merge-csv")
        .set("Authorization", `Bearer ${validToken}`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(400);

      expect(response.body.error).toContain("No data rows found");
    });

    test("should return 422 for template parse errors", async () => {
      const parseError = new Error("TEMPLATE_PARSE_ERROR");
      parseError.details = [{ id: "error" }];
      mergeTemplate.mockRejectedValue(parseError);

      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post("/api/templates/template-1/merge-csv")
        .set("Authorization", `Bearer ${validToken}`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(422);

      expect(response.body.error).toBe(
        "Template has invalid Docxtemplater tags"
      );
    });
  });

  describe("POST /api/webhooks/templates/:templateId", () => {
    test("should process webhook with valid HMAC and JSON", async () => {
      mergeTemplate.mockResolvedValue({
        jobId: 301,
        filePath: "s3://test-bucket/outputs/result.pdf",
      });

      const body = JSON.stringify({ name: "John", email: "john@example.com" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1?outputType=pdf")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.count).toBe(1);
      expect(response.body.jobs).toHaveLength(1);
      expect(mergeTemplate).toHaveBeenCalledWith({
        templateId: "template-1",
        data: { name: "John", email: "john@example.com" },
        outputType: "pdf",
        userId: null,
        fromWebhook: true,
      });
    });

    test("should process webhook with valid HMAC and CSV", async () => {
      mergeTemplate
        .mockResolvedValueOnce({
          jobId: 302,
          filePath: "s3://test-bucket/outputs/result1.pdf",
        })
        .mockResolvedValueOnce({
          jobId: 303,
          filePath: "s3://test-bucket/outputs/result3.pdf",
        });

      const body = "name,email\nJohn,john@example.com\nJane,jane@example.com";
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1?outputType=pdf")
        .set("Content-Type", "text/csv")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(2);
      expect(mergeTemplate).toHaveBeenCalledWith(2);
    });

    test("should process JSON array", async () => {
      mergeTemplate
        .mockResolvedValueOnce({
          jobId: 401,
          filePath: "s3://output1",
        })
        .mockResolvedValueOnce({
          jobId: 402,
          filePath: "s3://output2",
        });

      const body = JSON.stringify([{ name: "John" }, { name: "Jane" }]);

      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(mergeTemplate).toHaveBeenCalledWith(2);
    });

    test("should return 401 without x-signature", async () => {
      const body = JSON.stringify({ name: "John" });

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .send(body)
        .expect(401);

      expect(response.body.error).toBe("Unauthorized");
    });

    test("should return 401 with invalid signature", async () => {
      const body = JSON.stringify({ name: "John" });

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .send(body)
        .expect(401);

      expect(response.body.error).toBe("Unauthorized");
    });

    test("should return 415 for unsupported content type", async () => {
      const body = "plain text";
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "text/plain")
        .set("x-signature", signature)
        .send(body)
        .expect(415);

      expect(response.body.error).toBe("Unsupported content type");
    });

    test("should return 400 for invalid JSON", async () => {
      const body = "invalid JSON {";
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(400);

      expect(response.body.error).toBe("Invalid payload");
    });

    test("should return 413 for too many rows", async () => {
      const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
      const body = JSON.stringify(rows);
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(413);

      expect(response.body.error).toBe("Too many rows");
    });

    test("should return warnings when merge produces warnings", async () => {
      mergeTemplate.mockResolvedValue({
        jobId: 501,
        filePath: "s3://output",
        warnings: ["Field 'extra' not in template"],
      });
      const body = JSON.stringify({ name: "John", extra: "data" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.warnings).toBeDefined();
      expect(response.body.warnings).toHaveLength(1);
      expect(response.body.warnings[0].row).toBe(1);
    });

    test("should return 422 for template parse errors", async () => {
      const parseError = new Error("TEMPLATE_PARSE_ERROR");
      parseError.details = [{ id: "error" }];
      mergeTemplate.mockRejectedValue(parseError);

      const body = JSON.stringify({ name: "John" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/template-1")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(422);

      expect(response.body.error).toBe(
        "Template has invalid Docxtemplater tags"
      );
    });
  });
});
