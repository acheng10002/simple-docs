/*TEXT & FIELD EXTRACTION FOR UPLOADS 
- service helpers used by the upload handler
- pulls plain text from .docx/.html, so I can regex the placeholders
- writes Template + Field[] rows/ db records that merge.service.js reads
TEMPLATE UPLOAD & PARSE - USE PARSER TO EXTRACT TEXT
mammoth module for server-side parsing of .DOCX files, extracting plain text from them */
const mammoth = require("mammoth");
/* JSDOM class from the jsdom library for parsing .HTML files
- lets me simulate a DOM environment from an HTML string in a Node.js context
- lets me parse and traverse HTML without a browser */
const { JSDOM } = require("jsdom");
// Prisma instance
const prisma = require("./prisma");
// path string utilities
const path = require("path");
// promise-based fileststem I/O
const fs = require("fs/promises");
// absolute path for all uploads
const { UPLOADS_DIR } = require("./paths");
// s3 instance
const { s3, HeadObjectCommand, withPrefix } = require("./s3");

// CONTENTTYPEFOR RETURNS DOCX OR HTML MIME
function contentTypeFor(name) {
  // returns Content-Type based on extension (use db mimeType if I later store it)
  const ext = path.extname(name).toLowerCase();
  if (ext === ".docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".html" || ext === ".htm") return "text/html";
  return "application/octet-stream";
}

// DOWNLOADNAMEFOR STRIPS TIMESTAMP PREFIX
function downloadNameFor(storedName) {
  // strips leading timestamp
  return storedName.replace(/^\d+-/, "");
}

/* *** RESOLVETEMPLATEFILE(ID) FINDS TEMPLATE IN DB, RESOLVES ABSOLUTE PATH WHERE UPLOADED
FILE LIVES, STATS FILE, DERIVES MIME TYPE, AND RETURNS A BUNDLE FOR DOWNLOAD
given a template id, gathers everything needed to serve/download the original file 
(metadata, file path, size, and headers) */
async function resolveTemplateFile(templateId) {
  // uses Prisma to fetch the Template row by primary key; the row should include the stored filename
  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  // if template doesn't exist, bail out so the caller can return 404 Not Found
  if (!tpl) return null;

  // builds absolute path where the uploaded file lives
  // const absPath = path.join(UPLOADS_DIR, tpl.name);

  /* ensures the file exists and gets its size for Content-Length 
  - uses Promise-based fs.stat to get fs metadata for absPath
  - if the path doesn't exist or the file is missing or unreadable, .catch returns null instead of throwing 
  - stat will be either a fs.stat object (truthy) if the path is accessible or null if it isn't */
  // const stat = await fs.stat(absPath).catch(() => null);
  /* if the file isn't on disk- db says it exist, but fs doesn't, return metadata plus a missing: true flag 
  so the caller can return a useful 404, like "Template file missing on disk" */
  // if (!stat) return { tpl, missing: true };

  /* S3 object lives under uploads/<name> 
  - builds the S3 object key (path inside the bucket)
  - tpl.name is the stored filename from my db 
  - result looks like: uploads/1699999999999-sample.html */
  const s3Key = withPrefix(`uploads/${tpl.name}`);
  // declares variable to hold the S3 object's metadata response
  let head;
  try {
    /* tries to probe S3 bucket for the object's existence and metadata using a HEAD request (no body downloaded) 
    - uses a cheap HeadObject to verify presence and size without downloading */
    head = await s3.send(
      // HeadObjectCommand asks S3: Does this key exist? If so, tell me its headers like size, Etag, etc.
      new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s3Key })
    );
  } catch {
    /* if S3 returns an error (e.g. NotFound, perms issue), the catch fires and I return a minimal shape saying
    the template exists in db (tpl) but is missing in storage */
    return { tpl, missing: true };
  }

  /* on success, returns a structured response my download route can use 
  - separates storage concerns (S3 key, size) from presentation concerns (MIME, download filename) */
  return {
    // db template record I looked up earlier (id, name, etc.)
    tpl,
    // full path to the template on disk
    // absPath,
    // file stats
    // stat,
    // where the file lives in S3 (used later to stream via GetObject)
    s3Key,
    /* emulate former shape: stat.size used by route for Content-Length 
    - head.ContentLength - byte size from S3 */
    stat: { size: Number(head.ContentLength || 0) },
    // MIME type derived from the file name
    contentType: contentTypeFor(tpl.name),
    // filename without the timestamp prefix
    downloadName: downloadNameFor(tpl.name),
  };
}

/* *** EXTRACTTEXTFROMBUFFER DISPATCHES TO MAMMOTH (DOCX) OR JSDOM (HTML)
extracts and returns raw text content from the buffer, depending on file type */
async function extractTextFromBuffer(buffer, mimeType) {
  if (
    // checks if file is a .docx file by matching its MIME type
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    /* A7a. TEMPLATE UPLOAD - INGESTION & DISCOVERY: extracts plain text for placeholder discovery in DOCX 
    *** USES MAMMOTH FOR PARSING .DOCX, EXTRACTS PLAIN TEXT FROM THE .DOCX FILE'S BUFFER
    - Mammoth reads text only (not raw XML) */
    const { value } = await mammoth.extractRawText({ buffer });
    // value contains extracted text
    return value;
  }

  if (mimeType === "text/html") {
    // if the file is html, converts the raw binary buffer into a UTF-8 string
    const html = buffer.toString();
    /* A7b. TEMPLATE UPLOAD - INGESTION & DISCOVERY: extracts plain text for placeholder discovery in HTML
    *** USES JSDOM FOR PARSING AND TRAVERSING HTML WITHOUT A BROWSER AND READS DOCUMENT.BODY.TEXTCONTENT
    - parses the HTML string into a virtual DOM tree using jsdom */
    const dom = new JSDOM(html);
    // extracts and returns only the text inside the HTML <body> tag; falls back to empty string if no text
    return dom.window.document.body.textContent || "";
  }

  // ensures unsupported formats are explicitly rejected
  throw new Error("Unsupported MIME type for parsing");
}

/* TEMPLATE UPLOAD & PARSE 
*** REGEX TO FIND {{ FIELD }} AND DE-DUPE
- extracts placeholder fields from the provided DOCX or HTML plain text 
- assumes placeholders are written in the format {{ fieldName }} */
function extractPlaceholders(text) {
  /* *PLACEHOLDER REGEX 
  - uses regex to find all substrings that match {{ something }}
  -returns an array of matches or an empty array if no matches found */
  const matches = text.match(/{{\s*([\w\.]+)\s*}}/g) || [];
  /* strips off {{ }} wrappers and trims whitespace from each placeholder
  - uses Set to remove duplicates
  - returns an array of unique placeholder names */
  return [...new Set(matches.map((m) => m.replace(/{{\s*|\s*}}/g, "")))];
}

/* *** CREATES TEMPLATE + NESTED FIELD[] VIA PRISMA
A9a. TEMPLATE UPLOAD - INGESTION & DISCOVERY: TEMPLATE UPLOAD & PARSE - STORES ORIGINAL FILE & 
STORES DETECTED FIELD NAMES
templateName - a string representing the name of the uploaded template file
fileNames - array of strings representing placeholder field names extracted from the doc */
async function storeTemplateAndFields(templateName, fieldNames) {
  // creates a new record in the Template table
  return await prisma.template.create({
    // RETURNS CREATED TEMPLATE OBJECT WITH ITS ASSOCIATED FIELDS, { TEMPLATEID, FIELDS[] }
    data: {
      name: templateName,
      fields: {
        /* instructs Prisma to create multiple Field records related to this template using nested writes 
        - for each field name string, creates an object */
        create: fieldNames.map((name) => ({ name })),
      },
    },
    // tells Prisma to include related fields in the response object
    include: {
      fields: true,
    },
  });
}

module.exports = {
  // for download route
  resolveTemplateFile,
  // for template upload route
  extractTextFromBuffer,
  // for tag discovery route
  extractPlaceholders,
  // for persisting template and its tags
  storeTemplateAndFields,
};

// KEY LIBS: MULTER, FILE-TYPE, FS/PROMISES, PATH, MAMMOTH, JSDOM
