/**
 * Unit tests for merge.service.js
 * Tests: mergeTemplate orchestration for HTML and DOCX templates
 */

// Mock prisma
jest.mock("../../src/config/prisma");
const prisma = require("../../src/config/prisma");

// Mock S3 storage client
jest.mock("../../src/storage/supabase-storage");
const {
  s3,
  PutObjectCommand,
  GetObjectCommand,
} = require("../../src/storage/supabase-storage");

const { Readable } = require("stream");

// Mock format services
jest.mock("../../src/services/docxService", () => ({
  fillDocxTemplate: jest.fn(() => Buffer.from("MERGED_DOCX")),
  convertDocxToPdf: jest.fn(() => Buffer.from("PDF_FROM_DOCX")),
  convertDocxToHtml: jest.fn(() => Buffer.from("<html>converted</html>")),
}));

jest.mock("../../src/services/htmlService", () => ({
  fillHtmlTemplate: jest.fn((buf, data) => {
    // Simple mock that replaces {{title}} with actual value
    const html = buf.toString("utf-8").replace(/\{\{title\}\}/g, data.title || "");
    return Buffer.from(html, "utf-8");
  }),
  sanitizeHtml: jest.fn((buf) => {
    // Mock sanitization - remove script tags
    const html = buf.toString("utf-8").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    return Buffer.from(html, "utf-8");
  }),
  convertHtmlToPdf: jest.fn(() => Buffer.from("PDF_FROM_HTML")),
  convertHtmlToDocx: jest.fn(() => Buffer.from("DOCX_FROM_HTML")),
}));

jest.mock("../../src/services/pdfService", () => ({
  fillPdfForm: jest.fn(() => Buffer.from("FILLED_PDF")),
}));

jest.mock("../../src/services/xlsxService", () => ({
  fillXlsxTemplate: jest.fn(() => Buffer.from("FILLED_XLSX")),
}));

jest.mock("../../src/services/pptxService", () => ({
  fillPptxTemplate: jest.fn(() => Buffer.from("FILLED_PPTX")),
}));

jest.mock("../../src/services/conversionService", () => ({
  convertDocxToJpg: jest.fn(() => Buffer.from("JPG_IMAGE")),
  convertPdfToJpg: jest.fn(() => Buffer.from("JPG_IMAGE")),
}));

// Mock logger to suppress output during tests
jest.mock("../../src/config/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const docxService = require("../../src/services/docxService");
const htmlService = require("../../src/services/htmlService");

const { mergeTemplate } = require("../../src/services/merge.service");

// Sample HTML template with unsafe content for sanitization tests
const HTML_TEMPLATE = Buffer.from(
  `<!DOCTYPE html>
<html><head><title>T</title></head>
<body>
  <script>evil()</script>
  <h1>{{title}}</h1>
  <a href="javascript:alert(1)">click</a>
  <img src="https://cdn.example.com/x.png">
</body></html>`,
  "utf8"
);

// Sample DOCX template bytes
const DOCX_TEMPLATE = Buffer.from("FAKE_DOCX_CONTENT");

beforeEach(() => {
  jest.clearAllMocks();
  process.env.S3_BUCKET = "unit-test-bucket";

  // Default S3 mock implementation
  s3.send.mockImplementation((cmd) => {
    if (cmd instanceof GetObjectCommand) {
      const key = cmd.input?.Key || "";
      // Serve template bodies for GetObject
      if (key.includes(".html")) {
        return Promise.resolve({ Body: Readable.from([HTML_TEMPLATE]) });
      }
      if (key.includes(".docx")) {
        return Promise.resolve({ Body: Readable.from([DOCX_TEMPLATE]) });
      }
      const err = new Error(`No mock for S3 GetObjectKey: ${key}`);
      err.$metadata = { httpStatusCode: 404 };
      return Promise.reject(err);
    }

    if (cmd instanceof PutObjectCommand) {
      return Promise.resolve({ ETag: '"deadbeef"' });
    }

    return Promise.reject(
      new Error(`Unhandled S3 command: ${cmd?.constructor?.name}`)
    );
  });

  // Default: no duplicate filenames
  prisma.mergeJob.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.S3_BUCKET;
});

describe("merge.service", () => {
  describe("HTML template merges", () => {
    const htmlTemplate = {
      id: "tpl-html-1",
      storageKey: "9999-sample.html",
      displayName: "Sample Template.html",
      mimeType: "text/html",
      outputNameFormat: "title",
      fields: [{ name: "title" }],
    };

    test("HTML merge -> HTML output with sanitization (webhook path)", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 101 });

      const result = await mergeTemplate({
        templateId: "tpl-html-1",
        data: { title: "Hello" },
        outputType: "html",
        userId: null,
        fromWebhook: true, // Triggers sanitization
      });

      expect(result.jobId).toBe(101);
      expect(result.filePath).toMatch(/^s3:\/\/unit-test-bucket\/outputs\/.+\.html$/);

      // Verify sanitization was called
      expect(htmlService.sanitizeHtml).toHaveBeenCalled();

      // Verify merge job was created
      expect(prisma.mergeJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateId: "tpl-html-1",
            outputType: "html",
            status: "succeeded",
          }),
        })
      );
    });

    test("HTML merge -> HTML without sanitization (manual path)", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 102 });

      const result = await mergeTemplate({
        templateId: "tpl-html-1",
        data: { title: "Hello" },
        outputType: "html",
        fromWebhook: false, // No sanitization
      });

      expect(result.jobId).toBe(102);
      // Sanitization should NOT be called
      expect(htmlService.sanitizeHtml).not.toHaveBeenCalled();
    });

    test("HTML merge -> PDF via Puppeteer", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 103 });

      const result = await mergeTemplate({
        templateId: "tpl-html-1",
        data: { title: "Report" },
        outputType: "pdf",
        userId: "u1",
        fromWebhook: false,
      });

      expect(result.jobId).toBe(103);
      expect(result.filePath).toMatch(/\.pdf$/);
      expect(htmlService.convertHtmlToPdf).toHaveBeenCalled();
    });

    test("HTML merge -> DOCX conversion", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 104 });

      const result = await mergeTemplate({
        templateId: "tpl-html-1",
        data: { title: "Document" },
        outputType: "docx",
        fromWebhook: false,
      });

      expect(result.jobId).toBe(104);
      expect(result.filePath).toMatch(/\.docx$/);
      expect(htmlService.convertHtmlToDocx).toHaveBeenCalled();
    });
  });

  describe("DOCX template merges", () => {
    const docxTemplate = {
      id: "tpl-docx-1",
      storageKey: "1111-form.docx",
      displayName: "Form Template.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      outputNameFormat: "name",
      fields: [{ name: "name" }],
    };

    test("DOCX merge -> DOCX output", async () => {
      prisma.template.findUnique.mockResolvedValue(docxTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 201 });

      const result = await mergeTemplate({
        templateId: "tpl-docx-1",
        data: { name: "Ada" },
        outputType: "docx",
        userId: "u1",
      });

      expect(result.jobId).toBe(201);
      expect(result.filePath).toMatch(/\.docx$/);
      expect(docxService.fillDocxTemplate).toHaveBeenCalledWith(
        DOCX_TEMPLATE,
        { name: "Ada" }
      );
    });

    test("DOCX merge -> PDF via LibreOffice", async () => {
      prisma.template.findUnique.mockResolvedValue(docxTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 202 });

      const result = await mergeTemplate({
        templateId: "tpl-docx-1",
        data: { name: "Bob" },
        outputType: "pdf",
        userId: "u2",
      });

      expect(result.jobId).toBe(202);
      expect(result.filePath).toMatch(/\.pdf$/);
      expect(docxService.convertDocxToPdf).toHaveBeenCalled();
    });

    test("DOCX merge -> HTML conversion", async () => {
      prisma.template.findUnique.mockResolvedValue(docxTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 203 });

      const result = await mergeTemplate({
        templateId: "tpl-docx-1",
        data: { name: "Carol" },
        outputType: "html",
      });

      expect(result.jobId).toBe(203);
      expect(result.filePath).toMatch(/\.html$/);
      expect(docxService.convertDocxToHtml).toHaveBeenCalled();
    });
  });

  describe("Validation", () => {
    test("throws 422 for missing required fields", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-1",
        storageKey: "test.docx",
        displayName: "Test.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        outputNameFormat: "name",
        fields: [{ name: "name" }, { name: "email" }],
      });

      await expect(
        mergeTemplate({
          templateId: "tpl-1",
          data: { name: "John" }, // Missing 'email'
          outputType: "docx",
        })
      ).rejects.toMatchObject({ status: 422 });
    });

    test("throws error for unsupported output type", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-2",
        storageKey: "test.html",
        displayName: "Test.html",
        mimeType: "text/html",
        outputNameFormat: "title",
        fields: [{ name: "title" }],
      });

      await expect(
        mergeTemplate({
          templateId: "tpl-2",
          data: { title: "Test" },
          outputType: "xlsx", // Not supported for HTML templates
        })
      ).rejects.toThrow(/outputType 'xlsx' not supported/);
    });

    test("throws error when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      await expect(
        mergeTemplate({
          templateId: "nonexistent",
          data: { name: "Test" },
          outputType: "docx",
        })
      ).rejects.toThrow("Template not found");
    });

    test("warns but succeeds with extra fields in data", async () => {
      const logger = require("../../src/config/logger");

      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-3",
        storageKey: "test.html",
        displayName: "Test.html",
        mimeType: "text/html",
        outputNameFormat: "title",
        fields: [{ name: "title" }],
      });
      prisma.mergeJob.create.mockResolvedValue({ id: 301 });

      const result = await mergeTemplate({
        templateId: "tpl-3",
        data: { title: "ok", extra: "ignored" },
        outputType: "html",
      });

      expect(result.jobId).toBe(301);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ extras: ["extra"] }),
        expect.any(String)
      );
    });
  });

  describe("S3 operations", () => {
    test("uploads output to S3 with correct content type", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-s3",
        storageKey: "test.html",
        displayName: "Test.html",
        mimeType: "text/html",
        outputNameFormat: "title",
        fields: [{ name: "title" }],
      });
      prisma.mergeJob.create.mockResolvedValue({ id: 401 });

      await mergeTemplate({
        templateId: "tpl-s3",
        data: { title: "Test" },
        outputType: "pdf",
      });

      // Find the PutObjectCommand call
      const putCall = s3.send.mock.calls.find(
        ([cmd]) => cmd instanceof PutObjectCommand
      );
      expect(putCall).toBeDefined();
      expect(putCall[0].input.ContentType).toBe("application/pdf");
    });
  });
});
