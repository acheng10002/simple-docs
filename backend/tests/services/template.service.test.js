/**
 * Unit tests for template.service.js
 * Tests: contentTypeFor, resolveTemplateFile, extractFieldsFromTemplate, storeTemplateAndFields
 */

// Mock prisma before requiring any modules that use it
jest.mock("../../src/config/prisma");
const prisma = require("../../src/config/prisma");

// Mock S3 storage client
jest.mock("../../src/storage/supabase-storage");
const { s3, HeadObjectCommand } = require("../../src/storage/supabase-storage");

// Mock format services for extractFieldsFromTemplate
jest.mock("../../src/services/docxService", () => ({
  extractDocxFields: jest.fn(),
}));
jest.mock("../../src/services/htmlService", () => ({
  extractHtmlFields: jest.fn(),
}));
jest.mock("../../src/services/pdfService", () => ({
  extractPdfFields: jest.fn(),
}));
jest.mock("../../src/services/xlsxService", () => ({
  extractXlsxFields: jest.fn(),
}));
jest.mock("../../src/services/pptxService", () => ({
  extractPptxFields: jest.fn(),
}));

const docxService = require("../../src/services/docxService");
const htmlService = require("../../src/services/htmlService");
const pdfService = require("../../src/services/pdfService");
const xlsxService = require("../../src/services/xlsxService");
const pptxService = require("../../src/services/pptxService");

// Import functions under test
const {
  contentTypeFor,
  resolveTemplateFile,
  extractFieldsFromTemplate,
  storeTemplateAndFields,
} = require("../../src/services/template.service");

describe("template.service", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.S3_BUCKET = "test-bucket";
  });

  afterEach(() => {
    delete process.env.S3_BUCKET;
  });

  describe("contentTypeFor", () => {
    test("returns correct MIME type for DOCX files", () => {
      expect(contentTypeFor("document.docx")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    });

    test("returns correct MIME type for HTML files", () => {
      expect(contentTypeFor("page.html")).toBe("text/html");
      expect(contentTypeFor("page.htm")).toBe("text/html");
    });

    test("returns correct MIME type for PDF files", () => {
      expect(contentTypeFor("document.pdf")).toBe("application/pdf");
    });

    test("returns correct MIME type for XLSX files", () => {
      expect(contentTypeFor("spreadsheet.xlsx")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    });

    test("returns correct MIME type for PPTX files", () => {
      expect(contentTypeFor("presentation.pptx")).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
    });

    test("returns octet-stream for unknown file types", () => {
      expect(contentTypeFor("file.unknown")).toBe("application/octet-stream");
      expect(contentTypeFor("file.txt")).toBe("application/octet-stream");
    });

    test("handles uppercase extensions", () => {
      expect(contentTypeFor("document.DOCX")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    });
  });

  describe("resolveTemplateFile", () => {
    test("returns S3 metadata when file exists", async () => {
      const tpl = {
        id: "t1",
        storageKey: "1712345678901-sample.html",
        displayName: "sample.html",
      };
      prisma.template.findUnique.mockResolvedValue(tpl);

      // HeadObject success with size
      s3.send.mockResolvedValueOnce({
        ContentLength: 123,
        ETag: '"abc123"',
        LastModified: new Date("2024-01-01"),
      });

      const info = await resolveTemplateFile("t1");

      expect(info.tpl).toBe(tpl);
      expect(info.s3Key).toBe(`uploads/${tpl.storageKey}`);
      expect(info.stat.size).toBe(123);
      expect(info.downloadName).toBe("sample.html");
      expect(info.contentType).toBe("text/html");
      expect(info.missing).toBeUndefined();
    });

    test("returns null when template not found in database", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const info = await resolveTemplateFile("nonexistent");

      expect(info).toBeNull();
    });

    test("marks missing when file not in S3", async () => {
      const tpl = {
        id: "t2",
        storageKey: "1700000000000-sample.docx",
        displayName: "sample.docx",
      };
      prisma.template.findUnique.mockResolvedValue(tpl);

      // HeadObject fails - file not found
      const err = new Error("NotFound");
      err.$metadata = { httpStatusCode: 404 };
      s3.send.mockRejectedValueOnce(err);

      const info = await resolveTemplateFile("t2");

      expect(info).toEqual({ tpl, missing: true });
    });
  });

  describe("extractFieldsFromTemplate", () => {
    test("delegates to docxService for DOCX files", async () => {
      const buffer = Buffer.from("fake docx");
      const expectedFields = ["name", "address"];
      docxService.extractDocxFields.mockResolvedValue(expectedFields);

      const fields = await extractFieldsFromTemplate(
        buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );

      expect(docxService.extractDocxFields).toHaveBeenCalledWith(buffer);
      expect(fields).toEqual(expectedFields);
    });

    test("delegates to htmlService for HTML files", async () => {
      const buffer = Buffer.from("<html>{{name}}</html>");
      const expectedFields = ["name", "email"];
      htmlService.extractHtmlFields.mockResolvedValue(expectedFields);

      const fields = await extractFieldsFromTemplate(buffer, "text/html");

      expect(htmlService.extractHtmlFields).toHaveBeenCalledWith(buffer);
      expect(fields).toEqual(expectedFields);
    });

    test("delegates to pdfService for PDF files", async () => {
      const buffer = Buffer.from("fake pdf");
      const expectedFields = ["field1", "field2"];
      pdfService.extractPdfFields.mockResolvedValue(expectedFields);

      const fields = await extractFieldsFromTemplate(buffer, "application/pdf");

      expect(pdfService.extractPdfFields).toHaveBeenCalledWith(buffer);
      expect(fields).toEqual(expectedFields);
    });

    test("delegates to xlsxService for XLSX files", async () => {
      const buffer = Buffer.from("fake xlsx");
      const expectedFields = ["column1", "column2"];
      xlsxService.extractXlsxFields.mockResolvedValue(expectedFields);

      const fields = await extractFieldsFromTemplate(
        buffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      expect(xlsxService.extractXlsxFields).toHaveBeenCalledWith(buffer);
      expect(fields).toEqual(expectedFields);
    });

    test("delegates to pptxService for PPTX files", async () => {
      const buffer = Buffer.from("fake pptx");
      const expectedFields = ["title", "subtitle"];
      pptxService.extractPptxFields.mockResolvedValue(expectedFields);

      const fields = await extractFieldsFromTemplate(
        buffer,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );

      expect(pptxService.extractPptxFields).toHaveBeenCalledWith(buffer);
      expect(fields).toEqual(expectedFields);
    });

    test("throws error for unsupported format", async () => {
      const buffer = Buffer.from("unknown");

      await expect(
        extractFieldsFromTemplate(buffer, "application/unknown")
      ).rejects.toThrow("Unsupported template format: application/unknown");
    });
  });

  describe("storeTemplateAndFields", () => {
    test("creates template with fields in database", async () => {
      const expectedResult = {
        id: "new-template-id",
        storageKey: "1234567890-invoice.docx",
        displayName: "Invoice Template.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fields: [{ name: "customer_name" }, { name: "amount" }],
      };
      prisma.template.create.mockResolvedValue(expectedResult);

      const result = await storeTemplateAndFields(
        "1234567890-invoice.docx",
        "Invoice Template.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ["customer_name", "amount"]
      );

      expect(prisma.template.create).toHaveBeenCalledWith({
        data: {
          storageKey: "1234567890-invoice.docx",
          displayName: "Invoice Template.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fields: {
            create: [{ name: "customer_name" }, { name: "amount" }],
          },
        },
        include: { fields: true },
      });
      expect(result).toEqual(expectedResult);
    });
  });
});
