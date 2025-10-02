/* *** MOCK: PRISMA WITH A MANUAL MOCK 
mocks Prisma instance for db reads/writes 
- tells Jest to replace my real Prisma client with the stub in _mocks_/prisma */
jest.mock("../prisma", () => require("../__mocks__/prisma"));
// pulls in the mocked Prisma instance (with findUnique, create, etc. as jest fns)
const prisma = require("../prisma");

/* *** MOCK: FS/PROMISES FUNCTIONS
 mocks fs' promises to read/write files 
- that way, I can control readFile, writeFile, etc. */
const fs = require("fs/promises");
jest.mock("fs/promises");

/* *** MOCK: LIBREOFFICE-CONVERT - RETURNS A CANNED PDF BUFFER
fakes LO conversion */
jest.mock("libreoffice-convert", () => ({
  // whenever convert is called, the callback gets a buffer "PDF_BUF"
  convert: jest.fn((buffer, ext, opt, cb) => cb(null, Buffer.from("PDF_BUF"))),
}));

/* *** MOCK: PUPPETEER WITH A MANUAL MOCK THAT EXPORTS...
- LAUNCH -> RSOLVES TO _BROWSERMOCK
- _BROWSERMOCK.NEWPAGE() -> _PAGEMOCK
- _PAGEMOCK.SETCONTENT() / PDF() -> CANNED VALUES */
jest.mock("puppeteer");
// gives access to _pageMock/_browserMock/_pdfBuffer
const puppeteer = require("puppeteer");

/* *** MOCK: DOCX-TEMPLATING - RENDERDOCXBUFFERORTHROW RETURNING A FIXED BUFFER, AND 
A LOCAL TEMPLATEPARSEERROR CLASS
Docx rendering (I don't want to run the real docxtemplater here) */
jest.mock("../docx-templating.js", () => ({
  // returns a fixed Buffer "MERGED_DOCX" (so I don't really render)
  renderDocxBufferOrThrow: jest.fn(() => Buffer.from("MERGED_DOCX")),
  // class is redefined to simulate templating errors from my helper module
  TemplateParseError: class TemplateParseError extends Error {
    constructor(details) {
      super("TEMPLATE_PARSE_ERROR");
      this.details = details;
    }
  },
}));

// paths and systems under test
const path = require("path");
const { OUTPUTS_DIR, UPLOADS_DIR } = require("../paths");
const { mergeTemplate } = require("../merge.service");

/* helper: fake upload buffer with a small HTML file that includes intentionally 
unsafe content 
- <script>, href="javascript..." link, a remote img URL */
const HTML_TEMPLATE = Buffer.from(
  `
<!DOCTYPE html>
<html><head><title>T</title></head>
<body>
  <script>evil()</script>
  <h1>{{title}}</h1>
  <a href="javascript:alert(1)">click</a>
  <img src="https://cdn.example.com/x.png">
</body></html>
`,
  "utf8"
);

const DOCX_TEMPLATE = Buffer.from("FAKE_DOCX_CONTENT");

describe("merge.service mergeTemplate", () => {
  // resets all mock state before every test
  beforeEach(() => {
    jest.clearAllMocks();

    // fs.mkdir OK; pretends directory creation always works
    fs.mkdir.mockResolvedValue();

    // fs.readFile returns template buffer depending on extension
    fs.readFile.mockImplementation((fpath) => {
      // returns HTML template for .html paths
      if (fpath.endsWith(".html")) return Promise.resolve(HTML_TEMPLATE);
      // returns a fake DOCX buffer for .docx
      if (fpath.endsWith(".docx"))
        return Promise.resolve(Buffer.from(DOCX_TEMPLATE));
      return Promise.reject(
        Object.assign(new Error("missing"), { code: "ENOENT" })
      );
    });

    /* fs.writeFile just resolves, but I capture what was written to assert sanitization 
    - pretend writes always succeed */
    fs.writeFile.mockResolvedValue();
  });

  // *** VERIFIES HTML -> HTML WITH SANITZATION (FROM WEBHOOK: TRUE)
  test("HTML merge -> HTML output (webhook path sanitizes)", async () => {
    // regex-escape helper
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const templateName = "9999-sample.html";
    /* db template metadata + fields 
    - Prisma returns an HTML template record and a merge job id */
    prisma.template.findUnique.mockResolvedValue({
      id: "tpl-html-1",
      name: templateName,
      fields: [{ name: "title" }],
    });
    prisma.mergeJob.create.mockResolvedValue({ id: 101 });

    // triggers sanitization
    const result = await mergeTemplate({
      templateId: "tpl-html-1",
      data: { title: "Hello" },
      outputType: "html",
      userId: null,
      // triggers sanitizeHtmlBuffer
      fromWebhook: true,
    });

    /* mirrors how the system under test builds the base (strips only the final extension) 
    - takes just the file name from a full path 
    - removes only the final extension */
    const stem = path.basename(templateName).replace(/\.[^.]+$/, "");
    /* builds a directory prefix by appending the platform specific separator 
    - wraps it in escRe(...), helper that escape regex metacharacters so the directory path
      is safe to embed in a RegExp */
    const outputsDirEsc = escRe(OUTPUTS_DIR + path.sep);

    // asserts result shape
    expect(result).toEqual({
      jobId: 101,
      // filePath must match this regex
      filePath: expect.stringMatching(
        // asserts a path that looks like <OUTPUTS_DIR>/<stem>-<digits>.html
        new RegExp(`^${outputsDirEsc}${escRe(stem)}-\\d+\\.html$`)
      ),
    });

    // asserts what got written was sanitized (script and javascript: removed)
    const writeArgs = fs.writeFile.mock.calls[0];
    const writtenBuf = writeArgs[1];
    const written = writtenBuf.toString("utf8");
    /* actual bytes written (captured from fs.writeFile) no longer contain <script> or
    javascript */
    expect(written).not.toMatch(/<script>/i);
    expect(written).not.toMatch(/javascript:/i);
    /* remote src is allowed (only warned at lint time, sanitize doesn't remove remote
    URLs) 
    - actual bytes written do keep the remote image URL */
    expect(written).toMatch(/https:\/\/cdn\.example\.com\/x\.png/);

    // merge. job created with expected fields and persisted
    expect(prisma.mergeJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateId: "tpl-html-1",
          outputType: "html",
          status: "succeeded",
          userId: null,
        }),
      })
    );
  });
  // *** VERIFIES HTML -> PDF VIA PUPPETEER
  test("HTML merge -> PDF via Puppeteer", async () => {
    // mocks a different HTML template
    prisma.template.findUnique.mockResolvedValue({
      id: "tpl-html-2",
      name: "1000-letter.html",
      fields: [{ name: "title" }],
    });
    prisma.mergeJob.create.mockResolvedValue({ id: 202 });

    const result = await mergeTemplate({
      templateId: "tpl-html-2",
      data: { title: "Report" },
      // calls with different outputType
      outputType: "pdf",
      userId: "ul",
      fromWebhook: false,
    });

    expect(result.jobId).toBe(202);
    // asserts filePath ends in .pdf...
    expect(result.filePath).toMatch(/letter-\d+\.pdf$/);
    // asserts page.setContent, page.pdf, and browser.close are called
    expect(puppeteer._pageMock.setContent).toHaveBeenCalledTimes(1);
    expect(puppeteer._pageMock.pdf).toHaveBeenCalledTimes(1);
    expect(puppeteer._browserMock.close).toHaveBeenCalledTimes(1);
  });

  test("mocks wired", async () => {
    const docx = require("../docx-templating.js");
    expect(docx.renderDocxBufferOrThrow()).toBeInstanceOf(Buffer);

    const puppeteer = require("puppeteer");
    await expect(puppeteer.launch()).resolves.toBe(puppeteer._browserMock);

    const libre = require("libreoffice-convert");
    const out = await new Promise((res) =>
      libre.convert(Buffer.from("x"), ".pdf", null, (_, b) => res(b))
    );
    expect(Buffer.isBuffer(out)).toBe(true);
  });

  // *** VERIFIES DOCX -> DOCX
  test("DOCX merge -> DOCX output", async () => {
    // mocks a DOCX template
    prisma.template.findUnique.mockResolvedValue({
      id: "tpl-docx-1",
      name: "1111-form.docx",
      fields: [{ name: "client.name" }],
    });
    prisma.mergeJob.create.mockResolvedValue({ id: 303 });

    const result = await mergeTemplate({
      templateId: "tpl-docx-1",
      data: { client: { name: "Ada" } },
      // calls with outputType: "docx"
      outputType: "docx",
      userId: "ul",
    });

    expect(result.jobId).toBe(303);
    // asserts the file path suffix
    expect(result.filePath).toMatch(/form-\d+\.docx$/);
    // fs.writeFile called with merged DOCX buffer
    const written = fs.writeFile.mock.calls[0][1];
    // asserts that the written buffer is indeed a Buffer
    expect(Buffer.isBuffer(written)).toBe(true);
  });

  // *** VERIFIES DOCX -> PDF VIA LIBREOFFICE-CONVERT
  test("DOCX merge -> PDF via LibreOffice", async () => {
    // mocks another DOCX template
    prisma.template.findUnique.mockResolvedValue({
      id: "tpl-docx-2",
      name: "2222-contract.docx",
      fields: [{ name: "name" }],
    });
    prisma.mergeJob.create.mockResolvedValue({ id: 404 });

    const result = await mergeTemplate({
      templateId: "tpl-docx-2",
      data: { name: "Norma" },
      // calls with different outputType
      outputType: "pdf",
      userId: "u2",
    });

    expect(result.jobId).toBe(404);
    // asserts filePath suffix .pdf
    expect(result.filePath).toMatch(/contract-\d+\.pdf$/);
  });

  // *** VERIFIES MISSING REQUIRED FIELDS THROW 422
  test("missing required fields throws 422", async () => {
    prisma.template.findUnique.mockResolvedValue({
      id: "tpl-docx-3",
      name: "3333-bad.docx",
      // template defines a required field
      fields: [{ name: "required.key" }],
    });

    await expect(
      mergeTemplate({
        // passes data that doesn't include it
        templateId: "tpl-docx-3",
        data: { other: "x" },
        outputType: "docx",
      })
      // expects mergeTemplate to reject
    ).rejects.toMatchObject({ status: 422 });
  });

  // *** VERIFIES EXTRA FIELDS WARN BUT DON'T BLOCK
  test("unexpected extra fields only warn (no throw)", async () => {
    prisma.template.findUnique.mockResolvedValue({
      id: "tpl-html-3",
      name: "4444-ok.html",
      // template requires title...
      fields: [{ name: "title" }],
    });
    prisma.mergeJob.create.mockResolvedValue({ id: 505 });

    await expect(
      mergeTemplate({
        templateId: "tpl-html-3",
        // but data includes an extra extra key
        data: { title: "ok", extra: "ignored" },
        outputType: "html",
      })
      // merge code warns but should still succeed
    ).resolves.toMatchObject({ jobId: 505 });
  });
});
