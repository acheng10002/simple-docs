/* *** MOCK: PRISMA WITH A MANUAL MOCK 
- tells Jest to replace my real Prisma client with the stub in _mocks_/prisma */
jest.mock("../prisma", () => require("../__mocks__/prisma"));
// pulls in the mocked Prisma instance (with findUnique, create, etc. as jest fns)
const prisma = require("../prisma");

// mocks S3 client so I can inspect calls and provide canned responses
jest.mock("../s3", () => {
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
} = require("../s3");
const { Readable } = require("stream");

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

const { mergeTemplate } = require("../merge.service");

/* helper: fake upload buffer with a small HTML file that includes intentionally 
unsafe content 
- <script>, href="javascript..." link, a remote img URL 
- small HTML template with intentionally unsafe content, used to test sanitization */
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

  // fs.mkdir OK; pretends directory creation always works
  // fs.mkdir.mockResolvedValue();

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
      // PutObject/HeadObject: return minimal ok
      return Promise.resolve({ Etag: '"deadbeef"' });
    }

    if (cmd instanceof HeadObjectCommand) {
      // PutObject/HeadObject: return minimal ok
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

// *** VERIFIES HTML -> HTML WITH SANITZATION (FROM WEBHOOK: TRUE)
test("HTML merge -> HTML output (webhook path sanitizes)", async () => {
  // regex-escape helper
  // const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  /* mirrors how the system under test builds the base (strips only the final extension) 
    - takes just the file name from a full path 
    - removes only the final extension 
    const stem = path.basename(templateName).replace(/\.[^.]+$/, "");
    /* builds a directory prefix by appending the platform specific separator 
    - wraps it in escRe(...), helper that escape regex metacharacters so the directory path
      is safe to embed in a RegExp 
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
  // asserts the returned job ID matches the mocked mergeJob.create
  expect(result.jobId).toBe(101);
  /* asserts the output location, filePath, is an S3 URL under outputs/ and follows the 
    sample-<timestamp>.html naming pattern */
  expect(result.filePath).toMatch(
    /^s3:\/\/unit-test-bucket\/outputs\/sample-\d+\.html$/
  );

  /* captures the body uploaded to S3 PutObject (sanitized HTML)
    - peeks into the S3 client mock to find the call where I uploaded the merged file
    - s3.send.mock.calls - array of each function call's arg list array
    - each inner array is the arg list for one invocation fo s3.send */
  const put = s3.send.mock.calls.find(
    // specifically locates the invocation whose first arg is an instance of PutObjectCommand
    ([c]) => c && c.constructor && c.constructor.name === "PutObjectCommand"
  );
  // extracts the input passed to that PutObjectCommand, i.e. { Bucket, Key, Body, ContentType, ... }
  const putInput = put && put[0] && put[0].input;
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
// *** VERIFIES HTML -> PDF VIA PUPPETEER
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
  // asserts filePath ends in .pdf
  // expect(result.filePath).toMatch(/letter-\d+\.pdf$/);
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
  const docx = require("../docx-templating.js");
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

// *** VERIFIES DOCX -> DOCX
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
  // asserts the file path suffix
  // expect(result.filePath).toMatch(/form-\d+\.docx$/);
  // fs.writeFile called with merged DOCX buffer
  // const written = fs.writeFile.mock.calls[0][1];
  // asserts that the written buffer is indeed a Buffer
  // expect(Buffer.isBuffer(written)).toBe(true);

  /* checks the output location string is an S3 URL in my outputs/ prefix and follows the naming pattern
    form-<timestamp>.docx */
  expect(result.filePath).toMatch(
    /^s3:\/\/unit-test-bucket\/outputs\/form-\d+\.docx$/
  );
  /* PutObject body is the merged DOCX buffer 
    - digs into the S3 client mock call history and finds the call where my code uploaded the file
    - s3.send.mock.calls - an array of call; each element is the array of args for that call */
  const put = s3.send.mock.calls.find(
    // identifies the call whose first argument is an instance of PutObjectCommand
    ([c]) => c && c.constructor && c.constructor.name === "PutObjectCommand"
  );
  /* verifies the command's input body (the bytes sent to S3) is a Buffer i.e. I actually uploaded a binary
    DOCX, not a string or something else
    - put[0] is the command instance captured from the mock call's first argument
    - .input.Body is the uploaded payload */
  expect(Buffer.isBuffer(put[0].input.Body)).toBe(true);
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
