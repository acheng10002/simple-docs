const request = require("supertest");
const express = require("express");
const crypto = require("crypto");
const { Readable } = require("stream");

// Mock rate limiter to avoid database connection during tests
jest.mock("../../src/middleware/rate-limiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
  createUserRateLimiter: () => (req, res, next) => next(),
  createWeightedLimiter: () => () => (req, res, next) => next(),
}));

// mocks prisma
jest.mock("../../src/config/prisma");
const prisma = require("../../src/config/prisma");

// Mock user for authenticated requests
const mockUser = {
  id: "user-123",
  email: "test@example.com",
};

// mocks Supabase auth middleware
jest.mock("../../src/middleware/supabase-auth", () => {
  return jest.fn((req, res, next) => {
    req.user = mockUser;
    next();
  });
});

// mocks S3 client
jest.mock("../../src/storage/supabase-storage");

const { s3 } = require("../../src/storage/supabase-storage");

// mocks batch job service
jest.mock("../../src/services/batchJob.service", () => ({
  shouldProcessInline: jest.fn(),
  processRowsInline: jest.fn(),
  createBatchJob: jest.fn(),
  getBatchJobStatus: jest.fn(),
  listBatchJobs: jest.fn(),
}));

const { shouldProcessInline, processRowsInline, getBatchJobStatus, listBatchJobs } = require("../../src/services/batchJob.service");

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

// Use actual multer for CSV file uploads
const multer = require("multer");
const uploadCsv = multer({ storage: multer.memoryStorage() });

// Mock upload middleware to use real multer for CSV
jest.mock("../../src/middleware/upload.middleware", () => {
  const actualMulter = require("multer");
  return {
    uploadCsv: actualMulter({ storage: actualMulter.memoryStorage() }),
  };
});

// Mock memory-guard middleware to pass through
jest.mock("../../src/middleware/memory-guard", () => ({
  memoryGuard: (req, res, next) => next(),
  getMemoryStats: jest.fn(() => ({ heapUsedMB: 100, heapLimitMB: 500 })),
  MEMORY_THRESHOLD: 0.8,
}));

// Valid template ID matching the regex /^c[a-z0-9]{24}$/
const VALID_TEMPLATE_ID = "cm12345678901234567890123";

describe("Merge Routes", () => {
  let app;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET = "test-webhook-secret";
    process.env.S3_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default batch job mocks - inline processing for small CSVs
    shouldProcessInline.mockReturnValue(true);

    // creates express app
    app = express();

    // Add mock logger to requests
    app.use((req, res, next) => {
      req.log = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      next();
    });

    // body parsers
    const rawJson = express.raw({
      type: ["application/json", "application.*+json", "text/csv"],
    });

    app.use("/api/webhooks", rawJson);
    app.use(express.json({ limit: "10mb" }));

    // mount routes
    const mergeRouter = require("../../src/routes/merge.routes");
    app.use("/api", mergeRouter);
  });

  afterAll(() => {
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
    test("should download template when user owns it", async () => {
      // Create a proper readable stream that ends correctly
      const { PassThrough } = require("stream");
      const mockStream = new PassThrough();
      mockStream.end(Buffer.from("file contents"));

      resolveTemplateFile.mockResolvedValue({
        tpl: { id: VALID_TEMPLATE_ID, uploadedById: "user-123" },
        s3Key: "uploads/test.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        downloadName: "test.docx",
        stat: { size: 13 },
      });

      s3.send.mockResolvedValue({
        Body: mockStream,
      });

      const response = await request(app)
        .get(`/api/templates/${VALID_TEMPLATE_ID}/download`)
        .expect(200);

      expect(resolveTemplateFile).toHaveBeenCalledWith(VALID_TEMPLATE_ID);
      expect(response.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      expect(response.headers["content-disposition"]).toContain("test.docx");
    });

    test("should return 404 when template not found", async () => {
      resolveTemplateFile.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/templates/${VALID_TEMPLATE_ID}/download`)
        .expect(404);

      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      resolveTemplateFile.mockResolvedValue({
        tpl: { id: VALID_TEMPLATE_ID, uploadedById: "other-user-456" },
        s3Key: "uploads/test.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        downloadName: "test.docx",
        stat: { size: 1234 },
      });

      const response = await request(app)
        .get(`/api/templates/${VALID_TEMPLATE_ID}/download`)
        .expect(404);

      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when file missing in storage", async () => {
      resolveTemplateFile.mockResolvedValue({
        tpl: { id: VALID_TEMPLATE_ID, uploadedById: "user-123" },
        missing: true,
      });

      const response = await request(app)
        .get(`/api/templates/${VALID_TEMPLATE_ID}/download`)
        .expect(404);

      expect(response.body.error.message).toBe("Template file missing in storage");
    });

    test("should return 400 for invalid template ID format", async () => {
      const response = await request(app)
        .get("/api/templates/invalid-id/download")
        .expect(400);

      expect(response.body.error.message).toBe("Invalid template ID format");
    });
  });

  describe("POST /api/templates/:templateId/merge", () => {
    test("should merge template when user owns it", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      mergeTemplate.mockResolvedValue({
        jobId: 101,
        filePath: "s3://test-bucket/outputs/result.pdf",
      });

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge`)
        .send({
          data: { name: "John Doe", email: "john@example.com" },
          outputType: "pdf",
        })
        .expect(200);

      expect(response.body.jobId).toBe(101);
      expect(response.body.filePath).toContain("s3://test-bucket/outputs");
      expect(mergeTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: VALID_TEMPLATE_ID,
          data: { name: "John Doe", email: "john@example.com" },
          outputType: "pdf",
          userId: "user-123",
        })
      );
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge`)
        .send({ data: { name: "John" } })
        .expect(404);

      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "other-user-456",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge`)
        .send({ data: { name: "John" } })
        .expect(404);

      expect(response.body.error.message).toBe("Template not found");
      expect(mergeTemplate).not.toHaveBeenCalled();
    });

    test("should use default outputType of docx", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      mergeTemplate.mockResolvedValue({
        jobId: 102,
        filePath: "s3://test-bucket/outputs/result.docx",
      });

      await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge`)
        .send({ data: { name: "Jane" } })
        .expect(200);

      expect(mergeTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          outputType: "docx",
        })
      );
    });

    test("should return 422 for template parse errors", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const parseError = new Error("TEMPLATE_PARSE_ERROR");
      parseError.details = [
        {
          id: "duplicate_open_tag",
          explanation: "Duplicate open tag",
        },
      ];
      mergeTemplate.mockRejectedValue(parseError);

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge`)
        .send({ data: { name: "Test" } })
        .expect(422);

      expect(response.body.error.message).toBe(
        "Template has invalid Docxtemplater tags"
      );
      expect(response.body.error.details).toBeDefined();
    });

    test("should return 400 for other errors", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      mergeTemplate.mockRejectedValue(new Error("Something went wrong"));

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge`)
        .send({ data: { name: "Test" } })
        .expect(400);

      expect(response.body.error.message).toBe("Something went wrong");
    });

    test("should return 400 for invalid template ID format", async () => {
      const response = await request(app)
        .post("/api/templates/invalid-id/merge")
        .send({ data: { name: "Test" } })
        .expect(400);

      expect(response.body.error.message).toBe("Invalid template ID format");
    });
  });

  describe("POST /api/templates/:templateId/merge-csv", () => {
    test("should merge CSV when user owns template", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      processRowsInline.mockResolvedValue([
        { rowIndex: 0, success: true, job: { jobId: 201, filePath: "s3://test-bucket/outputs/result1.pdf" } },
        { rowIndex: 1, success: true, job: { jobId: 202, filePath: "s3://test-bucket/outputs/result2.pdf" } },
      ]);

      const csvContent =
        "name,email\nJohn,john@example.com\nJane,jane@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(2);
      expect(processRowsInline).toHaveBeenCalledTimes(1);
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(404);

      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "other-user-456",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(404);

      expect(response.body.error.message).toBe("Template not found");
      expect(mergeTemplate).not.toHaveBeenCalled();
    });

    test("should return 400 with invalid outputType", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "invalid")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(400);

      expect(response.body.error.message).toContain("Invalid outputType");
    });

    test("should return 400 when CSV file is not uploaded", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .expect(400);

      expect(response.body.error.message).toContain("No CSV file uploaded");
    });

    test("should return 400 with invalid CSV format", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const invalidCsv = 'name,email\ninvalid csv content "unclosed quote';

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(invalidCsv), "data.csv")
        .expect(400);

      expect(response.body.error.message).toContain("Invalid CSV format");
    });

    test("should return 400 when CSV has no data rows", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const csvContent = "name,email\n";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(400);

      expect(response.body.error.message).toContain("No data rows found");
    });

    test("should return 422 for template parse errors", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      processRowsInline.mockResolvedValue([
        { rowIndex: 0, success: false, error: "TEMPLATE_PARSE_ERROR" },
      ]);

      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(422);

      expect(response.body.error.message).toBe(
        "Template has invalid Docxtemplater tags"
      );
    });

    test("should return 400 for invalid template ID format", async () => {
      const csvContent = "name,email\nJohn,john@example.com";

      const response = await request(app)
        .post("/api/templates/invalid-id/merge-csv")
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(400);

      expect(response.body.error.message).toBe("Invalid template ID format");
    });

    test("should handle CSV with BOM character", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      processRowsInline.mockResolvedValue([
        { rowIndex: 0, success: true, job: { jobId: 301 } },
      ]);

      const csvContent = "\uFEFFname,email\nJohn,john@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(200);

      expect(response.body.count).toBe(1);
    });

    test("should return 400 for empty CSV", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from("   "), "data.csv")
        .expect(400);

      expect(response.body.error.message).toContain("empty");
    });

    test("should return 413 for CSV with more than 1000 rows", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const header = "name\n";
      const rows = Array(1001).fill("John\n").join("");
      const csvContent = header + rows;

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(413);

      expect(response.body.error.message).toContain("Too many rows");
    });

    test("should queue batch job for large CSV when not inline", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      shouldProcessInline.mockReturnValue(false);
      const { createBatchJob } = require("../../src/services/batchJob.service");
      createBatchJob.mockResolvedValue({ id: "batch-123" });

      const csvContent = "name\nJohn\nJane";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(202);

      expect(response.body.batchJobId).toBe("batch-123");
      expect(response.body.totalRows).toBe(2);
      expect(response.body.statusUrl).toBe("/api/batch-jobs/batch-123");
    });

    test("should return partial success with errors for failed rows", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        uploadedById: "user-123",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      processRowsInline.mockResolvedValue([
        { rowIndex: 0, success: true, job: { jobId: 401 } },
        { rowIndex: 1, success: false, error: "Missing field: name" },
      ]);

      const csvContent = "name,email\nJohn,john@example.com\n,missing@example.com";

      const response = await request(app)
        .post(`/api/templates/${VALID_TEMPLATE_ID}/merge-csv`)
        .field("outputType", "pdf")
        .attach("csv", Buffer.from(csvContent), "data.csv")
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].rowIndex).toBe(1);
    });
  });

  describe("POST /api/webhooks/templates/:templateId", () => {
    test("should process webhook with valid HMAC and JSON", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      mergeTemplate.mockResolvedValue({
        jobId: 301,
        filePath: "s3://test-bucket/outputs/result.pdf",
      });

      const body = JSON.stringify({ name: "John", email: "john@example.com" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}?outputType=pdf`)
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.count).toBe(1);
      expect(response.body.jobs).toHaveLength(1);
      expect(mergeTemplate).toHaveBeenCalledWith({
        templateId: VALID_TEMPLATE_ID,
        data: { name: "John", email: "john@example.com" },
        outputType: "pdf",
        userId: null,
        fromWebhook: true,
      });
    });

    test("should process webhook with valid HMAC and CSV", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

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
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}?outputType=pdf`)
        .set("Content-Type", "text/csv")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(response.body.jobs).toHaveLength(2);
      expect(mergeTemplate).toHaveBeenCalledTimes(2);
    });

    test("should process JSON array", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

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
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(mergeTemplate).toHaveBeenCalledTimes(2);
    });

    test("should return 401 without x-signature", async () => {
      const body = JSON.stringify({ name: "John" });

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .send(body)
        .expect(401);

      expect(response.body.error.message).toBe("Unauthorized");
    });

    test("should return 401 with invalid signature", async () => {
      const body = JSON.stringify({ name: "John" });

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .set("x-signature", "invalid-signature")
        .send(body)
        .expect(401);

      expect(response.body.error.message).toBe("Unauthorized");
    });

    test("should return error for unsupported content type", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const body = "plain text";
      const signature = generateHMAC(body);

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "text/plain")
        .set("x-signature", signature)
        .send(body);

      // Route returns 400 or 415 depending on how content type is handled
      expect([400, 415]).toContain(response.status);
    });

    test("should return 400 for invalid JSON", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const body = "invalid JSON {";
      const signature = generateHMAC(body);

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(400);

      expect(response.body.error.message).toBe("Invalid payload");
    });

    test("should return 413 for too many rows", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
      const body = JSON.stringify(rows);
      const signature = generateHMAC(body);

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(413);

      expect(response.body.error.message).toBe("Too many rows");
    });

    test("should return warnings when merge produces warnings", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      mergeTemplate.mockResolvedValue({
        jobId: 501,
        filePath: "s3://output",
        warnings: ["Field 'extra' not in template"],
      });
      const body = JSON.stringify({ name: "John", extra: "data" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(200);

      expect(response.body.warnings).toBeDefined();
      expect(response.body.warnings).toHaveLength(1);
      expect(response.body.warnings[0].row).toBe(1);
    });

    test("should return 422 for template parse errors", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: VALID_TEMPLATE_ID,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const parseError = new Error("TEMPLATE_PARSE_ERROR");
      parseError.details = [{ id: "error" }];
      mergeTemplate.mockRejectedValue(parseError);

      const body = JSON.stringify({ name: "John" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post(`/api/webhooks/templates/${VALID_TEMPLATE_ID}`)
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(422);

      expect(response.body.error.message).toBe(
        "Template has invalid Docxtemplater tags"
      );
    });

    test("should return 400 for invalid template ID format", async () => {
      const body = JSON.stringify({ name: "John" });
      const signature = generateHMAC(body);

      const response = await request(app)
        .post("/api/webhooks/templates/invalid-id")
        .set("Content-Type", "application/json")
        .set("x-signature", signature)
        .send(body)
        .expect(400);

      expect(response.body.error.message).toBe("Invalid template ID format");
    });
  });

  describe("GET /api/download/:filePath", () => {
    test("should download merge output when user owns the job", async () => {
      const mockStream = Readable.from([Buffer.from("pdf contents")]);

      prisma.mergeJob.findFirst.mockResolvedValue({
        id: "job-123",
        filePath: "s3://test-bucket/outputs/result.pdf",
        userId: "user-123",
      });

      s3.send.mockResolvedValue({
        Body: mockStream,
      });

      const response = await request(app)
        .get("/api/download/outputs/result.pdf")
        .expect(200);

      expect(response.headers["content-type"]).toBe("application/pdf");
      // Authorization uses exact match with full S3 URI to prevent path injection attacks
      expect(prisma.mergeJob.findFirst).toHaveBeenCalledWith({
        where: {
          filePath: "s3://test-bucket/outputs/result.pdf",
          userId: "user-123",
        },
      });
    });

    test("should return 404 when user does not own the job (tenant isolation)", async () => {
      prisma.mergeJob.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .get("/api/download/outputs/other-user-file.pdf")
        .expect(404);

      expect(response.body.error.message).toBe("File not found");
    });

    test("should return error when file path is empty", async () => {
      // Route returns 400 for missing/empty file path
      const response = await request(app).get("/api/download/");
      expect([400, 404]).toContain(response.status);
    });

    test("should set correct content-type for HTML files", async () => {
      const mockStream = Readable.from([Buffer.from("<html></html>")]);

      prisma.mergeJob.findFirst.mockResolvedValue({
        id: "job-123",
        filePath: "s3://test-bucket/outputs/result.html",
        userId: "user-123",
      });

      s3.send.mockResolvedValue({
        Body: mockStream,
        ContentLength: 13,
      });

      const response = await request(app)
        .get("/api/download/outputs/result.html")
        .expect(200);

      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["content-security-policy"]).toBeDefined();
    });

    test("should set correct content-type for DOCX files", async () => {
      const mockStream = Readable.from([Buffer.from("docx contents")]);

      prisma.mergeJob.findFirst.mockResolvedValue({
        id: "job-123",
        filePath: "s3://test-bucket/outputs/result.docx",
        userId: "user-123",
      });

      s3.send.mockResolvedValue({
        Body: mockStream,
      });

      const response = await request(app)
        .get("/api/download/outputs/result.docx")
        .expect(200);

      expect(response.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    });

    test("should return 404 when S3 file not found", async () => {
      prisma.mergeJob.findFirst.mockResolvedValue({
        id: "job-123",
        filePath: "s3://test-bucket/outputs/missing.pdf",
        userId: "user-123",
      });

      const noSuchKeyErr = new Error("NoSuchKey");
      noSuchKeyErr.name = "NoSuchKey";
      s3.send.mockRejectedValue(noSuchKeyErr);

      const response = await request(app)
        .get("/api/download/outputs/missing.pdf")
        .expect(404);

      expect(response.body.error.message).toBe("File not found");
    });
  });

  describe("GET /api/jobs", () => {
    test("should return list of merge jobs for authenticated user", async () => {
      const mockJobs = [
        {
          id: 1,
          templateId: VALID_TEMPLATE_ID,
          outputType: "pdf",
          status: "succeeded",
          filePath: "s3://test-bucket/outputs/result.pdf",
          createdAt: "2024-01-01T00:00:00.000Z",
          template: { id: VALID_TEMPLATE_ID, displayName: "Test Template", mimeType: "text/html" },
        },
      ];

      prisma.mergeJob.findMany.mockResolvedValue(mockJobs);

      const response = await request(app)
        .get("/api/jobs")
        .expect(200);

      expect(response.body).toEqual(mockJobs);
      expect(prisma.mergeJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-123" },
        })
      );
    });

    test("should return 500 on database error", async () => {
      prisma.mergeJob.findMany.mockRejectedValue(new Error("DB error"));

      const response = await request(app)
        .get("/api/jobs")
        .expect(500);

      expect(response.body.error.message).toBe("Failed to load merge jobs");
    });
  });

  describe("DELETE /api/jobs/:id", () => {
    test("should delete job and S3 file when user owns it", async () => {
      prisma.mergeJob.findUnique.mockResolvedValue({
        id: 1,
        userId: "user-123",
        filePath: "s3://test-bucket/outputs/result.pdf",
      });
      prisma.mergeJob.delete.mockResolvedValue({});
      s3.send.mockResolvedValue({});

      const response = await request(app)
        .delete("/api/jobs/1")
        .expect(204);

      expect(prisma.mergeJob.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    test("should return 404 when job not found", async () => {
      prisma.mergeJob.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .delete("/api/jobs/1")
        .expect(404);

      expect(response.body.error.message).toBe("Job not found");
    });

    test("should return 403 when job belongs to different user", async () => {
      prisma.mergeJob.findUnique.mockResolvedValue({
        id: 1,
        userId: "other-user",
        filePath: "s3://test-bucket/outputs/result.pdf",
      });

      const response = await request(app)
        .delete("/api/jobs/1")
        .expect(403);

      expect(response.body.error.message).toBe("Forbidden - not your job");
    });

    test("should still delete DB record if S3 delete fails", async () => {
      prisma.mergeJob.findUnique.mockResolvedValue({
        id: 1,
        userId: "user-123",
        filePath: "s3://test-bucket/outputs/result.pdf",
      });
      prisma.mergeJob.delete.mockResolvedValue({});
      s3.send.mockRejectedValue(new Error("S3 error"));

      const response = await request(app)
        .delete("/api/jobs/1")
        .expect(204);

      expect(prisma.mergeJob.delete).toHaveBeenCalled();
    });
  });

  describe("GET /api/batch-jobs", () => {
    test("should return list of batch jobs for authenticated user", async () => {
      const mockBatchJobs = [
        { id: "batch-1", status: "completed", totalRows: 5 },
      ];
      listBatchJobs.mockResolvedValue(mockBatchJobs);

      const response = await request(app)
        .get("/api/batch-jobs")
        .expect(200);

      expect(response.body).toEqual(mockBatchJobs);
      expect(listBatchJobs).toHaveBeenCalledWith("user-123", expect.any(Object));
    });

    test("should return 500 on error", async () => {
      listBatchJobs.mockRejectedValue(new Error("DB error"));

      const response = await request(app)
        .get("/api/batch-jobs")
        .expect(500);

      expect(response.body.error.message).toBe("Failed to list batch jobs");
    });
  });

  describe("GET /api/batch-jobs/:id", () => {
    test("should return batch job status when user owns it", async () => {
      const mockStatus = { id: "batch-1", status: "completed", totalRows: 5, processedRows: 5 };
      getBatchJobStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get("/api/batch-jobs/batch-1")
        .expect(200);

      expect(response.body).toEqual(mockStatus);
      expect(getBatchJobStatus).toHaveBeenCalledWith("batch-1", "user-123");
    });

    test("should return 404 when batch job not found", async () => {
      getBatchJobStatus.mockResolvedValue(null);

      const response = await request(app)
        .get("/api/batch-jobs/batch-1")
        .expect(404);

      expect(response.body.error.message).toBe("Batch job not found");
    });

    test("should return 500 on error", async () => {
      getBatchJobStatus.mockRejectedValue(new Error("DB error"));

      const response = await request(app)
        .get("/api/batch-jobs/batch-1")
        .expect(500);

      expect(response.body.error.message).toBe("Failed to get batch job status");
    });
  });
});
