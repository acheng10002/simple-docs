/* MERGE ENGINE (DOCX/HTML -> DOCX/HTML/PDF) 
ORCHESTRATES IO, RENDERING, CONVERSIONS, AND AUDITING
- Node's path utilities for safe, cross-platform path joins and basename extraction */
const path = require("path");
// promise-based filesystem API
const fs = require("fs/promises");
/* gives me read-only info about the machine/OS my code is running on; useful for paths, sizing 
pools, diagnostics, etc. */
const os = require("os");
/* spawn lets me start another process, e.g. run a CLI and stream, its stdout/stderr 
- spawn is used when I need incremental output or to handle large data without buffering it all */
const { spawn } = require("child_process");
/* promisify - turns a Node-style cb function (...args, callback) into a function that returns a Promise 
types - collection of robust type-check helpers helpful where typeof falls short */
const { promisify, types } = require("util");

/* THIRD-PARTY LIBS
wrapper around LibreOffice (soffice) to convert DOCX -> PDF (and other formats) or HTML -> PDF */
const libre = require("libreoffice-convert");
// server-side DOM work, sanitize HTML
const { JSDOM } = require("jsdom");
// HTML templating engine: HTML -> merged HTML, further conversion may happen downstream
const Mustache = require("mustache");
// merged HTML -> PDF
const puppeteer = require("puppeteer");
// my initalized Prisma client
const prisma = require("./prisma");
// gets properties off s3
const { s3, PutObjectCommand, GetObjectCommand, withPrefix } = require("./s3");

/* MY OWN MODULES
centralized DOCX render with normalized errors */
const {
  renderDocxBufferOrThrow,
  TemplateParseError,
} = require("./docx-templating.js");

// if libre.convert is already async/promise-based, use it directly; otherwise, wrap it with promisify
const convertAsync = types.isAsyncFunction(libre.convert)
  ? libre.convert
  : promisify(libre.convert);

/* READS/WRITES WITH FS/PROMISES, PATH, OS
LOADTEMPLATEBUGGER(TEMPLATE) - READS TEMPLATE BYTES
 - expects a template object (from DB) that includes template.name (the stored filename) */
async function loadTemplateBuffer(template) {
  /* builds the S3 object key- the "path" in the bucket
  - uploads/ is my folder-like prefix, template.name is the timestamped, sanitized filename I saved earlier 
  - withPrefix(...) lets me inject a global prefix later without touching callers */
  const key = withPrefix(`uploads/${template.name}`);
  /* uses AWS SDK v3 s# client to call the GetObject API 
  - on success I get resp
  - resp.Body - stream of the object bytes plus headers like ContentLength, ETag, etc. */
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      // key is the path I just build
      Key: key,
    })
  );
  // prepares an array to collect incoming stream chunks/Node Buffers
  const chunks = [];
  /* asynchronously iterates the streaming body
  - each chunk is a Buffer with the next slice of data, pushes chunks into the array until the stream ends
  - this pattern consumes the whole object into memory, it's ok for small/medium files */
  for await (const chunk of resp.Body) chunks.push(chunk);
  /* stitches all chunks together into a single Buffer and returns it to the caller
  - callers now have the full file bytes memory, which will be useful if I need to pass it to libraries like
    Docxtemplater, LibreOffice converters, Mustache, etc. */
  return Buffer.concat(chunks);
}

/* STORAGE & CONVERSIONS
FILLED DOCX -> PDF CONVERSION via LIBREOFFICE WITH PROMISIFY WHEN NEEDED */
async function convertDocxToPdfBuffer(docxBuffer) {
  // libreoffice-convert uses installed LibreOffice (soffice) to convert merged DOCX buffer to PDF buffer
  return convertAsync(docxBuffer, ".pdf", undefined);
}

// DOCX -> HTML via LibreOffice, with CLI fallback
async function convertDocxToHtmlBuffer(docxBuffer) {
  /* first tries the in-process converter 
  - uses libreoffice-convert's async API (my convertAsync) to convert the DOCX bytes directly to HTML 
  - if this succeeds, it returns the HTML Buffer immediately */
  try {
    return await convertAsync(docxBuffer, ".html", undefined);
    /* if the in-process conversion throws (missing filters, plaform quirks, etc.), fall back to calling the 
    soffice CLI */
  } catch (e) {
    // fallback to CLI program for LO, soffice (more reliable when filters/options differ)
    const soffice = await resolveSoffice();
    /* creates a unique temp directory under the OS temp folder
    - keeps all intermediate files isolated (avoids name clashes) */
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docx2html-"));
    // prepares absolute paths for the input DOCX and expected output HTML within that temp dir
    const inDocx = path.join(tmpDir, "source.docx");
    const outHtml = path.join(tmpDir, "source.html");

    // writes the incoming DOCX buffer to disk so soffice can read it
    await fs.writeFile(inDocx, docxBuffer);

    // another try scope for the conversion step
    try {
      /* converts DOCX -> HTML (Writer) 
      note: HTML export may emit sibling asset file (images/css) 
      - spawns LO headless and converts the DOCX */
      await runSoffice(
        soffice,
        [
          // runs without a GUI (this is required on servers/containers)
          "--headless",
          // asks for HTML output using a specific export filter
          "--convert-to",
          // using the Writer HTML filter name helps ensure text-doc semantics
          'html:"HTML (StarWriter)"',
          "--outdir",
          // puts outputs including any sidecar files in the temp directory
          tmpDir,
          // the input file to convert
          inDocx,
        ],
        tmpDir
      );

      // reads the produced HTML file back into a Buffer and returns it
      const html = await fs.readFile(outHtml);
      return html;
      // finally block always runs and removes the entire temp directory
    } finally {
      try {
        /* recursive: true removes nested content 
        force: true prevents throwing if files are already gone */
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

/* MERGE HELPERS - HTML templating & conversions 
HTML -> FILLED HTML MERGE via MUSTACHE, RENDERHTMLBUFFER
- (optionally convertHtmlToPdfBuffer via PUPPETEER or convertHtmlToDocxBuffer via 
  LibreOffice CLI) */
function renderHtmlBuffer(templateBuffer, data) {
  // converts the uploaded HTML file (Buffer) to a UTF-8 string
  const raw = templateBuffer.toString("utf-8");
  // renders Mustache tags ({{...}} by default) in the HTML, using data
  const merged = Mustache.render(raw, data);
  // converts merged HTML string back to Buffer for downstream converters
  return Buffer.from(merged, "utf-8");
}

/* HTML SANITIZATION - JSDOM DOM REWRITE (SANITIZEHTMLBUFFER) REMOVES DANGEROUS FEATURES
returns a sanitized HTML Buffer without <script>, dangerous attributes/URLs, etc. */
function sanitizeHtmlBuffer(htmlBuffer) {
  // converts incoming bytes to a UTF-8 string and feeds it to JSDOM to create a DOM
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

/* CONVERTHTMLTOPDFBUFFER - FILLED HTML -> PDF CONVERSION via PUPPETEER, HEADLESS PRINT TO PDF
- accepts an HTML Buffer and returns a Promise resolving to a PDF Buffer */
async function convertHtmlToPdfBuffer(htmlBuffer) {
  // launches headless Chromium as a non-root user in Docker
  const browser = await puppeteer.launch({
    // uses Chromium's modern headless mode - no GUI
    headless: "new",
    /* tells Chromium not use shared memory, helps avoid crashes in containers where shared memory 
    is tiny by default */
    args: ["--disable-dev-shm-usage"],
  });
  try {
    // opens a new tab/creates a page inside the launched browser and loads my HTML
    const page = await browser.newPage();
    // loads HTML directly as the page contents
    await page.setContent(htmlBuffer.toString("utf-8"), {
      /* networkidle0 waits until no network connections remain, good for when my HTML references 
      SPA assets/fonts so they finish loading before the PDF render */
      waitUntil: "networkidle0",
    });
    /* renders the page in a print layout (US Letter) and returns a PDF buffer since no path is 
    provided */
    return await page.pdf({ format: "Letter" });
  } finally {
    // ensures Chromium is closed whether the PDF succeeded or on error
    await browser.close();
  }
}

/* soffice loads a document with an import filter, converts it to LO's internal document model,
  and then saves it with an export filter
- spawn soffice and capture output */
function runSoffice(cmd, args, cwd) {
  // wraps the child process in a Promise so callers can await it
  return new Promise((resolve, reject) => {
    // starts the child process using Node's child_process.spawn and streams output
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
  the filled HTML -> DOCX conversions) */
async function resolveSoffice() {
  /* resolveSoffice() first checks process.env.SOFFICE_BIN and if it's set, uses it instead of
  searching the system defaults/PATH */
  if (process.env.SOFFICE_BIN) return process.env.SOFFICE_BIN;
  // try a well-known default path if I'm running on macOS
  if (process.platform === "darwin") {
    // canonical macOS install path to the LibreOffice's CLI
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

/* FILLED HTML -> DOCX VIA LibreOffice CLI AND RUNSOFFICE()
- HTML -> ODT (Writer) -> DOCX, takes an HTML Buffer and returns a Promise resolving to a DOCX Buffer */
async function convertHtmlToDocxBuffer(htmlBuffer) {
  // figures out the path/command for LibreOffice's CLI
  const soffice = await resolveSoffice();
  /* WRITES TEMP HTML AND CALLS SOFFICE DIRECTLY AS FALLBACK
  - creates a unique temporary directory under the system temp folder 
  - keeps all intermediate files isolated */
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "html2docx-"));
  // prepares full path for the input HTML file
  const inHtml = path.join(tmpDir, "source.html");
  // prepares full path for the odt file
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
      /* CLEANS TEMP DIR
      always attempt to delete the temp directory and everything inside it, whether success or failure */
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/* DOT-PATH EXTRACTION FOR DEEP KEY VALIDATION
helper function that returns a flat list of dot-paths for a nested object's leaf keys */
function flattenKeys(obj, prefix = "") {
  // accumulator array for all discovered key paths
  const out = [];
  /* iterates over the object's own enumerable string keys and returns an array of [key, value] pairs
  - obj || {} guards against null/undefined so Object.entries doesn't throw */
  for (const [k, v] of Object.entries(obj || {})) {
    /* builds the full dot path for this key 
    - if I'm nested, prefix is nonempty, join with a dot; otherwise just the key */
    const path = prefix ? `${prefix}.${k}` : k;
    /* v - excludes null
    typeof v === "object" ensures only objects are recursed into
    !Array.isArray(v) treats arrays as leaves
    - no drilling to indices, i.e. I don't enumerate array elements */
    if (v && typeof v === "object" && !Array.isArray(v)) {
      /* recurse into the nested object and spread the returned paths into out
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

// MAIN MERGE FLOW
async function mergeTemplate({
  templateId,
  data,
  outputType,
  userId = null,
  fromWebhook = false,
}) {
  /* FETLCH TEMPLATE + FIELDS VIA PRISMA
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
  SOFT-VALIDATE PROVIDED DATA/KEYS AGAINST STORED FIELDS/TEMPLATE.FIELDS */
  const allowed = new Set(template.fields.map((f) => f.name));
  // compares leaf dot paths from provided data to allowed placeholders
  const provided = flattenKeys(data);
  // .filter - gets an array of keys NOT present in the allowed set
  const extras = provided.filter((k) => !allowed.has(k));
  /* WARNS ON EXTRA KEYS (NOT FATAL)
  if any unexpected keys are found, logged to console as a warning but does not reject the request */
  if (extras.length) console.warn("Unexpected field:", extras);

  // fails fast on missing data for tags
  const providedSet = new Set(provided);
  // .filter - gets an array of tags NOT present in the provided data set
  const missing = [...allowed].filter((k) => !providedSet.has(k));
  if (missing.length) {
    // ERROR ON MISSING REQUIRED PLACEHOLDERS
    const err = new Error(`Missing required fields: ${missing.join(" ,")}`);
    err.status = 422;
    throw err;
  }

  /* *** DETECTS .DOCX VS .HTML 
  C10. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): template processing
  B7. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): template processing
  detects .docx vs .html */
  const isDocx = /\.docx$/i.test(template.name);
  // returns true if the stored filename for the template ends in .html
  const isHtml = /\.html?$/i.test(template.name);

  // guards: only DOCX and HTML are supported
  if (!isDocx && !isHtml) {
    throw new Error("Unsupported template type. Use .docx or .html");
  }

  // validates allowed outputs for each template family
  if (isDocx && !["docx", "pdf", "html"].includes(outputType)) {
    throw new Error(
      "outputType must be one of: docx, pdf, html for DOCX templates"
    );
  }

  if (isHtml && !["html", "pdf", "docx"].includes(outputType)) {
    throw new Error(
      "outputType must be one of: html, pdf, docx for HTML templates"
    );
  }

  /* READS TEMPLATE BYTES
  reads the template file from S3 */
  const buf = await loadTemplateBuffer(template);

  /* prepares variabes
  outBuffer - will hold the converted output */
  let outBuffer;
  /* safeBase - sanitized filename stem 
  - enforces that the resolved path stays inside a known safe directory */
  const safeBase = path
    // strips any directory parts and keeps only the file name
    .basename(template.name)
    // replaces any run of disallowed characters witha single underscore _
    .replace(/[^\w.\- ]+/g, "_")
    /* removes the final file extension only
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
      /* DOCX PATH -> DOCX-TEMPLATING.JS (PIZZIP + DOCXTEMPLATER) 
      MERGES WITH RENDERDOCXBUFFERORTHROW -> MERGEDDOCX(BUFFER) 
      - returns a Buffer of the merged DOCX */
      mergedDocx = renderDocxBufferOrThrow(buf, data);
    } catch (err) {
      if (err instanceof TemplateParseError) {
        /* tags an HTTP-ish status for a generic error handler upstream 
        - template parsing/merging error - bad/missing tags, logic blocks, etc. = 422 Unprocessable Entity */
        err.status = 422;
        // rethrows domain error unchanged
        throw err;
      }
      // non-template error (I/O, unexpected exceptions, etc.)
      throw err;
    }

    // IF DOCX REQUESTED, WRITES MERGED DOCX
    if (outputType === "docx") {
      // keeps the merged DOCX in memory
      outBuffer = mergedDocx;
      // saves the merged DOCX and sets the output path to a .docx file
      filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${stamp}.docx`)}`;
      // if PDF requested
    } else if (outputType === "pdf") {
      /* IF PDF REQUESTED, DOCX -> PDF VIA CONVERTDOCXTOPDFBUFFER 
      B7c. converts merged DOCX to PDF via LibreOffice, stores that PDF Buffer in outBuffer */
      outBuffer = await convertDocxToPdfBuffer(mergedDocx);
      // sets a .pdf path
      filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${stamp}.pdf`)}`;
    } else if (outputType === "html") {
      // maps outputType = "html" to ContentType: "text/html" in the S3 PutObject switch
      outBuffer = await convertDocxToHtmlBuffer(mergedDocx);
      filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${stamp}.html`)}`;
    } else {
      // guards against unsupported outputs
      throw new Error("outputType must be 'docx' or 'pdf'");
    }
  }

  if (isHtml) {
    /* HTML PATH -> MUSTACHE, OPTIONAL JSDOM SANITIZATION, PUPPETEER TO PDF, LIBREOFFICE CLI
    TO DOCX
    C10. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): template processing
    B7. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): template processing
    B7a. detects .docx vs .html 
    HTML -> FILLED HTML - MERGE VIA MUSTACHE -> MERGED HTML (BUFFER)
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
    // PRODUCES PDF VIA PUPPETEER, DOCX VIA LO CLI, AND HTML AS IS
    if (outputType === "pdf") {
      //  B7c. converts HTML to PDF via Puppeteer
      outBuffer = await convertHtmlToPdfBuffer(finalHtml);
      filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${stamp}.pdf`)}`;
    } else if (outputType === "docx") {
      // B7c. converts HTML to DOCX via LibreOffice
      outBuffer = await convertHtmlToDocxBuffer(finalHtml);
      filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${stamp}.docx`)}`;
    } else if (outputType === "html") {
      // already returns the filled HTML as a Buffer
      outBuffer = finalHtml;
      filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${stamp}.html`)}`;
    } else {
      // guards against unsupported outputs
      throw new Error(
        "outputType must be 'docx','pdf', or 'html' for HTML templates"
      );
    }
  }

  /* WRITES OUTPUT TO OUTPUTS/ WITH A SAFE, TIMESTAMPED FILENAME 
  C11. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): output generation 
  B8. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): output generation
  B8a. writes results to outputs/ S3
  B8b. records a MergeJob in db for audit trail */
  const key = filePath.replace(/^s3:\/\/[^/]+\//, "");
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: outBuffer,
      ContentType:
        outputType === "pdf"
          ? "application/pdf"
          : outputType === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : outputType === "html"
              ? "text/html"
              : "application/octet-stream",
    })
  );

  /* PERSISTS MERGE RESULTS VIA PRISMA  
  CREATES A MERGEJOB ROW WITH PRISMA
  -  persists a merge job record, records success in MergeJob with metadata for audit/retrieval */
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

  return { jobId: job.id, filePath };
}

module.exports = { mergeTemplate };
