/* *MERGE ENGINE (DOCX/HTML -> DOCX/HTML/PDF) 
*** ORCHESTRATES IO, RENDERING, CONVERSIONS, AND AUDITING
- core merge engine - loads the template by templateId 
- renders the template via Docxtemplater (DOCX) or Mustache (HTML), optionally converts to 
  different file format, writes the output, and records a MergeJob
- *** NODE STDLIB - PATH, FS/PROMISES, OS, CHILD_PROCESS.SPAWN, UTIL (PROMISIFY, TYPES)
- Node's path utilities for safe, cross-platform path joins and basename extraction */
const path = require("path");
// promise-based filesystem API
const fs = require("fs/promises");
/* gives me read-only info about the machine/OS my code is running on; useful for paths, sizing 
pools, diagnostics, etc. */
const os = require("os");
/* spawn lets me start another process, e.g. run a CLI and strea, its stdout/stderr 
- spawn is used when I need incremental output or to handle large data without buffering it all */
const { spawn } = require("child_process");
/* promisify - turns a Node-style cb function (...args, callback) into a function that returns a Promise 
types - collection of robust type-check helpers helpful where typeof falls short */
const { promisify, types } = require("util");

/* *** THIRD-PARTY LIBS
wrapper around LibreOffice (soffice) to convert DOCX -> PDF (and other formats) or HTML -> PDF */
const libre = require("libreoffice-convert");
const { JSDOM } = require("jsdom");
// HTML templating engine; HTML -> merged HTML; further conversion may happen downstream
const Mustache = require("mustache");
// merged HTML -> PDF
const puppeteer = require("puppeteer");
// my initalized Prisma client
const prisma = require("./prisma");
// centralized directories for input templates and produced outputs
const { UPLOADS_DIR, OUTPUTS_DIR } = require("./paths");
const { s3, PutObjectCommand, GetObjectCommand, withPrefix } = require("./s3");

/* *** MY OWN MODULES
centralized DOCX render with normalized errors */
const {
  renderDocxBufferOrThrow,
  TemplateParseError,
} = require("./docx-templating.js");

// if libre.convert is already async/promise-based, use it directly; otherwise, wrap it with promisify
const convertAsync = types.isAsyncFunction(libre.convert)
  ? libre.convert
  : promisify(libre.convert);

/* *** ENSUREOUTPUTSDIR() CREATES UPLOADS/ AND OUTPUTS/
- ensures both uploads and outputs directories exist */
async function ensureOutputsDir() {
  /* creates the directories and any parent directories that don't exist
  - doesn't throw an error if the directory already exists 
  - idempotent - an operation that can applied multiple times without changing the result beyond the 
                 first application */
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_DIR, { recursive: true });
}

/* *** READS/WRITES WITH FS/PROMISES, PATH, OS
 *** LOADTEMPLATEBUGGER(TEMPLATE) - READS TEMPLATE BYTES FROM DISK INTO MEMORY */
async function loadTemplateBuffer(template) {
  /* template.name is from the template metadata persisted in templateUploadHandler.js
  - builds the on-disk fs path string by joining a base directory UPLOADS_DIR with a filename template.name
  - path.join handles separators correctly and normalizes things like extra slashes 
  - at merge time, engine reads the file from this path */
  const fullPath = path.join(UPLOADS_DIR, template.name);
  // reads the file's bytes at that path, returns a Promise tha tresolves to a Buffer containing the file data
  return fs.readFile(fullPath);
}

/* *STORAGE & CONVERSIONS
*** FILLED DOCX -> PDF CONVERSION via LIBREOFFICE WITH PROMISIFY WHEN NEEDED
- hands the merged DOCX buffer to libreoffice-convert and returns a PDF buffer */
async function convertDocxToPdfBuffer(docxBuffer) {
  // libreoffice-convert uses installed LibreOffice (soffice) to convert merged DOCX to PDF
  return convertAsync(docxBuffer, ".pdf", undefined);
}

/* *MERGE HELPERS - HTML templating & conversions 
*** HTML -> FILLED HTML MERGE via MUSTACHE, RENDERHTMLBUFFER
- HTML templates get merged and are rendered as filled HTML 
- (optionally convertHtmlToPdfBuffer via PUPPETEER or convertHtmlToDocxBuffer via 
  LibreOffice CLI) */
function renderHtmlBuffer(templateBuffer, data) {
  // converts the uploaded HTML file (Buffer) to a UTF-8 string
  const raw = templateBuffer.toString("utf-8");
  /* renders Mustache tags ({{...}} by default) in the HTML, using data 
  - Mustache escapes by default; it replaces characters that have special meaning in HTML with their
    safe equivalents
  -- this prevents HTML injection/XSS attacks */
  const merged = Mustache.render(raw, data);
  // converts merged HTML string back to Buffer for downstream converters
  return Buffer.from(merged, "utf-8");
}

/* *** HTML SANITIZATION - JSDOM DOM REWRITE (SANITIZEHTMLBUFFER) REMOVES DANGEROUS FEATURES
- <script>, dangerous attributes/URLs, etc.
returns a sanitized HTML Buffer */
function sanitizeHtmlBuffer(htmlBuffer) {
  /* converts incoming bytes to a UTF-8 string and feeds it to JSDOM to create a DOM 
  - with default options, JSDOM does not execute scripts and does not fetch remote 
    resources */
  const dom = new JSDOM(htmlBuffer.toString("utf8"));
  // gets the document object so I can query and modify the DOM
  const doc = dom.window.document;

  /* removes obviously dangerous elements from the DOM- tags that commonly enable script 
  execution or cross-origin embedding */
  doc
    .querySelectorAll("script, iframe, object, embed, link[rel='import']")
    .forEach((n) => n.remove());

  /* strips event handlers and javascript URLs 
  - walks every element in the document */
  doc.querySelectorAll("*").forEach((el) => {
    /* spreads the element's live NamedNodeMap into a static array so removing attributes 
    during iteration won't skip items */
    [...el.attributes].forEach((attr) => {
      // normalizes name by lowercasing
      const name = attr.name.toLowerCase();
      // normalizes val by casting it as a string
      const val = String(attr.value || "");
      /* sanitization rules:
      - if attribute name starts with on, remove it */
      if (/^on/.test(name)) el.removeAttribute(attr.name);
      // if the attribute is href or src and its value starts with javascript, remove it
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(val)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  // serializes the entire <html>...</html> element to a string and prefixes a doctype line
  const htmlOut = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  // converts the sanitized HTML string back to a Buffer (UTF-8) and returns it
  return Buffer.from(htmlOut, "utf8");
}

/* *** CONVERTHTMLTOPDFBUFFER - FILLED HTML -> PDF CONVERSION via PUPPETEER, HEADLESS PRINT TO PDF
- accepts an HTML Buffer and returns a Promise resolving to a PDF Buffer */
async function convertHtmlToPdfBuffer(htmlBuffer) {
  /* launches headless Chromium as a non-root user in Docker
  - Chromium - Chrome, if it's headless that means it's controlled by Puppeteer
  - non-root user - meaning the Chromium process runs without root privileges which is safer
  - Docker - "in Docker" means it's running inside a container
  - restores Chromium's sandbox and materially reduces blast radius */
  const browser = await puppeteer.launch({
    // uses Chromium's modern headless mode - no GUI
    headless: "new",
    /* tells Chromium not use shared memory; helps avoid crashes in containers where shared 
    memory is tiny by default 
    - pairs with --shm-size on docker run */
    args: ["--disable-dev-shm-usage"],
  });
  try {
    // opens a new tab/creates a page inside the launched browser and loads my HTML
    const page = await browser.newPage();
    /* loads HTML directly as the page contents 
    - converts the incoming HTML Buffer to a UTF-8 string and sets it as the page's full HTML */
    await page.setContent(htmlBuffer.toString("utf-8"), {
      /* networkidle0 waits until no network connections remain, good for when my HTML references 
      SPA assets/fonts so they finish loading before the PDF render */
      waitUntil: "networkidle0",
    });
    /* renders the page in a print layout (US Letter) and returns a PDF buffer since no path is 
    provided 
    - common extras: printBackground: true, margin: {...}, scale, or landscape: true */
    return await page.pdf({ format: "Letter" });
  } finally {
    // ensures Chromium is closed whether the PDF succeeded or on error
    await browser.close();
  }
}

/* soffice - command-line frontend to LibreOffice that I call for conversions/automations 
- it loads a document with an import filter, converts it to LO's internal document model,
  and then saves it with an export filter
- spawn soffice and capture output 
cmd - executable path
args - array of CLI args
cwd - working directory for the process (where relative paths are resolved and where
      LibreOffice may write outputs) */
function runSoffice(cmd, args, cwd) {
  /* wraps the child process in a Promise so callers can await it 
  child process - separate OS process that's created by a parent process
                  it has its own Process ID (PID), memory space, environment, and lifecycle
                  it runs concurrently with the parent  */
  return new Promise((resolve, reject) => {
    /* starts the child process using Node's child_process.spawn and streams output
    - cwd options sets the process's current working directory
    - returns a ChildProcess instance with stdin, stdout, stderr streams and lifecycle events 
    byte stream - one-way sequence of bytes that arrives in order over time
    streaming - process data as it arrives, chunk by chunk
                typical with spawn(), read from stdout as as stream
                low latency, low memory, handles arbitrarily large output
    buffering - read everything into memory first then process
                typical with exec() 
                simple for small outputs or when I need the whole result at once 
    pipe - OS-provided byte stream with two ends: write -> read 
           when I spawn a child process, Node gives me 3 pipes: child.stdin, .stdout, .sterr 
           pipes are unidirectional and support backpressure 
    readable stream (source) - produces data chunks
    writable stream- consumes data chunks at its own pace
    backpressure - the writable tells the readble to slow down when its internal buffer is full
                   it's the flow control mechanism that prevents a fast source from overwhelming
                   a slow destination */
    const proc = spawn(cmd, args, { cwd });

    // initializes string buffers to collect the child's output
    let stderr = "",
      stdout = "";
    // appends any data written to STDOUT to the stdout buffer
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    // append any data written to STDERR to the stderr buffer
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    /* if the process fails the start, error event fires 
    - once means I only handle it a single time, and I reject the Promise with that error */
    proc.once("error", reject);
    // close event fires when the process and its stdio streams are finished
    proc.once("close", (code) => {
      // if exit code === 0 -> success -> resolve() returns both captured stream
      if (code === 0) return resolve({ stdout, stderr });
      /* otherwise, construct a detailed error and reject 
      - build a helpful error message including the exit code and whatever output is most
        informative */
      const e = new Error(
        // prefer stderr output if present, otherwise stdout
        `soffice exit code ${code}\n${stderr || stdout}`.trim()
      );
      // attaches structured fields to the Error object so callers can inspect the actual outputs
      e.code = code;
      e.stdout = stdout;
      e.stderr = stderr;
      // rejects the Promise with the enriched error
      reject(e);
    });
  });
}

/* best-effort resolution of soffice on macOS if not on PATH 
- returns via a Promise the path to the soffice binary (which is again, LibreOffice CLI that does 
  the filled HTML -> DOCX conversions)
- set SOFFICE_BIN if soffice is not on the system PATH and spawning it will fail with ENOENT 
- ENOENT - POSIX error code for "No such file or directory" 
- POSIX - Portable Operating System Interface, a family of standards that define a common API and 
          behavior for Unix-like operating systems with the goal that: software written for one 
          compliant system can be ported to another compliant system with minimal change
- porting - adapting software so it can run on aiddferent os, hardware, or environment than the 
            one it was originally developed for */
async function resolveSoffice() {
  // if env variable is set, use it and stop
  if (process.env.SOFFICE_BIN) return process.env.SOFFICE_BIN;
  // try a well-known default path if I'm running on macOS
  if (process.platform === "darwin") {
    /* canonical macOS install path to the LibreOffice's CLI 
    - .app bundle is placed in /Applications
    - inside that bundle, the actual CLI binary lives at Contents/MacOS/soffice 
    - binary - a program that has been compiled into machine code that my CPU executes directly */
    const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    try {
      // checks whether the file exists and is accessible
      await fs.access(macPath);
      // if it succeeds, returns that path; if LibreOffice isn't installed, the path won't exist
      return macPath;
      // if it throws, not installed or wrong location, ignore the error and continue (empty catch)
    } catch {}
  }
  /* fallback for Linux, Windows, macOS when bundle path isn't found, return the command name "soffice" */
  return "soffice";
}

/* *** FILLED HTML -> DOCX VIA LibreOffice CLI AND RUNSOFFICE()
- HTML -> ODT (Writer) -> DOCX 
- takes an HTML Buffer and returns a Promise resolving to a DOCX Buffer
- always use the CLI fallback; it's more reliable than libreoffice-convert for buffer-only HTML */
async function convertHtmlToDocxBuffer(htmlBuffer) {
  // figures out the path/command for LibreOffice's CLI
  const soffice = await resolveSoffice();
  /* *** WRITES TEMP HTML AND CALLS SOFFICE DIRECTLY AS FALLBACK
  - creates a unique temporary directory under the system temp folder 
  - keeps all intermediate files isolated */
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "html2docx-"));
  // prepares full path for the input HTML file
  const inHtml = path.join(tmpDir, "source.html");
  /* ODT - open-source equivalent of DOCX, stands for OpenDocument Text; it's the default file format used by
           LibreOffice Writer 
  - LibreOffice is a suite of apps: Writer is a word processor (.odt), Calc is for spreadsheets (.ods), and 
    Impress is for presentations (.odp) 
  - prepares full path for the input HTML file */
  const midOdt = path.join(tmpDir, "source.odt");
  // prepares full path for the final DOCX file to read back
  const outDocx = path.join(tmpDir, "source.docx");

  // writes the incoming HTML buffer to disk as source.html so soffice can read it
  await fs.writeFile(inHtml, htmlBuffer);

  try {
    /* 1. HTML -> ODT (force Writer import so it's treated as a document) 
    - helper that spawns soffice process with the following args, in tmpDir as working directory */
    await runSoffice(
      soffice,
      [
        // runs without GUI
        "--headless",
        // TELLS LO TO USE THE WRITER HTML FILTER - TREATS AS A TEXT DOCUMENT, NOT AS A WEBPAGE FOR CALC/IMPRESS
        "--infilter=HTML (StarWriter)",
        // target format is ODT
        "--convert-to",
        "odt",
        // write output into the temp dir
        "--outdir",
        tmpDir,
        // the input file to convert
        inHtml,
      ],
      tmpDir
    );

    // verifies that the ODT was produced and throws if missing
    await fs.access(midOdt);

    /* *** ODT -> DOCX CONVERSION
    2. ODT -> DOCX 
    - second conversion step; again in headless mode, writing to the same temp dir */
    await runSoffice(
      soffice,
      ["--headless", "--convert-to", "docx", "--outdir", tmpDir, midOdt],
      tmpDir
    );

    /* reads generated DOCX file into a Buffer into memory and returns it to the caller
    (caller writes it to outputs/) */
    return await fs.readFile(outDocx);
  } finally {
    // best-effort cleanup (don't fail the request if this throws)
    try {
      /* *** CLEANS TEMP DIR
      always attempt to delete the temp directory and everything inside it, whether success or failure */
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/* *** DOT-PATH EXTRACTION FOR DEEP KEY VALIDATION
helper function that returns a flat list of dot-paths for a nested object's leaf keys
e.g. { client: { name: 'X' } -> ['client.name'] 
- prefix - current path during recursion i.e. accumulated breadcrumbs of keys from
           the root of the object down to the node I'm currently visiting; defaults 
           to empty
this function enumerates keys
- CSV rows are flat objects, so it's produce headers, even dot-keys like "client.name" which will match 
  template.fields if my templates uses that name */
function flattenKeys(obj, prefix = "") {
  // accumulator array for all discovered key paths
  const out = [];
  /* iterates over the object's own enumerable string keys and returns an array of 
  [key, value] pairs
  - obj || {} guards against null/undefined so Object.entries doesn't throw */
  for (const [k, v] of Object.entries(obj || {})) {
    /* builds the full dot path for this key 
    - if I'm nested, prefix is nonempty, join with a dot; otherwise just the key */
    const path = prefix ? `${prefix}.${k}` : k;
    /* v - excludes null
    typeof v === "object" ensures only objects are recursed into
    !Array.isArray(v) treats arrays as leaves
    leaf - any value I don't recurse into
    - no drilling to indices, i.e. I don't enumerate array elements */
    if (v && typeof v === "object" && !Array.isArray(v)) {
      /* recurse into the nested object and spread the returned paths into out
      - key is "client" and v is:
      v = { address: {city: "NYC", zip: "10001" }, name: "Ada" };
      path = "client";
      
      flattenKeys(v, "client") -> ["client.address.city", "client.address.zip", "client.name"]
      spread push(...["client.address.city", "client.address.zip", "client.name"]);
      - spread push, pushes each path string separately; without it, the entire array becomes an
        element in an array, [[]]
      out = ["client.address.city", "client.address.zip", "client.name"]; 
      - appends those individuals path strings to the accumulator out */
      out.push(...flattenKeys(v, path));
    } else {
      // if it's not a non-array object, treat it as a leaf and records its path
      out.push(path);
    }
  }
  // returns the accumulated list
  return out;
}

/* *** MAIN MERGE FLOW 
- mergeTemplate({...}) is format-agnostic - it just needs a single JS object of key/value pairs
- CSV rows after parsing are JS objects of key/value pairs */
async function mergeTemplate({
  templateId,
  data,
  outputType,
  userId = null,
  fromWebhook = false,
}) {
  /* *** ENSURES DIRS 
  - makes sure upload/output directories exist */
  await ensureOutputsDir();

  /* *** FETLCH TEMPLATE + FIELDS VIA PRISMA
  C8. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): template loading & validation 
  B5. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): template loading & validation
  B5a. fetches template metadata and its known placeholders for validation/logging */
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    // B5b. includes field definitions for validation
    include: { fields: true },
  });
  // B5c. fails fast if the id is invalid i.e. template not found
  if (!template) throw new Error("Template not found");

  /* C9. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): data validation
  B6. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): data validation
  *** SOFT-VALIDATE PROVIDED DATA/KEYS AGAINST STORED FIELDS/TEMPLATE.FIELDS
  - extracts the values for the name property of the field objects, which corresponds 
    to placeholders in the template, into an array 
  - wraps the array in a Set which allows fast lookups and ensures uniqueness */
  const allowed = new Set(template.fields.map((f) => f.name));
  // compares leaf dot paths from provided data to allowed placeholders
  const provided = flattenKeys(data);
  /* - data - object the client sends with values for the placeholders
  - .filter - gets an array of keys NOT present in the allowed set */
  const extras = provided.filter((k) => !allowed.has(k));
  /* *** WARNS ON EXTRA KEYS (NOT FATAL)
  if any unexpected keys are found, logged to console as a warning but does not
  reject the request 
  - server only logs this message during merge, not upload */
  if (extras.length) console.warn("Unexpected field:", extras);

  // fails fast on missing data for tags
  const providedSet = new Set(provided);
  // .filter - gets an array of tags NOT present in the provided data set
  const missing = [...allowed].filter((k) => !providedSet.has(k));
  if (missing.length) {
    // *** ERROR ON MISSING REQUIRED PLACEHOLDERS
    const err = new Error(`Missing required fields: ${missing.join(" ,")}`);
    err.status = 422;
    throw err;
  }

  /* *** DETECTS .DOCX VS .HTML 
  C10. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): template processing
  B7. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): template processing
  detects .docx vs .html
  returns true if the stored filename for the template ends in .docx */
  const isDocx = /\.docx$/i.test(template.name);
  /* returns true if the stored filename for the template ends in .html 
  - ? means the preceding l can be optional, so it matches .htm or .html */
  const isHtml = /\.html?$/i.test(template.name);

  // guards: only DOCX and HTML are supported
  if (!isDocx && !isHtml) {
    throw new Error("Unsupported template type. Use .docx or .html");
  }

  /* *** READS TEMPLATE BYTES
  reads the template file from disk into memory 
  disk- persistent storage, hard drive, SSD
  memory - volatile RAM used by a running process */
  const buf = await loadTemplateBuffer(template);

  /* prepares variabes
  - outBuffer - will hold the converted output */
  let outBuffer;
  /* safeBase - sanitized filename stem 
  - enforces that the resolved path stays inside a known safe directory */
  const safeBase = path
    /* strips any directory parts and keeps only the file name 
    - prevents path traversal like ../../evil.docx
    - works cross-platform, handles / and \ */
    .basename(template.name)
    /* replaces any run of disallowed characters witha single underscore _
    - allowed: letters, digits, underscore, dot, hyphen, and space */
    .replace(/[^\w.\- ]+/g, "_")
    /* removes the final file extension only
    - matches a dot followed by one or more non-dot chars up to the end ($)
    - ex. report.final.v2.docx -> report.final.v2
    - after this, safeBase is fully sanitized and extensionless, safe for creating output files */
    .replace(/\.[^.]+$/, "");
  // unique-ish filename timestamp
  const stamp = `${safeBase}-${Date.now()}`;
  // destination on disk
  let filePath;

  if (isDocx) {
    let mergedDocx;
    /* C10. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): template processing
    B7. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): template processing
    B7a. detects .docx vs .html 
    B7b. DOCX -> filled DOCX merge in memory via Docxtemplater 
    - (optional LibreOffice converts filled DOCX to PDF) */
    try {
      /* *** DOCX PATH -> DOCX-TEMPLATING.JS (PIZZIP + DOCXTEMPLATER) 
      *** MERGES WITH RENDERDOCXBUFFERORTHROW -> MERGEDDOCX(BUFFER) 
      DOCX templating - calls my public merge API and tries to merge the DOCX template 
      buf with data 
      - returns a Buffer of the merged DOCX */
      mergedDocx = renderDocxBufferOrThrow(buf, data);
    } catch (err) {
      if (err instanceof TemplateParseError) {
        /* tags an HTTP-ish status for a generic error handler upstream 
        - template parsing/merging error - bad/missing tags, logic blocks, etc. 
        = 422 Unprocessable Entity */
        err.status = 422;
        // rethrows domain error unchanged
        throw err;
      }
      // non-template error (I/O, unexpected exceptions, etc.)
      throw err;
    }

    // *** IF DOCX REQUESTED, WRITES MERGED DOCX
    if (outputType === "docx") {
      // keeps the merged DOCX in memory
      outBuffer = mergedDocx;
      /* saves the merged DOCX and sets the output path to a .docx file under OUTPUTS_DIR */
      filePath = path.join(OUTPUTS_DIR, `${stamp}.docx`);
      // if PDF requested
    } else if (outputType === "pdf") {
      /* *** IF PDF REQUESTED, DOCX -> PDF VIA CONVERTDOCXTOPDFBUFFER 
      B7c. converts merged DOCX to PDF via LibreOffice, stores that PDF Buffer in outBuffer */
      outBuffer = await convertDocxToPdfBuffer(mergedDocx);
      // sets a .pdf path
      filePath = path.join(OUTPUTS_DIR, `${stamp}.pdf`);
    } else {
      // guards against unsupported outputs
      throw new Error("outputType must be 'docx' or 'pdf'");
    }
  }

  if (isHtml) {
    /* *** HTML PATH -> MUSTACHE, OPTIONAL JSDOM SANITIZATION, PUPPETEER TO PDF, LIBREOFFICE CLI
    TO DOCX
    C10. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): template processing
    B7. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): template processing
    B7a. detects .docx vs .html 
    *** HTML -> FILLED HTML - MERGE VIA MUSTACHE -> MERGED HTML (BUFFER)
    B7b. HTML -> filled HTML merge in memory via Mustache
    - (optional) Puppeteer prints to PDF */
    const mergedHtml = renderHtmlBuffer(buf, data);

    // SANITIZE WITH JSDOM WHEN CALLED FROM A WEBHOOK
    const finalHtml = fromWebhook ? sanitizeHtmlBuffer(mergedHtml) : mergedHtml;

    // audit if changed
    if (fromWebhook && finalHtml.length !== mergedHtml.length) {
      console.warn(
        "Sanitization modified merged HTML for template",
        template.id
      );
    }
    // *** PRODUCES PDF VIA PUPPETEER, DOCX VIA LO CLI, AND HTML AS IS
    if (outputType === "pdf") {
      //  B7c. converts HTML to PDF via Puppeteer
      outBuffer = await convertHtmlToPdfBuffer(finalHtml);
      filePath = path.join(OUTPUTS_DIR, `${stamp}.pdf`);
    } else if (outputType === "docx") {
      // B7c. converts HTML to DOCX via LibreOffice
      outBuffer = await convertHtmlToDocxBuffer(finalHtml);
      filePath = path.join(OUTPUTS_DIR, `${stamp}.docx`);
    } else if (outputType === "html") {
      // already returns the filled HTML as a Buffer
      outBuffer = finalHtml;
      filePath = path.join(OUTPUTS_DIR, `${stamp}.html`);
    } else {
      // guards against unsupported outputs
      throw new Error(
        "outputType must be 'docx','pdf', or 'html' for HTML templates"
      );
    }
  }

  /* *** WRITES OUTPUT TO OUTPUTS/ WITH A SAFE, TIMESTAMPED FILENAME 
  C11. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): output generation 
  B8. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): output generation
  B8a. writes results to outputs/ (disk) 
  B8b. records a MergeJob in db for audit trail
  - persists the output Buffer to disk */
  await fs.writeFile(filePath, outBuffer);

  /* *** PERSISTS MERGE RESULTS VIA PRISMA  
  *** CREATES A MERGEJOB ROW WITH PRISMA
  persists a merge job record 
  - records success in MergeJob with metadata for audit/retrieval */
  const job = await prisma.mergeJob.create({
    data: {
      templateId: template.id,
      data,
      outputType,
      status: "succeeded",
      filePath,
      // this will be null for webhook calls
      userId: userId || null,
    },
  });

  // *** RETURNS
  return { jobId: job.id, filePath };
}

module.exports = { mergeTemplate };

/* B. Manual (JWT)
authentication- JWT Bearer token
data location- req.body.data
output default-docx
output source- request body
identity- req.user available
body processing- JSON parsed by EXPRESS
docx -> filled docx - opens .docx zip with PIZZIP
                      render placeholders and does merging using DOCXTEMPLATER
                      renderDocxBufferOrThrow(buf, data) using my Mustache-style delimiters and 
                      nullGetter(which raises a Template ParseError) to get a filled docx buffer
html -> filled html - renderHtmlBuffer(buf, data) using MUSTACHE
docx -> filled docx - above
filled docx -> pdf  - conversion via convertDocxToPdfBuffer(..) using LIBREOFFICE, libre-office-convert
filled html -> docx - conversion via convertHtmlToDocxBuffer(...) using LIBREOFFICE SOFFICE CLI pipeline
                    - run soffice --headless --convert-to 'docx:"MS Word 2007 XML"' or via HTML → ODT → DOCX  
filled html -> pdf  - conversion via convertHtmlToPdfBuffer(...) feeds the HTML string to PUPPETEER,
                      Chromium, and print to PDF

C. Webhook (HMAC) 
authentication- HMAC signature
data location- req.parsedBody/ entire payload
output default- pdf
output source- query string
identity- no user identity
body processing- raw bytes manually parsed 

only difference is the authentication mechanism and data extraction source 

KEY LIBS: LIBREOFFICE-CONVERT, PUPPETEER, JSDOM, MUSTACHE, CHILD_PROCESS, UTIL, @PRISMA/CLIENT */
