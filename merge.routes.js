/* HTTP ROUTES FOR MERGING & WEBHOOKS
PUBLIC API SURFACE THAT CALLS INTO SERVICES: MERGE PATHS -> MERGE.SERVICE.JS
- wires in two data sources and feeds the merge engine 
- defines the JWT-protected upload download route, JWT-protected manual merge API, JWT-protected manual csv merge, 
  and HMAC-verified webhook API */
require("dotenv").config();
const express = require("express");
// imports my configured Passport instance with the JWT strategy I wired up to protect routes
const passport = require("passport");
/* Node's cryptography module that gives me access to low-level primitives like hashes, HMACs, ciphers, signatures, 
random bytes, and key derivation */
const crypto = require("crypto");
// central Multer config shared across routes
const { uploadCsv } = require("./upload.middleware");
const { parse } = require("csv-parse/sync");
// helper that looks up the template by templateId (db)
const { resolveTemplateFile } = require("./template.service");
// imports my merge function
const { mergeTemplate } = require("./merge.service");
const { s3, GetObjectCommand } = require("./s3");

const router = express.Router();

/* App.js's express.raw() leaves req.body as a Node buffer, raw bytes, for HMAC 
- every other route uses express.json() */
function verifyHmac(req, res, next) {
  /* client's x-signature header should be the same as the HMACed req.body the server will compute and 
      verify below
    C2. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): signature verification middleware */
  const sigHex = (req.get("x-signature") || "").trim();
  // short-circuits with a 401 if the required auth is missing or blank
  if (!sigHex) return res.status(401).json({ error: "Unauthorized" });
  // C3. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): raw body validation */
  const raw = req.body;

  // ensures raw is a Node Buffer i.e. the exact bytes received on the wire
  if (!Buffer.isBuffer(raw)) {
    // if it's not a buffer and is instead an object, reject the req
    return res.status(400).json({ error: "Webhook requires raw body" });
  }

  /* C4. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): HMAC computation & verification
    - C4a. server creates a HMAC context using SHA-256 hash and shared secret) */
  const expectedSignature = crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET)
    // feeds the raw req bytes from req.body into the HMAC hash
    .update(raw)
    // finalizes the computation and returns the binary signature as a Buffer
    .digest();

  let provided;

  try {
    // tries to decode the client's hex string; yields a Buffer of the signature bytes
    provided = Buffer.from(sigHex, "hex");
  } catch {
    // if sigHex is malformed, treat as bad credentials
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (
    // guards nullish cases
    !provided ||
    // lengths must match
    provided.length !== expectedSignature.length ||
    /* C4b. performs constant-time comparison of the two byte arrays to avoid timing side channels/ 
      timing leaks */
    !crypto.timingSafeEqual(provided, expectedSignature)
  ) {
    // C4c. any failure returns 401 unauthorized
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/* DOWNLOAD ROUTE 
- streams original uploaded file by templateId */
router.get(
  "/templates/:templateId/download",
  // tells Passport not to use server-side sessions, making the route stateless
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      // gets templateId path parameter
      const { templateId } = req.params;
      req.log.info({ templateId }, "Download request started");
      // helper that looks up the template by templateId (db)
      const info = await resolveTemplateFile(templateId);

      // if the db record doesn't exist, respond 404
      if (!info) return res.status(404).json({ error: "Template not found" });
      // if the db record exists but the file doesn't, also 404 with a clear message
      if (info.missing)
        return res
          .status(404)
          .json({ error: "Template file missing in storage" });

      // tells the client the MIME type to help the browser/client handle the file correctly
      res.setHeader("Content-Type", info.contentType);
      // advertise the exact byte length - useful for progress bars, proxies, range-handling
      res.setHeader("Content-Length", info.stat.size);
      // instructs the browser to download, not render inline, and suggest a filename
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${info.downloadName}"`
      );
      // AWS SDK v3, s3.send(...) executes the request
      const obj = await s3.send(
        // builds a GetObject request for...
        new GetObjectCommand({
          // the bucket in S3_BUCKET and...
          Bucket: process.env.S3_BUCKET,
          // the object key info.s3Key
          Key: info.s3Key,
        })
      );
      // attaches an error handler to the S3 body stream, if the underlying network/stream fails mid-transfer
      obj.Body.on("error", (err) => {
        // logs the error for diagnostics
        req.log.error({ err, templateId }, "S3 stream error");
        // if HTTP headers haven't been sent yet, reply with a 500 and end the response
        if (!res.headersSent) res.status(500).end();
        /* otherwise, headers already sent, likely mid-pipe (while a stream is actively piping data from
        a source to a destination), just end the connection to avoid a hung socket or partial garbage */ else
          res.end();
      });
      // streams the S3 object directly to the HTTP response
      obj.Body.pipe(res);
      // catches any other unexpected errors
    } catch (err) {
      req.log.error({ err, templateId }, "Download failed");
      // if I haven't sent headers yet, sends a 500 JSON error
      if (!res.headersSent) res.status(500).end();
      else res.end();
    }
  }
);

router.post(
  // POST endpoint that takes a templateId URL param
  "/templates/:templateId/merge-csv",
  // requires a valid JWT, and on success, Passport sets req.user with no server-side sessions
  passport.authenticate("jwt", { session: false }),
  // multer middleware that expects one uploaded file under the form field name csv
  uploadCsv.single("csv"),
  async (req, res) => {
    try {
      // pulls the templateId (i.e. which template to merge with) from the URL
      const { templateId } = req.params;
      // reads outputType from the JSON body; defaults to "pdf"
      const { outputType = "pdf" } = req.body || {};

      // validates outputType early
      if (!["pdf", "docx", "html"].includes(outputType)) {
        return res.status(400).json({
          error: "Invalid outputType. Use 'pdf', 'docx', or 'html'.",
        });
      }

      // ensures a CSV file was uploaded
      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({
          error:
            "No CSV file uploaded. Send multipart/form-data with field name 'csv'.",
        });
      }

      // gets the uploaded CSV file's bytes from req.file.buffer, and converts it to a UTF-8 string
      const csv = req.file?.buffer?.toString("utf8") ?? "";

      // empty text early-out
      if (!csv.trim()) {
        return res.status(400).json({ error: "Uploaded CSV is empty." });
      }

      // parse CSV -> rows
      let rows;
      try {
        // uses a CSV parser (e.g. csv-parse) to turn the CSV text into an array of objects
        rows = parse(csv, {
          // first row is headers; each subsequence row is an object keyed by header names
          columns: true,
          // ignore blank lines
          skip_empty_lines: true,
          // trim whitespace around fields
          trim: true,
        });
      } catch (parseErr) {
        return res.status(400).json({
          error: "Invalid CSV format",
          details: parseErr.message,
        });
      }

      // ensures at least one data row
      if (!Array.isArray(rows) || rows.length === 0) {
        // otherwise, bad request
        return res.status(400).json({
          error:
            "No data rows found in CSV. Include a header row and at least one data row.",
        });
      }
      req.log.info({ templateId, rowCount: rows.length }, "CSV merge started");
      // initializes an array jobs to collect results, and merges each row
      const jobs = [];
      // loops each parsed row
      for (const row of rows) {
        try {
          // calls core mergeTemplate service with...
          const job = await mergeTemplate({
            // which template to use
            templateId,
            // CSV row becomes key/value map for placeholders
            data: row,
            // e.g. "pdf" or "docx"
            outputType,
            // audit trail of who triggered the merge
            userId: req.user?.id,
          });
          // awaits each merge sequentially and pushes the returned { jobId, filePath } into jobs
          jobs.push(job);
        } catch (err) {
          // if the merge failed due to Docxtemplater tag problems
          if (err.message === "TEMPLATE_PARSE_ERROR" && err.details) {
            // responds with 422 Unprocessable Entity and structured details
            return res.status(422).json({
              error: "Template has invalid Docxtemplater tags",
              details: err.details,
            });
          }
          // bubble other errors to outer catch
          throw err;
        }
      }
      req.log.info(
        { templateId, rowCount: rows.length, jobCount: jobs.length },
        "CSV merge completed"
      );
      // sends JSON with the number of processed rows and the list of created jobs
      res.json({ count: rows.length, jobs });
    } catch (err) {
      req.log.error({ err, templateId }, "CSV merge failed");
      // otherwise, send 400 Bad Request with a simple error message
      res.status(400).json({ error: err.message });
    }
  }
);

/* *MANUAL MERGE (JWT) 
path: POST /api/templates/:templateId/merge; JWT-protected and then hands off to merge engine */
router.post(
  // path param :templateId selects which template to merge
  "/templates/:templateId/merge",
  // B2b. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      /* pulls templateId from req.params, selects which stored template to use 
      B3a. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler */
      const { templateId } = req.params;

      /* B3b & c. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler */
      const { data = {}, outputType = "docx" } = req.body || {};

      // logs the data
      req.log.info(
        {
          templateId,
          dataKeys: data && typeof data === "object" ? Object.keys(data) : data,
          outputType,
        },
        "Manual merge request started"
      );

      // B4. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): handoff to merge engine
      const result = await mergeTemplate({
        templateId,
        data,
        outputType,
        // tracks which user initiated manual merges
        userId: req.user?.id,
      });

      req.log.info({ templateId, outputType }, "Manual merge completed");
      /* B9. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): responses/errors 
      BLOCK EXECUTION ON MANUAL (JWT, INTERNAL USERS) ROUTE IF VALIDATION ERRORS OR DANGEROUS CONTENT */
      res.status(200).json(result);
      // type-check for normalized Docxtemplater error I created earlier
    } catch (err) {
      // ids my domain error, not any random error
      if (err.message === "TEMPLATE_PARSE_ERROR" && err.details) {
        // early-returns an HTTP 422 Unprocessable Entity with a machine-readable payload
        return res.status(422).json({
          error: "Template has invalid Docxtemplater tags",
          /* details lets clients pinpoint the exact tag issues (e.g. duplicate_open_tag, xtag, 
          file, offset) */
          details: err.details,
        });
      }
      // any other error gets logged and returns 400 bad request with a message if merge engine throws
      req.log.error({ err, templateId }, "Manual merge failed");
      res.status(400).json({ error: err.message });
    }
  }
);

/* WEBHOOK MERGE (HMAC) 
- SANITIZES INPUTS ON WEBHOOK (EXTERNAL SYSTEMS) ROUTE
- STILL HARD-BLOCKS EXECUTION ON CRITICAL VIOLATIONS (E.G. FAILED HMAC, SCHEMA MISMATCH, PATH TRAVERSAL LOGS, ETC.) */
router.post("/webhooks/templates/:templateId", verifyHmac, async (req, res) => {
  // runs the same merge path with the POST body as data
  /* C5. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): route handler execution
      C5a. templateId from URL */
  const { templateId } = req.params;
  // C5b. outputType read from query string
  const outputType = req.query.outputType || "pdf";
  req.log.info({ err, templateId, outputType }, "Webhook merge failed");
  // gets the request Content-Type (case-insensitive), normalize, and strip parameters (e.g. charset=utf-8)
  const ctype = (req.get("content-type") || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  let rows;
  const raw = req.body;

  try {
    /* only after signature verification, middleware parses the body 
    C5c. data from the parsed POST body, payload sent by the webhook caller */
    if (ctype.includes("text/csv")) {
      // C6. WEBHOOK DATA INGESTION (SHARED-SECRET HMAC): CSV parsing after verification
      const csv = raw.toString("utf8");
      rows = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      // if data from the parsed POST body is JSON and not csv
    } else if (ctype.includes("application/json")) {
      // C6. WEBHOOK DATA INGESTION (SHARED-SECRET HMAC): JSON parsing after verification
      const json = JSON.parse(raw.toString("utf8"));
      // if json is already an array, use it as-is, otherwise, wrap it in an array
      rows = Array.isArray(json) ? json : [json];
    } else {
      // unsupported media type
      return res.status(415).json({ error: "Unsupported content type" });
    }
  } catch {
    // if fails, client sent syntactically invalid JSON
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (rows.length > 1000)
    // payload too large
    return res.status(413).json({ error: "Too many rows" });

  try {
    // initializes containers for results and warnings
    const jobs = [];
    const aggregatedWarnings = [];
    // tracks row numbers for better warning messages
    let rowIndex = 0;
    // iterates through rows
    for (const row of rows) {
      rowIndex++;
      /* mergeTemplate loads the template file, renders placeholders with data, optionally 
        converts, writes the output file, optionally records a merge job, returns 
        { jobId, filePath } 

        C7. WEBHOOK DATA INGESTION (SHARED-SECRET HMAC): handoff to merge engine */
      const job = await mergeTemplate({
        templateId,
        data: row,
        outputType,
        userId: null,
        // lets the merge layer apply webhook-specific rules (i.e. sanitization)
        fromWebhook: true,
      });
      jobs.push(job);

      // if the merge returned warnings, collect them with the row number
      if (job.warnings && job.warnings.length) {
        aggregatedWarnings.push({ row: rowIndex, warnings: job.warnings });
      }
    }

    /* C11. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): response 
      responds with the result in JSON on success */
    res.json(
      aggregatedWarnings.length
        ? { count: rows.length, jobs, warnings: aggregatedWarnings }
        : { count: rows.length, jobs }
    );
    // responds with 422 meaning "Unprocessable" on failure
  } catch (err) {
    if (err.message === "TEMPLATE_PARSE_ERROR" && err.details) {
      return res.status(422).json({
        error: "Template has invalid Docxtemplater tags",
        details: err.details,
      });
    }
    console.error(`[${req.id}] Webhook merge error:`, err);
    // errors surface as 400 and bad signature returns 401
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

// KEY LIBS: EXPRESS, PASSPORT, CSV-PARSE/SYNC, CRYPTO, FS, MY MERGE.SERVICE
