/* MOCK: PRISMA WITH A MANUAL MOCK 
- tells Jest to replace my real Prisma client with the stub in _mocks_/prisma */
jest.mock("../../prisma", () => require("../../__mocks__/prisma"));
// pulls in the mocked Prisma instance (with findUnique, create, etc. as jest fns)
const prisma = require("../../prisma");

// mocks S3 client so I can inspect calls and provide canned responses
jest.mock("../../s3", () => {
  return {
    s3: { send: jest.fn() },
    /* PutObjectCommand - uploads bytes to a key, creates or overwrites an object at s3:/<Bucket>/<Key> 
    - uploads outputs */
    PutObjectCommand: class PutObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    /* GetObjectCommand - reads/streams an object, fetches the object bytes (the body) 
    - in Node, the body is a Readable stream 
    - reads template bytes to merge */
    GetObjectCommand: class GetObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    /* HeadObjectCommand - checks existence & gets metadata (no body)
    - lighweight way to probe if an object exits and fetches metadata without downloading it 
    - verifies original templates exist */
    HeadObjectCommand: class HeadObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    withPrefix: (k) => k,
  };
});

const {
  s3,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require("../../s3");
const { Readable } = require("stream");

/* s3.send.mock.calls - Jest's recorded call history for the mocked s3.send function 
                          it's an array of arg list arrays, each arg list for one function call
.find(([c]) => c instanceof Cmd) - scans the call history and returns the first call whose
                                    first arg (c) is an instance of the provided command class,
                                    PutObjectCommand */
const findS3 = (Cmd) => s3.send.mock.calls.find(([c]) => c instanceof Cmd)?.[0];

/* [...s3.send.mock.calls] - clones the calls array
.reverse()) - looks from the most recent to oldest 
.find(([c]) => c instanceof Cmd)?.[0] - returns the most recent matching command instance */
const lastS3 = (Cmd) =>
  [...s3.send.mock.calls].reverse().find(([c]) => c instanceof Cmd)?.[0];

/* MOCK: LIBREOFFICE-CONVERT - RETURNS A CANNED PDF BUFFER
fakes LO conversion */
jest.mock("libreoffice-convert", () => ({
  // whenever convert is called, the callback gets a buffer "PDF_BUF"
  convert: jest.fn((buffer, ext, opt, cb) => cb(null, Buffer.from("PDF_BUF"))),
}));

/* MOCK: PUPPETEER WITH A MANUAL MOCK THAT EXPORTS...
- LAUNCH -> RESOLVES TO _BROWSERMOCK
- _BROWSERMOCK.NEWPAGE() -> _PAGEMOCK
- _PAGEMOCK.SETCONTENT() / PDF() -> CANNED VALUES */
jest.mock("puppeteer");
// gives access to _pageMock/_browserMock/_pdfBuffer
const puppeteer = require("puppeteer");

/* MOCK: DOCX-TEMPLATING - RENDERDOCXBUFFERORTHROW RETURNING A FIXED BUFFER, AND 
A LOCAL TEMPLATEPARSEERROR CLASS */
jest.mock("../../docx-templating.js", () => ({
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

const { mergeTemplate } = require("../../merge.service");

/* helper: fake upload buffer with a small HTML file that includes intentionally 
unsafe content 
- <script>, href="javascript..." link, a remote img URL */
const HTML_TEMPLATE = Buffer.from(
  `<!DOCTYPE html>
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

// fixture: pretend DOCX bytes
const DOCX_TEMPLATE = Buffer.from("FAKE_DOCX_CONTENT");

// resets all mock state before every test
beforeEach(() => {
  jest.clearAllMocks();

  // ensure the code under test writes to a predictable bucket in tests
  process.env.S3_BUCKET = "unit-test-bucket";
  // default: S3 GetObject returns a stream of the right template bytes based on key
  s3.send.mockImplementation((cmd) => {
    if (cmd instanceof GetObjectCommand) {
      const key = (cmd.input && cmd.input.Key) || "";
      // serve template bodies for GetObject
      if (/^uploads\/.+\.html$/.test(key)) {
        return Promise.resolve({ Body: Readable.from([HTML_TEMPLATE]) });
      }
      if (/^uploads\/.+\.docx$/.test(key)) {
        return Promise.resolve({ Body: Readable.from([DOCX_TEMPLATE]) });
      }
      const err = new Error(`No mock for S3 GetObjectKey: ${key}`);
      err.$metadata = { httpStatusCode: 404 };
      return Promise.reject(err);
    }

    if (cmd instanceof PutObjectCommand) {
      // PutObject: return minimal ok
      return Promise.resolve({ Etag: '"deadbeef"' });
    }

    if (cmd instanceof HeadObjectCommand) {
      // HeadObject: return minimal ok
      return Promise.resolve({ ContentLength: 123 });
    }

    return Promise.reject(
      new Error(
        `Unhandled S3 command in test: ${
          cmd && cmd.constructor && cmd.constructor.name
        }`
      )
    );
  });
});

afterEach(() => {
  delete process.env.S3_BUCKET;
});

// VERIFIES HTML -> HTML WITH SANITZATION (FROM WEBHOOK: TRUE)
test("HTML merge -> HTML output (webhook path sanitizes)", async () => {
  // defines the stored file name of the template record the merge will load
  const templateName = "9999-sample.html";
  /* db template metadata + fields 
    - mocks Prisma to returns an HTML template row for id tpl-html-1 */
  prisma.template.findUnique.mockResolvedValue({
    id: "tpl-html-1",
    name: templateName,
    /* template declares one required placeholder field, title 
      - this is what mergeTemplate will fetch before reading merge data bytes from S3 */
    fields: [{ name: "title" }],
  });
  /* mocks the db insert for the resulting MergeJob so the function can return {jobId: 101, ... } 
    without touching a real db */
  prisma.mergeJob.create.mockResolvedValue({ id: 101 });

  /* triggers sanitization 
    - calls the system under test */
  const result = await mergeTemplate({
    templateId: "tpl-html-1",
    // data provides the value for the required {{title}} placeholder
    data: { title: "Hello" },
    // want filled HTML back
    outputType: "html",
    userId: null,
    // triggers sanitizeHtmlBuffer (remove <script>, javascript: URLs, etc.)
    fromWebhook: true,
  });

  // asserts the returned job ID matches the mocked mergeJob.create
  expect(result.jobId).toBe(101);
  /* asserts the output location, filePath, is an S3 URL under outputs/ and follows the 
    sample-<timestamp>.html naming pattern */
  expect(result.filePath).toMatch(
    /^s3:\/\/unit-test-bucket\/outputs\/sample-\d+\.html$/
  );

  /* using the helper to inspect the upload 
  - calls my findS3 helper to fetch the actual first PutObjectCommand that was sent */
  const putCmd = findS3(PutObjectCommand);
  // my mock command classes store constructor parameter on .input
  const putInput = putCmd?.input;
  /* pulls the uploaded body (Body) and converts it to a string- this is the sanitized final HTML 
    that was stored to S3 */
  const written = putInput && putInput.Body && putInput.Body.toString("utf8");

  // verifies sanitization worked: no <script> tags and no javascript: URLs remain
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

// manual (JWT)/non-webhook HTML test to prove scripts aren't stripped when fromWebhook: false
test("HTML merge -> HTML without sanitization (manual path keeps script tags)", async () => {
  // stubs Prisma...:
  prisma.template.findUnique.mockResolvedValue({
    // so when my code looks up the template by ID it gets...
    id: "tpl-html-nw",
    // an HTML template file...
    name: "9999-nw.html",
    // and one required field in the template, title
    fields: [{ name: "title" }],
  });

  // stubs the db insert for the merge job to "succeed" and returns a job ID of 606
  prisma.mergeJob.create.mockResolvedValue({ id: 606 });

  // calls my system under test:
  const result = await mergeTemplate({
    // templateId selects the HTML template
    templateId: "tpl-html-nw",
    // data supplies the {{title}} value
    data: { title: "Hello" },
    // outputType asks for HTML output, no PDF/DOCX conversion
    outputType: "html",
    // "not from webhook" so don't sanitize
    fromWebhook: false,
  });

  /* fetch the first recorded PutObjectCommand sent to the mocked S3 client 
  i.e. the upload of the generated output */
  const putCmd = findS3(PutObjectCommand);
  // reads the uploaded body (a Buffer) back into a UTF-8 string so I can inspect HTML contents
  const written = putCmd.input.Body.toString("utf8");
  // asserts the output still contains the script tag proving no sanitization occurred
  expect(written).toMatch(/<script>evil\(\)<\/script>/);
  // checks the function returned the mocked job ID
  expect(result.jobId).toBe(606);
});

// VERIFIES HTML -> PDF VIA PUPPETEER
test("HTML merge -> PDF via Puppeteer", async () => {
  /* mocks a different HTML template 
    - stubs the db lookup: when mergeTemplate asks Prisma for the template, it gets an HTML template
      with a single required field title */
  prisma.template.findUnique.mockResolvedValue({
    id: "tpl-html-2",
    name: "1000-letter.html",
    fields: [{ name: "title" }],
  });
  // stubs the db write: merger job insert returns a fake job with id: 202
  prisma.mergeJob.create.mockResolvedValue({ id: 202 });

  const result = await mergeTemplate({
    templateId: "tpl-html-2",
    data: { title: "Report" },
    /* calls with different outputType 
      - tells the HTML branch to render HTML via Mustache, and then convert to PDF with Puppeteer */
    outputType: "pdf",
    userId: "ul",
    // no sanitization step
    fromWebhook: false,
  });

  // asserts the returned job matches the mocked insert
  expect(result.jobId).toBe(202);
  // asserts S3 URL ends in .pdf...
  expect(result.filePath).toMatch(
    /^s3:\/\/unit-test-bucket\/outputs\/letter-\d+\.pdf$/
  );
  /* asserts page.setContent, page.pdf, and browser.close are called 
    - validates the Puppeteer flow ran:
    -- setContent(...) was called to load the merged HTML
    -- pdf() was called to generate PDF
    -- the browser was closed */
  expect(puppeteer._pageMock.setContent).toHaveBeenCalledTimes(1);
  expect(puppeteer._pageMock.pdf).toHaveBeenCalledTimes(1);
  expect(puppeteer._browserMock.close).toHaveBeenCalledTimes(1);
});

// checks that my mocks are loaded and behave as expected
test("mocks wired", async () => {
  // imports my mocked Docxtemplater wrapper
  const docx = require("../../docx-templating.js");
  /* asserts that renderDocxBufferOrThrow() (mocked) returns a Buffer (no real templating happens) */
  expect(docx.renderDocxBufferOrThrow()).toBeInstanceOf(Buffer);

  const puppeteer = require("puppeteer");
  /* checks the Puppeteer mock: calling launch() resolves to my _browserMock instance */
  await expect(puppeteer.launch()).resolves.toBe(puppeteer._browserMock);

  const libre = require("libreoffice-convert");
  // checks the libreoffice-convert mock...
  const out = await new Promise((res) =>
    // calling convert(...) yields a buffer (e.g. PDF_BUF in my mock)
    libre.convert(Buffer.from("x"), ".pdf", null, (_, b) => res(b))
  );
  // ensures the mock wiring for conversions works
  expect(Buffer.isBuffer(out)).toBe(true);
});

// VERIFIES DOCX -> DOCX
test("DOCX merge -> DOCX output", async () => {
  // mocks a DOCX template and stubs the db lookup for the template
  prisma.template.findUnique.mockResolvedValue({
    id: "tpl-docx-1",
    // this is the stored file
    name: "1111-form.docx",
    // template requires a single placeholder named client.name
    fields: [{ name: "client.name" }],
  });
  // stubs the db insert for the merge job so my code can return jobId: 303 without hitting a real db
  prisma.mergeJob.create.mockResolvedValue({ id: 303 });

  const result = await mergeTemplate({
    templateId: "tpl-docx-1",
    // data satisfies the required client.name field
    data: { client: { name: "Ada" } },
    // renders the DOCX template via Docxtemplater and output a merged DOCX (no PDF conversion)
    outputType: "docx",
    // userId is recorded on the job
    userId: "ul",
  });

  // asserts the returned job matches the mocked mergeJob.create
  expect(result.jobId).toBe(303);

  /* checks the output location string is an S3 URL in my outputs/ prefix and follows the naming pattern
    form-<timestamp>.docx */
  expect(result.filePath).toMatch(
    /^s3:\/\/unit-test-bucket\/outputs\/form-\d+\.docx$/
  );
  /* asserts the uploaded body is a Buffer
  - re-fetches the command instance for clarity */
  const putCmd = findS3(PutObjectCommand);
  /* putCmd.input.Body - the payload I attempted to upload to S3 
  Buffer.isBuffer(...) - checks that the payload is a Node Bugger (binary), not a string or something else */
  expect(Buffer.isBuffer(putCmd.input.Body)).toBe(true);
});

// VERIFIES DOCX -> PDF VIA LIBREOFFICE-CONVERT
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

// VERIFIES MISSING REQUIRED FIELDS THROW 422
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

// VERIFIES EXTRA FIELDS WARN BUT DON'T BLOCK
test("unexpected extra fields only warn (no throw)", async () => {
  prisma.template.findUnique.mockResolvedValue({
    id: "tpl-html-3",
    name: "4444-ok.html",
    // template requires title
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
