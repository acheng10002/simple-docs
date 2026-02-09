/* HTTP ROUTES FOR MERGING & WEBHOOKS
PUBLIC API SURFACE THAT CALLS INTO SERVICES: MERGE PATHS -> MERGE.SERVICE.JS
- wires in two data sources and feeds the merge engine 
- defines the JWT-protected upload download route, JWT-protected manual merge API, JWT-protected manual csv merge, 
  and HMAC-verified webhook API */
require("dotenv").config();
const express = require("express");
const { createUserRateLimiter } = require("../middleware/rate-limiter");
// imports Supabase authentication middleware
const authenticateSupabase = require("../middleware/supabase-auth");
// concurrency limiter to prevent memory exhaustion from parallel merges
const { mergeLimiter: concurrencyLimiter } = require("../utils/concurrency");
// memory guard middleware to reject requests when memory is critically high
const { memoryGuard } = require("../middleware/memory-guard");
/* Node's cryptography module that gives me access to low-level primitives like hashes, HMACs, ciphers, signatures,
random bytes, and key derivation */
const crypto = require("crypto");
// central Multer config shared across routes
const { uploadCsv } = require("../middleware/upload.middleware");
const { parse } = require("csv-parse/sync");
const { sanitizeCsvRows } = require("../utils/csv-sanitizer");
// helper that looks up the template by templateId (db)
const { resolveTemplateFile } = require("../services/template.service");
// imports my merge function
const { mergeTemplate } = require("../services/merge.service");
// batch job service for hybrid CSV processing
const {
  shouldProcessInline,
  processRowsInline,
  createBatchJob,
  getBatchJobStatus,
  listBatchJobs,
} = require("../services/batchJob.service");
const { s3, GetObjectCommand, withPrefix } = require("../storage/supabase-storage");
const prisma = require("../config/prisma");

// Map of allowed output types per template MIME type
const ALLOWED_OUTPUTS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['pdf', 'docx', 'html', 'jpg'],
  'text/html': ['pdf', 'docx', 'html'],
  'application/pdf': ['pdf', 'jpg'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'pdf'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'ppsx', 'pdf', 'jpg'],
};

const router = express.Router();

// PostgreSQL-backed rate limiters for multi-instance support
const mergeLimiter = createUserRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many merge requests",
}, "merge");

const csvLimiter = createUserRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many CSV merge requests",
}, "csv_merge");

const downloadLimiter = createUserRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many download requests",
}, "download");

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
  authenticateSupabase,
  downloadLimiter,
  async (req, res) => {
    try {
      // gets templateId path parameter
      const { templateId } = req.params;
      req.log.info({ templateId }, "Download request started");

      if (!/^c[a-z0-9]{24}$/.test(templateId)) {
        return res.status(400).json({ error: "Invalid template ID format" });
      }

      // helper that looks up the template by templateId (db)
      const info = await resolveTemplateFile(templateId);

      // if the db record doesn't exist or doesn't belong to user, respond 404
      if (!info || info.tpl.uploadedById !== req.user.id) {
        return res.status(404).json({ error: "Template not found" });
      }
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
      // prevents MIME sniffing attacks
      res.setHeader("X-Content-Type-Options", "nosniff");
      // add CSP for HTML files to prevent script execution if opened in browser
      if (info.contentType === "text/html") {
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline';"
        );
      }
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
      // S3 stream with timeout and proper cleanup
      const stream = obj.Body;

      // sets 60-second timeout for downloads
      const timeout = setTimeout(() => {
        req.log.warn({ templateId }, "Download timeout - destroying stream");
        stream.destroy(new Error("Download timeout"));
        // if HTTP headers haven't been sent yet, reply with a 504 and end the response
        if (!res.headersSent) {
          res.status(504).json({ error: "Download timeout" });
        }
      }, 60000);

      // handles S3 stream errors
      stream.on("error", (err) => {
        clearTimeout(timeout);
        req.log.error({ err, templateId }, "S3 stream error");

        if (!res.headersSent) {
          res.status(500).json({ error: "Download failed" });
        } else {
          res.destroy();
        }
      });

      // handles client disconnect
      res.on("close", () => {
        if (!res.writableEnded) {
          clearTimeout(timeout);
          stream.destroy();
          req.log.info({ templateId }, "Download cancelled by client");
        }
      });

      // handles response errors
      res.on("error", (err) => {
        clearTimeout(timeout);
        stream.destroy();
        req.log.error({ err, templateId }, "Response stream error");
      });

      // cleans up on successful completion
      res.on("finish", () => {
        clearTimeout(timeout);
        req.log.info({ templateId }, "Download completed successfully");
      });

      // starts streaming
      stream.pipe(res);

      // catches any other unexpected errors
    } catch (err) {
      req.log.error({ err, templateId }, "Download failed");
      // if I haven't sent headers yet, sends a 500 JSON error
      if (!res.headersSent) res.status(500).end();
      else res.end();
    }
  }
);

/* GET /api/jobs
- lists all merge jobs for the authenticated user */
router.get(
  "/jobs",
  authenticateSupabase,
  downloadLimiter,
  async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const jobs = await prisma.mergeJob.findMany({
        where: {
          userId: userId,
        },
        select: {
          id: true,
          templateId: true,
          outputType: true,
          status: true,
          filePath: true,
          createdAt: true,
          // Explicitly exclude 'data' field to prevent PII exposure
          template: {
            select: {
              id: true,
              displayName: true,
              mimeType: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.json(jobs);
    } catch (err) {
      req.log.error({ err }, "Failed to fetch merge jobs");
      res.status(500).json({ error: "Failed to load merge jobs" });
    }
  }
);

/* DELETE /api/jobs/:id
- deletes a merge job and its output file */
router.delete(
  "/jobs/:id",
  authenticateSupabase,
  async (req, res) => {
    try {
      const jobId = parseInt(req.params.id, 10);
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (isNaN(jobId)) {
        return res.status(400).json({ error: "Invalid job ID" });
      }

      // Find the job and verify ownership
      const job = await prisma.mergeJob.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      if (job.userId !== userId) {
        return res.status(403).json({ error: "Forbidden - not your job" });
      }

      // Delete from S3 if file exists
      if (job.filePath) {
        try {
          const s3Key = withPrefix(job.filePath.replace(/^s3:\/\/[^/]+\//, ''));
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: s3Key,
            })
          );
          req.log.info({ jobId, s3Key }, "Deleted S3 output file");
        } catch (s3Err) {
          req.log.warn({ s3Err, jobId }, "Failed to delete S3 file, continuing with DB deletion");
        }
      }

      // Delete job from database
      await prisma.mergeJob.delete({
        where: { id: jobId },
      });

      req.log.info({ jobId }, "Merge job deleted");
      res.status(204).send();
    } catch (err) {
      req.log.error({ err, jobId: req.params.id }, "Failed to delete merge job");
      res.status(500).json({ error: "Failed to delete merge job" });
    }
  }
);

/* GET /api/download/:filePath
- downloads a merge output file from S3 */
router.get(
  "/download/:filePath(*)",
  authenticateSupabase,
  downloadLimiter,
  async (req, res) => {
    try {
      const { filePath } = req.params;

      if (!filePath) {
        return res.status(400).json({ error: "File path is required" });
      }

      // Reconstruct the full S3 URI for exact match against database
      // Database stores: s3://bucket/path, frontend sends: path (after stripping s3://bucket/)
      const fullS3Uri = `s3://${process.env.S3_BUCKET}/${filePath}`;

      // Verify the user owns a merge job with this EXACT file path
      const job = await prisma.mergeJob.findFirst({
        where: {
          filePath: fullS3Uri,
          userId: req.user.id,
        },
      });

      if (!job) {
        return res.status(404).json({ error: "File not found" });
      }

      req.log.info({ filePath }, "Merge output download request started");

      // Use the filePath directly as the S3 key (it already includes prefix from storage)
      const s3Key = filePath;

      try {
        const obj = await s3.send(
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: s3Key,
          })
        );

        // Determine content type from file extension
        let contentType = "application/octet-stream";
        if (filePath.endsWith(".pdf")) {
          contentType = "application/pdf";
        } else if (filePath.endsWith(".docx")) {
          contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        } else if (filePath.endsWith(".html")) {
          contentType = "text/html";
        } else if (filePath.endsWith(".xlsx")) {
          contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        } else if (filePath.endsWith(".pptx")) {
          contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        } else if (filePath.endsWith(".ppsx")) {
          contentType = "application/vnd.openxmlformats-officedocument.presentationml.slideshow";
        } else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
          contentType = "image/jpeg";
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filePath.split('/').pop()}"`);
        res.setHeader("X-Content-Type-Options", "nosniff");

        // Set Content-Length if available (enables progress bars, proxies, resumable downloads)
        if (obj.ContentLength) {
          res.setHeader("Content-Length", obj.ContentLength);
        }

        // Add CSP for HTML files to prevent script execution if opened in browser
        if (contentType === "text/html") {
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline';"
          );
        }

        // S3 stream with timeout
        const stream = obj.Body;
        const timeout = setTimeout(() => {
          req.log.warn({ filePath }, "Download timeout - destroying stream");
          stream.destroy(new Error("Download timeout"));
          if (!res.headersSent) {
            res.status(504).json({ error: "Download timeout" });
          }
        }, 60000);

        stream.on("error", (err) => {
          clearTimeout(timeout);
          req.log.error({ err, filePath }, "S3 stream error");
          if (!res.headersSent) {
            res.status(500).json({ error: "Download failed" });
          } else {
            res.destroy();
          }
        });

        res.on("close", () => {
          if (!res.writableEnded) {
            clearTimeout(timeout);
            stream.destroy();
            req.log.info({ filePath }, "Download cancelled by client");
          }
        });

        res.on("finish", () => {
          clearTimeout(timeout);
          req.log.info({ filePath }, "Download completed successfully");
        });

        stream.pipe(res);
      } catch (s3Err) {
        if (s3Err.name === "NoSuchKey") {
          return res.status(404).json({ error: "File not found" });
        }
        throw s3Err;
      }
    } catch (err) {
      req.log.error({ err, filePath: req.params.filePath }, "Download failed");
      if (!res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    }
  }
);

router.post(
  // POST endpoint that takes a templateId URL param
  "/templates/:templateId/merge-csv",
  // requires a valid JWT, and on success, Passport sets req.user with no server-side sessions
  authenticateSupabase,
  csvLimiter,
  memoryGuard,
  // multer middleware that expects one uploaded file under the form field name csv
  uploadCsv.single("csv"),
  async (req, res) => {
    try {
      // pulls the templateId (i.e. which template to merge with) from the URL
      const { templateId } = req.params;
      // reads outputType from the JSON body; defaults to "pdf"
      const { outputType = "pdf" } = req.body || {};

      if (!/^c[a-z0-9]{24}$/.test(templateId)) {
        return res.status(400).json({ error: "Invalid template ID format" });
      }

      // Fetch template to validate outputType against its format and ownership
      const template = await prisma.template.findUnique({
        where: { id: templateId },
      });

      // Check template exists and belongs to user
      if (!template || template.uploadedById !== req.user.id) {
        return res.status(404).json({ error: "Template not found" });
      }

      // Validate outputType is supported for this template's format
      const allowedOutputs = ALLOWED_OUTPUTS[template.mimeType];
      if (!allowedOutputs || !allowedOutputs.includes(outputType)) {
        return res.status(400).json({
          error: `Invalid outputType '${outputType}' for ${template.mimeType}. Allowed: ${allowedOutputs?.join(', ') || 'none'}`,
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
      let csv = req.file?.buffer?.toString("utf8") ?? "";

      // Remove BOM (Byte Order Mark) if present - common in Excel exports
      if (csv.charCodeAt(0) === 0xFEFF) {
        csv = csv.slice(1);
      }

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

      if (rows.length > 1000) {
        return res.status(413).json({
          error: "Too many rows. Maximum 1000 rows per CSV.",
        });
      }

      rows = sanitizeCsvRows(rows);

      req.log.info({ templateId, rowCount: rows.length }, "CSV merge started");

      // HYBRID ROUTING: Small batches inline, large batches queued
      if (shouldProcessInline(rows.length)) {
        // Process inline with bounded concurrency for small batches
        req.log.info({ templateId, rowCount: rows.length }, "Processing CSV inline");

        const results = await processRowsInline({
          templateId,
          rows,
          outputType,
          userId: req.user?.id,
        });

        // Check for template parse errors
        const parseError = results.find(
          r => !r.success && r.error?.includes("TEMPLATE_PARSE_ERROR")
        );
        if (parseError) {
          return res.status(422).json({
            error: "Template has invalid Docxtemplater tags",
            details: parseError.error,
          });
        }

        // Format response similar to original
        const jobs = results
          .filter(r => r.success)
          .map(r => r.job);
        const errors = results
          .filter(r => !r.success)
          .map(r => ({ rowIndex: r.rowIndex, error: r.error }));

        req.log.info(
          { templateId, rowCount: rows.length, successCount: jobs.length, errorCount: errors.length },
          "CSV merge completed (inline)"
        );

        res.json({
          count: rows.length,
          jobs,
          ...(errors.length > 0 ? { errors } : {}),
        });
      } else {
        // Queue for background processing for large batches
        req.log.info({ templateId, rowCount: rows.length }, "Queueing CSV for background processing");

        const batchJob = await createBatchJob({
          templateId,
          rows,
          outputType,
          userId: req.user?.id,
        });

        req.log.info(
          { templateId, rowCount: rows.length, batchJobId: batchJob.id },
          "CSV merge queued"
        );

        // Return 202 Accepted with batch job ID for polling
        res.status(202).json({
          message: "Batch job queued for processing",
          batchJobId: batchJob.id,
          totalRows: rows.length,
          statusUrl: `/api/batch-jobs/${batchJob.id}`,
        });
      }
    } catch (err) {
      req.log.error({ err, templateId: req.params.templateId }, "CSV merge failed");
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
  authenticateSupabase,
  mergeLimiter,
  memoryGuard,
  async (req, res) => {
    try {
      /* pulls templateId from req.params, selects which stored template to use
      B3a. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler */
      const { templateId } = req.params;

      /* B3b & c. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler */
      const { data = {}, outputType = "docx", testMode = false } = req.body || {};

      if (!/^c[a-z0-9]{24}$/.test(templateId)) {
        return res.status(400).json({ error: "Invalid template ID format" });
      }

      // Fetch template to validate outputType against its format and ownership
      const template = await prisma.template.findUnique({
        where: { id: templateId },
      });

      // Check template exists and belongs to user
      if (!template || template.uploadedById !== req.user.id) {
        return res.status(404).json({ error: "Template not found" });
      }

      // Validate outputType is supported for this template's format
      const allowedOutputs = ALLOWED_OUTPUTS[template.mimeType];
      if (!allowedOutputs || !allowedOutputs.includes(outputType)) {
        return res.status(400).json({
          error: `Invalid outputType '${outputType}' for ${template.mimeType}. Allowed: ${allowedOutputs?.join(', ') || 'none'}`,
        });
      }

      // MISSING: data type validation
      if (typeof data !== "object" || Array.isArray(data)) {
        return res.status(400).json({
          error: "Data must be an object with key-value pairs.",
        });
      }

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
      // Wrap in concurrency limiter to prevent memory exhaustion
      const result = await concurrencyLimiter.run(async () => {
        return mergeTemplate({
          templateId,
          data,
          outputType,
          // tracks which user initiated manual merges
          userId: req.user?.id,
          testMode: testMode === true || testMode === 'true',
        });
      });

      req.log.info({ templateId, outputType, testMode }, "Manual merge completed");

      // If test mode, return the file directly for download
      if (result.testMode) {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(result.buffer);
      }

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
      req.log.error({ err, templateId: req.params.templateId }, "Manual merge failed");
      res.status(400).json({ error: err.message });
    }
  }
);

/* GET /api/batch-jobs
- lists all batch jobs for the authenticated user */
router.get(
  "/batch-jobs",
  authenticateSupabase,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const offset = parseInt(req.query.offset, 10) || 0;

      const batchJobs = await listBatchJobs(userId, { limit, offset });
      res.json(batchJobs);
    } catch (err) {
      req.log.error({ err }, "Failed to list batch jobs");
      res.status(500).json({ error: "Failed to list batch jobs" });
    }
  }
);

/* GET /api/batch-jobs/:id
- gets status of a specific batch job */
router.get(
  "/batch-jobs/:id",
  authenticateSupabase,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const batchJob = await getBatchJobStatus(req.params.id, userId);
      if (!batchJob) {
        return res.status(404).json({ error: "Batch job not found" });
      }

      res.json(batchJob);
    } catch (err) {
      req.log.error({ err, batchJobId: req.params.id }, "Failed to get batch job status");
      res.status(500).json({ error: "Failed to get batch job status" });
    }
  }
);

/* WEBHOOK MERGE (HMAC)
- SANITIZES INPUTS ON WEBHOOK (EXTERNAL SYSTEMS) ROUTE
- STILL HARD-BLOCKS EXECUTION ON CRITICAL VIOLATIONS (E.G. FAILED HMAC, SCHEMA MISMATCH, PATH TRAVERSAL LOGS, ETC.) */
router.post("/webhooks/templates/:templateId", verifyHmac, memoryGuard, async (req, res) => {
  // runs the same merge path with the POST body as data
  /* C5. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): route handler execution
      C5a. templateId from URL */
  const { templateId } = req.params;
  // C5b. outputType read from query string
  const outputType = req.query.outputType || "pdf";

  if (!/^c[a-z0-9]{24}$/.test(templateId)) {
    return res.status(400).json({ error: "Invalid template ID format" });
  }

  // Fetch template to validate outputType against its format
  let template;
  try {
    template = await prisma.template.findUnique({
      where: { id: templateId },
    });
  } catch (err) {
    req.log.error({ err, templateId }, "Failed to fetch template");
    return res.status(500).json({ error: "Internal server error" });
  }

  if (!template) {
    return res.status(404).json({ error: "Template not found" });
  }

  // Validate outputType is supported for this template's format
  const allowedOutputs = ALLOWED_OUTPUTS[template.mimeType];
  if (!allowedOutputs || !allowedOutputs.includes(outputType)) {
    return res.status(400).json({
      error: `Invalid outputType '${outputType}' for ${template.mimeType}. Allowed: ${allowedOutputs?.join(', ') || 'none'}`,
    });
  }

  req.log.info({ templateId, outputType }, "Webhook merge started");
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

  rows = sanitizeCsvRows(rows);

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
      // Wrap in concurrency limiter to prevent memory exhaustion
      const job = await concurrencyLimiter.run(async () => {
        return mergeTemplate({
          templateId,
          data: row,
          outputType,
          userId: null,
          // lets the merge layer apply webhook-specific rules (i.e. sanitization)
          fromWebhook: true,
        });
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
    req.log.error({ err, templateId }, "Webhook merge failed");
    // errors surface as 400 and bad signature returns 401
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

// KEY LIBS: EXPRESS, PASSPORT, CSV-PARSE/SYNC, CRYPTO, FS, MY MERGE.SERVICE
