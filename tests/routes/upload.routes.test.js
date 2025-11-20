const request = require("supertest");
const express = require("express");
const path = require("path");

// mock prisma
jest.mock("../../prisma", () => require("../../__mocks__/prisma"));
const prisma = require("../../prisma");

// mock S3 client
jest.mock("../../s3", () => {
  return {
    s3: { send: jest.fn() },
    PutObjectCommand: class PutObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    withPrefix: (k) => k,
  };
});

const { s3, PutObjectCommand } = require("../../s3");

// mock file-type for MIME detection
jest.mock("file-type", () => ({
  fromBuffer: jest.fn(),
}));

const FileType = require("file-type");

// mock template service functions
jest.mock("../../template.service", () => ({
  extractTextFromBuffer: jest.fn(),
  extractPlaceholders: jest.fn(),
  storeTemplateAndFields: jest.fn(),
}));

const {
  extractTextFromBuffer,
  extractPlaceholders,
  storeTemplateAndFields,
} = require("../../template.service");

// mock linting functions
jest.mock("../../docx-templating", () => ({
  lintDocxBuffer: jest.fn(),
}));

jest.mock("../../html-lint", () => ({
  lintHtmlBuffer: jest.fn(),
}));

const { lintDocxBuffer } = require("../../docx-templating");
const { lintHtmlBuffer } = require("../../html-lint");

describe("Upload Routes", () => {
  let app;

  beforeAll(() => {
    process.env.S3_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // create express app
    app = express();

    // body parsers
    app.use(express.json({ limit: "10mb" }));

    // mount upload router
    const uploadRouter = require("../../templateUploadHandler");
    app.use("/api", uploadRouter);

    // default mock implementations
    FileType.fromBuffer.mockResolvedValue(null);
    extractTextFromBuffer.mockResolvedValue("Sample text with {{name}} placeholder");
    extractPlaceholders.mockReturnValue(["name"]);
    storeTemplateAndFields.mockResolvedValue({
      id: "template-123",
      fields: [{ name: "name" }],
    });
    s3.send.mockResolvedValue({ ETag: '"abc123"' });
    lintDocxBuffer.mockReturnValue([]);
    lintHtmlBuffer.mockReturnValue({ errors: [], warnings: [] });
  });

  afterAll(() => {
    delete process.env.S3_BUCKET;
  });

  describe("POST /api/upload", () => {
    test("should successfully upload a valid DOCX file", async () => {
      // mock file-type to detect DOCX
      FileType.fromBuffer.mockResolvedValue({
        ext: "docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const docxBuffer = Buffer.from("fake docx content");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", docxBuffer, "sample.docx")
        .expect(200);

      expect(response.body.templateId).toBe("template-123");
      expect(response.body.fields).toEqual(["name"]);
      expect(response.body.message).toContain("successfully uploaded");

      // verify S3 upload was called
      expect(s3.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: "test-bucket",
            ContentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        })
      );

      // verify DOCX linting was performed
      expect(lintDocxBuffer).toHaveBeenCalledWith(docxBuffer);

      // verify template was stored
      expect(storeTemplateAndFields).toHaveBeenCalled();
    });

    test("should successfully upload a valid HTML file", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      const htmlBuffer = Buffer.from("<html><body>{{title}}</body></html>");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "sample.html")
        .expect(200);

      expect(response.body.templateId).toBe("template-123");
      expect(response.body.fields).toEqual(["name"]);

      // verify HTML linting was performed
      expect(lintHtmlBuffer).toHaveBeenCalledWith(
        htmlBuffer,
        expect.objectContaining({
          allowRemote: false,
          requirePrintCss: false,
        })
      );

      // verify S3 upload
      expect(s3.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ContentType: "text/html",
          }),
        })
      );
    });

    test("should return 400 when no file is uploaded", async () => {
      const response = await request(app).post("/api/upload").expect(400);

      expect(response.text).toBe("No file uploaded");
    });

    test("should return 415 for unsupported file type", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "pdf",
        mime: "application/pdf",
      });

      const pdfBuffer = Buffer.from("fake pdf content");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", pdfBuffer, "document.pdf")
        .expect(415);

      expect(response.text).toContain("Unsupported or undetectable file type");
    });

    test("should use extension fallback for DOCX with ZIP signature", async () => {
      // file-type returns null (can't detect)
      FileType.fromBuffer.mockResolvedValue(null);

      // create buffer with ZIP magic bytes (PK\x03\x04)
      const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const docxBuffer = Buffer.concat([zipMagic, Buffer.from("fake docx")]);

      const response = await request(app)
        .post("/api/upload")
        .attach("template", docxBuffer, "sample.docx")
        .expect(200);

      expect(response.body.templateId).toBe("template-123");

      // verify it was treated as DOCX
      expect(lintDocxBuffer).toHaveBeenCalled();
    });

    test("should use extension fallback for HTML", async () => {
      FileType.fromBuffer.mockResolvedValue(null);

      const htmlBuffer = Buffer.from("<html><body>test</body></html>");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "sample.html")
        .expect(200);

      expect(response.body.templateId).toBe("template-123");

      // verify it was treated as HTML
      expect(lintHtmlBuffer).toHaveBeenCalled();
    });

    test("should reject DOCX without ZIP signature when using fallback", async () => {
      FileType.fromBuffer.mockResolvedValue(null);

      // DOCX file without proper ZIP magic bytes
      const badDocxBuffer = Buffer.from("not a real docx");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", badDocxBuffer, "sample.docx")
        .expect(415);

      expect(response.text).toContain("Unsupported or undetectable file type");
    });

    test("should return 422 when HTML has lint errors", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      lintHtmlBuffer.mockReturnValue({
        errors: [
          "Disallowed <script> tag",
          'Disallowed attr "onerror" on <img>',
        ],
        warnings: [],
      });

      const htmlBuffer = Buffer.from(
        '<html><body><script>alert(1)</script></body></html>'
      );

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "malicious.html")
        .expect(422);

      expect(response.body.error).toBe("Template blocked by HTML linter");
      expect(response.body.details).toHaveLength(2);
      expect(response.body.details).toContain("Disallowed <script> tag");
    });

    test("should log warnings but continue when HTML has lint warnings", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      lintHtmlBuffer.mockReturnValue({
        errors: [],
        warnings: ['Remote ref: src="https://cdn.example.com/image.png"'],
      });

      const htmlBuffer = Buffer.from(
        '<html><body><img src="https://cdn.example.com/image.png"></body></html>'
      );

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "remote.html")
        .expect(200);

      expect(response.body.templateId).toBe("template-123");
    });

    test("should return 422 when DOCX has lint errors", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      lintDocxBuffer.mockReturnValue([
        {
          id: "duplicate_open_tag",
          explanation: "Duplicate open tag",
          xtag: "{{ name",
          file: "word/document.xml",
          offset: 42,
        },
      ]);

      const docxBuffer = Buffer.from("fake docx with bad tags");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", docxBuffer, "bad-template.docx")
        .expect(422);

      expect(response.body.error).toBe(
        "Template has invalid Docxtemplater delimiters/tags"
      );
      expect(response.body.details).toHaveLength(1);
      expect(response.body.details[0].id).toBe("duplicate_open_tag");
    });

    test("should sanitize filename and add timestamp", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      const htmlBuffer = Buffer.from("<html><body>test</body></html>");

      // filename with special characters and path traversal attempt
      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "../../../evil file (1).html")
        .expect(200);

      // verify S3 key is sanitized
      const s3Call = s3.send.mock.calls[0][0];
      const s3Key = s3Call.input.Key;

      // should not contain path traversal
      expect(s3Key).not.toContain("..");
      expect(s3Key).not.toContain("/");

      // should be sanitized and timestamped
      expect(s3Key).toMatch(/uploads\/\d+-evil_file_\(1\)\.html/);
    });

    test("should extract placeholders from uploaded template", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      extractTextFromBuffer.mockResolvedValue(
        "Hello {{name}}, your {{product}} is ready"
      );
      extractPlaceholders.mockReturnValue(["name", "product"]);
      storeTemplateAndFields.mockResolvedValue({
        id: "template-456",
        fields: [{ name: "name" }, { name: "product" }],
      });

      const htmlBuffer = Buffer.from("<html><body>{{name}} {{product}}</body></html>");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "template.html")
        .expect(200);

      expect(response.body.fields).toEqual(["name", "product"]);
      expect(extractTextFromBuffer).toHaveBeenCalledWith(htmlBuffer, "text/html");
      expect(extractPlaceholders).toHaveBeenCalledWith(
        "Hello {{name}}, your {{product}} is ready"
      );
    });

    test("should handle declared MIME type mismatch", async () => {
      // client declares text/plain but file is actually HTML
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      const htmlBuffer = Buffer.from("<html><body>test</body></html>");

      const response = await request(app)
        .post("/api/upload")
        .field("mimetype", "text/plain")
        .attach("template", htmlBuffer, "sample.html")
        .expect(200);

      // should use detected MIME, not declared
      expect(response.body.templateId).toBe("template-123");
      expect(lintHtmlBuffer).toHaveBeenCalled();
    });

    test("should return 500 for unexpected server errors", async () => {
      FileType.fromBuffer.mockResolvedValue({
        ext: "html",
        mime: "text/html",
      });

      // simulate S3 upload failure
      s3.send.mockRejectedValue(new Error("S3 connection failed"));

      const htmlBuffer = Buffer.from("<html><body>test</body></html>");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "sample.html")
        .expect(500);

      expect(response.text).toBe("Internal Server Error");
    });

    test("should handle .htm extension as HTML", async () => {
      FileType.fromBuffer.mockResolvedValue(null);

      const htmlBuffer = Buffer.from("<html><body>test</body></html>");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", htmlBuffer, "sample.htm")
        .expect(200);

      expect(response.body.templateId).toBe("template-123");
      expect(lintHtmlBuffer).toHaveBeenCalled();
    });

    test("should reject file with unknown extension and no magic bytes", async () => {
      FileType.fromBuffer.mockResolvedValue(null);

      const buffer = Buffer.from("unknown content");

      const response = await request(app)
        .post("/api/upload")
        .attach("template", buffer, "sample.txt")
        .expect(415);

      expect(response.text).toContain("Unsupported or undetectable file type");
    });
  });
});
