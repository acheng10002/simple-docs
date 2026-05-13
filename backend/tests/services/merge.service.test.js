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
      // Generic fallback for PDF, XLSX, PPTX templates
      if (key.includes(".pdf") || key.includes(".xlsx") || key.includes(".pptx")) {
        return Promise.resolve({ Body: Readable.from([Buffer.from("FAKE_TEMPLATE")]) });
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

  describe("PDF template merges", () => {
    const pdfTemplate = {
      id: "tpl-pdf-1",
      storageKey: "9999-form.pdf",
      displayName: "Form.pdf",
      mimeType: "application/pdf",
      outputNameFormat: "name",
      fields: [{ name: "name" }],
    };

    beforeEach(() => {
      // Mock PDF template bytes from S3
      const pdfService = require("../../src/services/pdfService");
      pdfService.isFormBasedPdf = jest.fn().mockResolvedValue(true);
      pdfService.fillPdfForm = jest.fn().mockResolvedValue(Buffer.from("FILLED_PDF"));
      pdfService.fillPdfTextPlaceholders = jest.fn().mockResolvedValue(Buffer.from("TEXT_PDF"));

      s3.send.mockImplementation((cmd) => {
        if (cmd instanceof GetObjectCommand) {
          return Promise.resolve({ Body: Readable.from([Buffer.from("PDF_BYTES")]) });
        }
        if (cmd instanceof PutObjectCommand) {
          return Promise.resolve({ ETag: '"deadbeef"' });
        }
        return Promise.reject(new Error("Unhandled"));
      });
    });

    test("PDF form merge -> PDF output", async () => {
      const pdfService = require("../../src/services/pdfService");
      prisma.template.findUnique.mockResolvedValue(pdfTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 501 });

      const result = await mergeTemplate({
        templateId: "tpl-pdf-1",
        data: { name: "Test" },
        outputType: "pdf",
      });

      expect(result.jobId).toBe(501);
      expect(pdfService.isFormBasedPdf).toHaveBeenCalled();
      expect(pdfService.fillPdfForm).toHaveBeenCalled();
    });

    test("PDF merge -> JPG conversion", async () => {
      const pdfService = require("../../src/services/pdfService");
      const conversionService = require("../../src/services/conversionService");
      prisma.template.findUnique.mockResolvedValue(pdfTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 502 });

      const result = await mergeTemplate({
        templateId: "tpl-pdf-1",
        data: { name: "Test" },
        outputType: "jpg",
      });

      expect(result.jobId).toBe(502);
      expect(result.filePath).toMatch(/\.jpg$/);
      expect(conversionService.convertPdfToJpg).toHaveBeenCalled();
    });
  });

  describe("XLSX template merges", () => {
    const xlsxTemplate = {
      id: "tpl-xlsx-1",
      storageKey: "9999-sheet.xlsx",
      displayName: "Sheet.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      outputNameFormat: "name",
      fields: [{ name: "name" }],
    };

    test("XLSX merge -> XLSX output", async () => {
      const xlsxService = require("../../src/services/xlsxService");
      prisma.template.findUnique.mockResolvedValue(xlsxTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 601 });

      const result = await mergeTemplate({
        templateId: "tpl-xlsx-1",
        data: { name: "Test" },
        outputType: "xlsx",
      });

      expect(result.jobId).toBe(601);
      expect(result.filePath).toMatch(/\.xlsx$/);
      expect(xlsxService.fillXlsxTemplate).toHaveBeenCalled();
    });
  });

  describe("PPTX template merges", () => {
    const pptxTemplate = {
      id: "tpl-pptx-1",
      storageKey: "9999-slides.pptx",
      displayName: "Slides.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      outputNameFormat: "name",
      fields: [{ name: "name" }],
    };

    test("PPTX merge -> PPTX output", async () => {
      const pptxService = require("../../src/services/pptxService");
      prisma.template.findUnique.mockResolvedValue(pptxTemplate);
      prisma.mergeJob.create.mockResolvedValue({ id: 701 });

      const result = await mergeTemplate({
        templateId: "tpl-pptx-1",
        data: { name: "Test" },
        outputType: "pptx",
      });

      expect(result.jobId).toBe(701);
      expect(result.filePath).toMatch(/\.pptx$/);
      expect(pptxService.fillPptxTemplate).toHaveBeenCalled();
    });
  });

  describe("Additional validation", () => {
    test("throws 422 for empty field values", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-empty",
        storageKey: "test.html",
        displayName: "Test.html",
        mimeType: "text/html",
        outputNameFormat: "title",
        fields: [{ name: "title" }],
      });

      await expect(
        mergeTemplate({
          templateId: "tpl-empty",
          data: { title: "" },
          outputType: "html",
        })
      ).rejects.toMatchObject({ status: 422 });
    });

    test("throws error when outputNameFormat is not configured", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-no-format",
        storageKey: "test.html",
        displayName: "Test.html",
        mimeType: "text/html",
        outputNameFormat: null,
        fields: [{ name: "title" }],
      });
      prisma.mergeJob.create.mockResolvedValue({ id: 801 });

      await expect(
        mergeTemplate({
          templateId: "tpl-no-format",
          data: { title: "Hello" },
          outputType: "html",
        })
      ).rejects.toThrow("outputNameFormat is not configured");
    });

    test("throws error for unsupported template format", async () => {
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-bad",
        storageKey: "test.xyz",
        displayName: "Test.xyz",
        mimeType: "application/x-unknown",
        outputNameFormat: "name",
        fields: [{ name: "name" }],
      });

      await expect(
        mergeTemplate({
          templateId: "tpl-bad",
          data: { name: "Test" },
          outputType: "pdf",
        })
      ).rejects.toThrow(/not supported/);
    });
  });

  describe("DOCX -> JPG conversion", () => {
    test("should convert DOCX to JPG via HTML intermediate", async () => {
      const conversionService = require("../../src/services/conversionService");
      prisma.template.findUnique.mockResolvedValue({
        id: "tpl-docx-jpg",
        storageKey: "1111-form.docx",
        displayName: "Form.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        outputNameFormat: "name",
        fields: [{ name: "name" }],
      });
      prisma.mergeJob.create.mockResolvedValue({ id: 901 });

      const result = await mergeTemplate({
        templateId: "tpl-docx-jpg",
        data: { name: "Test" },
        outputType: "jpg",
      });

      expect(result.jobId).toBe(901);
      expect(result.filePath).toMatch(/\.jpg$/);
      expect(conversionService.convertDocxToJpg).toHaveBeenCalled();
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

  describe("Test mode", () => {
    const htmlTemplate = {
      id: "tpl-test-mode",
      storageKey: "9999-sample.html",
      displayName: "Sample Template.html",
      mimeType: "text/html",
      outputNameFormat: "title",
      fields: [{ name: "title" }],
    };

    test("returns buffer directly without uploading to S3", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);

      const result = await mergeTemplate({
        templateId: "tpl-test-mode",
        data: { title: "Hello" },
        outputType: "html",
        testMode: true,
      });

      expect(result.testMode).toBe(true);
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toMatch(/\.html$/);
      expect(result.contentType).toBe("text/html");

      // Should NOT have created a merge job or uploaded to S3
      expect(prisma.mergeJob.create).not.toHaveBeenCalled();
      const putCall = s3.send.mock.calls.find(
        ([cmd]) => cmd instanceof PutObjectCommand
      );
      expect(putCall).toBeUndefined();
    });

    test("adds TEST footer to HTML output", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);

      const result = await mergeTemplate({
        templateId: "tpl-test-mode",
        data: { title: "Hello" },
        outputType: "html",
        testMode: true,
      });

      const html = result.buffer.toString("utf-8");
      expect(html).toContain("TEST - NOT FOR PRODUCTION");
    });

    test("adds TEST footer before </body> tag in HTML", async () => {
      prisma.template.findUnique.mockResolvedValue(htmlTemplate);

      const result = await mergeTemplate({
        templateId: "tpl-test-mode",
        data: { title: "Hello" },
        outputType: "html",
        testMode: true,
      });

      const html = result.buffer.toString("utf-8");
      // Footer should be inserted before </body>
      const footerIdx = html.indexOf("TEST - NOT FOR PRODUCTION");
      const bodyIdx = html.indexOf("</body>");
      expect(footerIdx).toBeGreaterThan(-1);
      expect(bodyIdx).toBeGreaterThan(footerIdx);
    });
  });
});
