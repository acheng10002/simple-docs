/* TEMPLATE UPLOAD ENDPOINT (A PUBLIC API SURFACE) & PLACEHOLDER DISCOVERY 
- CALLS INTO SERVICES: UPLOAD PATH -> TEMPLATE.SERVICE.JS (PERSIST METADATA) AND LINTS (HTML: HTML-LINT.JS; DOCX: DOCX-TEMPLATING.JS)
- accepts .docx/.html uploads, validates file type, lints HTML & DOCX, extracts placeholders, AND THEN saves template 
  to disk and metadata to the db */
// backend framework that handles HTTP requests and response
const express = require("express");
// function that inspects the file signature part of a file's raw binary data
const FileType = require("file-type");
// module that provides utilities for working with file and directory paths safely
const path = require("path");
// middleware specific to template upload route
const { uploadTemplate } = require("./upload.middleware");
// service functions that produce the db records merge.service.js will read
const {
  extractTextFromBuffer,
  extractPlaceholders,
  storeTemplateAndFields,
} = require("./template.service.js");

// shared linter utilities
const { lintDocxBuffer } = require("./docx-templating");
const { lintHtmlBuffer } = require("./html-lint");
// s3 instance
const { s3, PutObjectCommand, withPrefix } = require("./s3");

// creates a new isolated router object
const router = express.Router();

/* MULTER
A1. TEMPLATE UPLOAD - INGESTION & DISCOVERY: multipart body parsing */

// allowed MIME types - docx and html
const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
];

// fallback map from known file exts to their expected MIME types if magic-byte MIME detection fails
const FALLBACK_MIME_MAP = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html",
};

/* upload route
- multer.memoryStorage() middleware, async/await (which runs before the route handler accepts a file)... 
-- gets plugged into this route
-- finds the field name named template (must match -F "template=@file", DOCX or HTML, or in curl)
-- and, for client-server alignment, populates:
--- req.file.buffer - raw file bytes, Buffer
--- req.file.originalname - e.g. sample.html
--- req.file.mimetype - e.g. text/html */
router.post("/upload", uploadTemplate.single("template"), async (req, res) => {
  try {
    /* gets the uploaded file from the request, and responds with 400 Bad Request if no file found 
    
    A2. TEMPLATE UPLOAD - INGESTION & DISCOVERY: basic request guard */
    const file = req.file;
    // POSSIBLE ERROR - no file sent
    if (!file) return res.status(400).send("No file uploaded");

    // MIME (detection & normalization
    const declared = (file.mimetype || "").toLowercase();
    const ext = path.extname(file.originalname).toLowercase();

    /* VALIDATES TYPE WITH FILE-TYPE + EXTENSION FALLBACKS
    MAGIC-BYTE MIME DETECTION (+FALLBACKS)
    inspects file's binary content, its file signature (magic bytes), and tries to infer/validate the MIME type 
    - file-type lib's fromBuffer function reads the  magic bytes, first N bytes 
    - file-type compares that byte pattern against a db of known file signatures (with known mappings to MIME types)
    - if a match is found, function returns an object with file extension and MIME type 
    
    A3. TEMPLATE UPLOAD - INGESTION & DISCOVERY: file type detection (magic bytes + fallback)
    TEMPLATE UPLOAD & PARSE - CHECKS MIME TYPE FROM UPLOAD (I have raw bytes in req.file.buffer)
    TEMPLATE UPLOAD & PARSE - VALIDATES FILE SIGNATURE WITH FILE-TYPE LIBRARY
    A3a. primary file type detection (magic bytes + fallback) */
    let fileType = await FileType.fromBuffer(file.buffer);

    /* extension-based fallback if fileTypeFromBuffer/magic-byte detection fails to detect MIME type from 
    the file's binary content; fallback executes regardless of ZIP status 
    A3b. fallback file type detection by extension (+zip signature for .docx) */
    if (!fileType) {
      // extracts file ext from uploaded file's original name and converts it to lowercase
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === ".docx") {
        const ZIP_MAGIC = "504b0304";
        /* extracts the first 4 bytes from the file's raw binary data, converts those 4 bytes into a hex,
        compares the result to the known ZIP magic number/file signature, and stores the boolean result */
        const isZip = file.buffer.slice(0, 4).toString("hex") === ZIP_MAGIC;
        /* for docx, if the file signature is ZIP_MAGIC and the file ext is recognized, assign a fallback MIME 
        type */
        if (isZip) {
          // sets a fileType object
          fileType = {
            // removes the leading dot bc file-type returns extensions without the dot
            ext: "docx",
            // returns the corresponding MIME type from the fallback map
            mime: FALLBACK_MIME_MAP[".docx"],
          };
        }
        // HTML relies on detection
      } else if (ext === ".html" || ext === ".htm") {
        fileType = {
          ext: ext.slice(1),
          mime: FALLBACK_MIME_MAP[".html"],
        };
      }
    }

    // cross-checks and finalizes
    const finalMime =
      fileType?.mime ||
      (ext === ".docx"
        ? FALLBACK_MIME_MAP[".docx"]
        : ext === "html" || ext === ".htm"
          ? FALLBACK_MIME_MAP[".html"]
          : null);

    /*  compares MIME types & if still no fileType or if file type not on the allowed list, reject

    A3c. allow-list enforcement */
    if (!finalMime || !ALLOWED_MIME_TYPES.includes(finalMime)) {
      //  POSSIBLE ERROR - type not allowed or MIME detection rejected the file
      return res.status(415).send("Unsupported or undetectable file type.");
    }

    if (declared && declared !== finalMime) {
      console.warn(
        `Declared mimetype ${declared} differs from computed ${finalMime}`
      );
    }

    /* BLOCKS EXECUTION ON DOCX/HTML TEMPLATE ROUTES IF TEMPLATES ARE INVALID
    HTML ONLY LINT - LINTS HTML WITH LINTHTMLBUFFER FROM HTML-LINT.JS 
    - blocks bad HTML
    A3d. lint HTML delimiters before saving anything (fail-fast) */
    if (fileType.ext === "html" || fileType.mime === "text/html") {
      // calls my HTML linter on the raw bytes, req.file.buffer
      const { errors, warnings } = lintHtmlBuffer(file.buffer, {
        // flag any http(s):// references as warnings
        allowRemote: false,
        // no requirePrintCss
        requirePrintCss: false,
      });
      // if there are warnings, log them to the server console but continue
      if (warnings.length) console.warn("HTML template warnings:", warnings);
      // if there are errors, fail fast, send 422 Unprocessable Entity with details
      if (errors.length) {
        return res.status(422).json({
          error: "Template blocked by HTML linter",
          details: errors,
        });
      }
    }

    /* DOCX ONLY LINT - LINTS DOCX WITH LINTDOCXBUFFER FROM DOCX-TEMPLATING.JS IN "ALLOW NULLS" MODE
    - blocks bad DOCX
    A3d. lint DOCX delimiters before saving anything (fail-fast) */
    if (fileType.ext === "docx") {
      // when upload hits my endpoint, DOCX linter will run
      const lint = lintDocxBuffer(file.buffer);
      if (lint.length) {
        return res.status(422).json({
          error: "Template has invalid Docxtemplater delimiters/tags",
          details: lint,
        });
      }
    }

    /* PERSIST & PARSE
    - { recursive: true } creates parents as needed and doesn't error if it already exists; 

    A4. TEMPLATE UPLOAD - INGESTION & DISCOVERY: sanitizes and timestamps user-supplied filename,
    making it safe 
    - path.basename(name) strips any directory paths which prevents path traversal 
    - regex replaces any char not in [A–Z a–z 0–9 _ . - space] with a _, yielding a fs-safe name */
    const sanitize = (name) => path.basename(name).replace(/[^\w.\- ]+/g, "_");
    // takes the original filename from the upload and sanitizes it
    const baseName = sanitize(file.originalname);
    /* prefixes the sanitized name with the current milliseconds to reduce collisions and orders
    files chronologically */
    const stamped = `${Date.now()}-${baseName}`;

    /* WRITES SANITIZED/TIMESTAMPED FILENAME TO UPLOADS_DIR VIA FS/PROMISES
    A5. TEMPLATE UPLOAD - INGESTION & DISCOVERY: persist original uploaded file 

    /* S3 upload of original template
    builds the object key (path/filename) that the file will have in my S3 bucket 
    - template literal inserts the timestamped filename, stamped, into uploads/ 
    - result with be /uploads/1696038435123-sample.html */
    const s3Key = withPrefix(`uploads/${stamped}`);
    // uses AWS SDK v3 client instance s3 to send a command
    await s3.send(
      // creates a PutObjectCommand i.e. upload this object to S3
      new PutObjectCommand({
        // options object includes name of the target S3 bucket pulled from my .env and...
        Bucket: process.env.S3_BUCKET,
        // the destination key in S# (path + filename)
        Key: s3Key,
        /* the actual bytes to upload, file buffer is the in-memory buffer I got from Multer's memoryStorage()
        - S3 will store these bytes as the object's content */
        Body: file.buffer,
        /* sets the object's Content-Type metadata 
        - this helps browsers and downstream services handle the file correctly (e.g. render vs download) */
        ContentType: fileType.mime,
      })
    );

    /* calls appropraite parser to pull plain text out of the uploaded file's binary buffer, using the MIME 
    type to choose the right parser: Mammoth extracts text from DOCX & JSDOM gets document.body.textContent 
    from HTML 
    
    TEXT EXTRACTION FOR PLACEHOLDER DISCOVERY
    A6. TEMPLATE UPLOAD - INGESTION & DISCOVERY: extracts plain text for placeholder discovery */
    const text = await extractTextFromBuffer(file.buffer, fileType.mime);
    /* runs regex helper to extract all {{...}} placeholders in that text; returns a deduped array of field names
    - supports dot paths like client.name 
    
    IDS & EXTRACTS THE PLACEHOLDERS VIA REG EXP 
    A7. TEMPLATE UPLOAD - INGESTION & DISCOVERY: extracts placeholders via regex and dedupes */
    const placeholders = extractPlaceholders(text);

    /* persists a new Template record with name = stamped and nested fields, Field[] (creates one Field[] row for 
       each placeholder)
    - Prisma call uses include: { fields: true }, so returned template object includes savedTemplate.fields 
    
    PERSIST TEMPLATE + FIELDS VIA PRISMA
    A8a. TEMPLATE UPLOAD - INGESTION & DISCOVERY: persists template metadata + fields */
    const savedTemplate = await storeTemplateAndFields(stamped, placeholders);

    // OUTPUT - JSON 200 returns templateId and deduped field names meaning upload and parse succeeded
    res.status(200).json({
      /* A8b. TEMPLATE UPLOAD - INGESTION & DISCOVERY: this templateId is what merge API uses later as
      db id of the newly saved template 
      A9. TEMPLATE UPLOAD - INGESTION & DISCOVERY: respond to client */
      templateId: savedTemplate.id,
      // names of the fields via .map(f => f.name)
      fields: savedTemplate.fields.map((f) => f.name),
      // confirms successful upload and validation of file signature
      message: `File "${file.originalname}" successfully uploaded and validated.`,
    });

    /* A10. TEMPLATE UPLOAD - INGESTION & DISCOVERY: error handling
    - catches and logs any unexpected server errors, unexpected issues return 500; validation failures already 
      exited with 400/415 */
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
