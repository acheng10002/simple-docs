/* **HTTP ROUTES FOR MERGING & WEBHOOKS
*** MERGE.ROUTES.JS IS A PUBLIC API SURFACE
- CALLS INTO SERVICES: MERGE PATHS -> MERGE.SERVICE.JS
- wires in two data sources and feeds the merge engine 
- defines the JWT-protected upload download route, JWT-protected manual merge API, JWT-protected manual csv merge, 
  and HMAC-verified webhook API 
- consumes a templateId + data to produce the final DOCX/PDF */
require("dotenv").config();
// imports Express so I can create a router
const express = require("express");
// imports my configured Passport instance with the JWT strategy I wired up to protect routes
const passport = require("passport");
/* Node's cryptography module that gives me access to low-level primitives like hashes, HMACs, ciphers, signatures, 
random bytes, and key derivation */
const crypto = require("crypto");
// for createReadStream
const fs = require("fs");
// central Multer config shared across routes
const { uploadCsv } = require("./upload.middleware");
// CSV body parser
const { parse } = require("csv-parse/sync");
// helper that looks up the template by templateId (db)
const { resolveTemplateFile } = require("./template.service");
// imports my merge function
const { mergeTemplate } = require("./merge.service");
const { s3, GetObjectCommand } = require("./s3");

// creates a new isolated router object
const router = express.Router();

/* App.js's express.raw() leaves req.body as a Node buffer, raw bytes, for HMAC that way the server can:
-- compute an HMAC over the exact bytes, exact payload, received at the webhook
--- both the sender/client and the receiver/my server share the same secret and compute 
    HMAC(secret, raw_body); HMAC signature technique is symmetric and can be used to sign on any 
    bytes, including my webhook's raw body
--- every other route uses express.json() 
-- pass buffers to libraries that need binary data e.g. Docxtemplater */
function verifyHmac(req, res, next) {
  /* requires a non-empty HTTP request header from the client, x-signature header, in Express
    - it's a normalized string, either a trimmed hex digest or ""
    - hex digest - output of a hash.MAC function encoded as hexadecimal text that's a one-way
                   fingerprint 
    - client's x-signature header should be the same as the HMACed req.body the server will compute and 
      verify below
    C2. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): signature verification middleware */
  const sigHex = (req.get("x-signature") || "").trim();
  // short-circuits with a 401 if the required auth is missing or blank
  if (!sigHex) return res.status(401).json({ error: "Unauthorized" });
  /* - data location - req.body itself; entire payload is data 
    
  C3. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): raw body validation */
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
      timing leaks
      - timing side channels - when an attacker learns something about a secret by measuring how long
                               my code takes to run 
      - verifies the signature in constant time, then parses JSON only after HMAC passes,
        and then merges */
    !crypto.timingSafeEqual(provided, expectedSignature)
  ) {
    // C4c. any failure returns 401 unauthorized
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/* *DOWNLOAD ROUTE 
- streams original uploaded file by templateId 
streaming - sending the file to the client in chunks as it's read from disk instead of
            first loading the whole thing into memory and then sending it */
router.get(
  "/templates/:templateId/download",
  /* tells Passport not to use server-side sessions, making the route stateless 
  - APIs with JWTs should be stateless 
  - middleware requires a valid JWT in Authorization: Bearer <token> */
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      // gets templateId path parameter
      const { templateId } = req.params;
      /* helper that looks up the template by templateId (db) 
      - builds the absolute path to the file on disk 
      - stat the file on disk (size, existence) 
      -- stat - call the OS's stat system call to fetch the file's metadata
      - decides content type (DOCX vs HTML)
      - compute a download filename */
      const info = await resolveTemplateFile(templateId);

      // if the db record doesn't exist, respond 404
      if (!info) return res.status(404).json({ error: "Template not found" });
      // if the db record exists but the file is gone on disk, also 404 with a clear message
      if (info.missing)
        return res.status(404).json({ error: "Template file missing on disk" });

      /* tells the client the MIME type to help the browser/client handle the file correctly 
      - MIME type - external label used in HTTP headers and metadata  */
      res.setHeader("Content-Type", info.contentType);
      /* advertise the exact byte length - useful for progress bars, proxies, range-handling 
      - proxy - network middle-box that sits between clients and my app
                forward proxy (VPN) - relays outbound client traffic
                reverse proxy/CDN - sits in front of my app and handles TLS (HTTPS runs on TLS 
                                    security protocol that protects data in transit), caching, 
                                    compression, buffering, rate-limits  
                CDN - globally distributed network of servers that sits in front of my app as a
                      reverse proxy and gets content to users fast and reliably
      range-handling - lets clients fetch just a slice of file
                     - for resumable downloads i.e. continue after a network drop
                     - media scrubbing i.e. jump to minute 23 in a video
                     - multi-threaded downloaders - parallel byte ranges 
      - 1 file = N byte ranges
      - Create N workers for threads (each one a lightweight execution unit inside a process)/ 
        async tasks 
      - Each worker: GET /file with Range: bytes=start-end 
      - Write the response at that file offset
      - When all done, I have the fulle file */
      res.setHeader("Content-Length", info.stat.size);
      // instructs the browser to download, not render inline, and suggest a filename
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${info.downloadName}"`
      );
      /* open a readable stream from the file 
      fs.createReadStream - in Node, readable stream gets piped to the HTTP response
      - streaming is memory-efficient, no loading whole file into RAM 
      - streams the file over a single HTTP response, and runs on Node's single-threaded event loop;
        one sequential stream */
      // fs.createReadStream(info.absPath)
      // if the stream errors e.g. file disappears mid-transfer
      // .on("error", (err) => {
      // log it
      // console.error("Download stream error:", err);
      // if headers haven't been sent yet, return 500, Internal Service Error
      // if (!res.headersSent) res.status(500).end();
      // otherwise, end the response to avoid corrupting output
      // else res.end();
      // })
      // pipe the file stream directly to the HTTP response
      // .pipe(res);
      /* AWS SDK v3, s3.send(...) executes the request 
      - on success, obj is the response metadata plus a streaming body at obj.Body
      Body - Node.js's readable stream of the object's bytes */
      const obj = await s3.send(
        // builds a GetObject request for...
        new GetObjectCommand({
          // the bucket in S3_BUCKET and...
          Bucket: process.env.S3_BUCKET,
          // the object key info.s3Key
          Key: info.s3Key,
        })
      );
      /* attaches an error handler to the S3 body stream; if the underlying network/stream 
      fails mid-transfer: */
      obj.Body.on("error", (err) => {
        // logs the error for diagnostics
        console.error("S3 stream error:", err);
        // if HTTP headers haven't been sent yet, reply with a 500 and end the response
        if (!res.headersSent) res.status(500).end();
        /* otherwise, headers already sent, likely mid-pipe (while a stream is actively piping data from
        a source to a destination), just end the connection to avoid a hung 
        socket or partial garbage */ else res.end();
      });
      /* streams the S3 object directly to the HTTP response
      pipe - forwards data chunk-by-chunk (constant memory), so the whole file isn't buffered in RAM */
      obj.Body.pipe(res);
      // catches any other unexpected errors
    } catch (err) {
      console.error("Download error (S3):", err);
      // if I haven't sent headers yet, sends a 500 JSON error
      if (!res.headersSent) res.status(500).end();
      else res.end();
    }
  }
);

router.post(
  // POST endpoint that takes a templateId URL param
  "/templates/:templateId/merge-csv",
  // requires a valid JWT, and on success, Passort sets req.user with no server-side sessions
  passport.authenticate("jwt", { session: false }),
  /* multer middleware that expects one uploaded file under the form field name csv
  - puts the file bytes in req.file.buffer */
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

      /* gets the uploaded CSV file's bytes from req.file.buffer, and converts it to a UTF-8 string 
      - if absent, falls back to "" */
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
      // sends JSON with the number of processed rows and the list of created jobs
      res.json({ count: rows.length, jobs });
    } catch (err) {
      console.error("CSV merge error:", err);
      // otherwise, send 400 Bad Request with a simple error message
      res.status(400).json({ error: err.message });
    }
  }
);

/* *MANUAL MERGE (JWT) 
- manual data input - for manual merges initiated by users/services
path: POST /api/templates/:templateId/merge; JWT-protected and then hands off to merge engine
- "This bearer (user) presents a signed passport describing who they are and what they
  can do, valid until it expires"
- caller: trusted clients of my app */
router.post(
  // path param :templateId selects which template to merge
  "/templates/:templateId/merge",
  /* - authentication mechanism: JWT Bearer
  - auth mechanism proves user/session identity and claims
  - identity available: req.user looked up via Prisma

  requires a valid Bearer token; on success 
  B2b. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware */
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    try {
      /* pulls templateId from req.params; selects which stored template to use 
      B3a. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler */
      const { templateId } = req.params;

      /* B3b. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler 
      pulls client-sent data, the key/value map that satisfies template's placeholders
      and pulls outputType 
      B3c. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): route handler 
      - outputType is either docx or pdf from req.body, which is JSON, default is docx
      - reads { data, outputType } 
      - data location - req.body.data (key-value map) 
      - output type - req.body.outputType (default "docx") */
      const { data = {}, outputType = "docx" } = req.body || {};

      // logs the data
      console.log(
        "merge data keys:",
        data && typeof data === "object" ? Object.keys(data) : data
      );

      /* mergeTemplate 
      - loads the template file...
      (- renders placeholders with data (Docxtemplater or Mustache)
      - optionally converts to PDF (LibreOffice/Puppeteer)
      - writes the output file
      - records a  merge job
      - returns { jobId, filePath }) 
      
      B4. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): handoff to merge engine */
      const result = await mergeTemplate({
        templateId,
        data,
        outputType,
        // tracks which user initiated manual merges
        userId: req.user?.id,
      });
      /* responds with 200 OK and the result in JSON on success 
      - returns { jobId, filePath } 
      
      B9. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): responses/errors 
      BLOCK EXECUTION ON MANUAL (JWT, INTERNAL USERS) ROUTE IF VALIDATION ERRORS OR DANGEROUS CONTENT */
      res.status(200).json(result);
      // type-check for normalized Docxtemplater error I created earlier
    } catch (err) {
      /* ids my domain error, not any random error 
      - err.details - ensures I actually have the structured list of parsing problems to return */
      if (err.message === "TEMPLATE_PARSE_ERROR" && err.details) {
        /* early-returna an HTTP 422 Unprocessable Entity with a machine-readable payload
        - 422 means the request is syntactically valid JSON, but the template content is invalid
          for processing */
        return res.status(422).json({
          error: "Template has invalid Docxtemplater tags",
          /* details lets clients pinpoint the exact tag issues (e.g. duplicate_open_tag, xtag, 
          file, offset) */
          details: err.details,
        });
      }
      /* any other error gets logged and returns 400 bad request with a message if merge engine throws 
      - I/O errors, conversion failures, auth issues, template missing, bad outputType, conversion 
        error, unexpected bugs etc. */
      console.error("Merge error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

/* *WEBHOOK MERGE (HMAC) 
- webhook data ingestion - for system-to-system merges triggered by events
- path: POST /api/webhooks/templates/:templateId - optional: webhook route (using shared secret)
- "This exact HTTP message came from someone who knows the secret"
- webhook - way for one system to send real-time data or notifications to another system by making 
            a POST HTTP request to a URL I control the moment an event happens 
- caller: external system sending events
- an event occurs: file uploaded, payment received, merge job complete, etc.
- the sender/client calls the receiver/server endpoint/ this public URL route on my server when the 
  event occurs
- the call to this route includes a JSON body describing the event, plus headers for 
  authentication/signing 
-- sender/client computes HMAC over the exact req bytes and sends either raw JSON body or CSV body 
   and the x-signature header 
- SANITIZES INPUTS ON WEBHOOK (EXTERNAL SYSTEMS) ROUTE
- STILL HARD-BLOCKS EXECUTION ON CRITICAL VIOLATIONS (E.G. FAILED HMAC, SCHEMA MISMATCH, PATH TRAVERSAL
- LOGS AND ) */
router.post("/webhooks/templates/:templateId", verifyHmac, async (req, res) => {
  // runs the same merge path with the POST body as data
  /* C5. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): route handler execution
      C5a. templateId from URL */
  const { templateId } = req.params;

  /* - output type - req.query.outputType (default "pdf") 
  C5b. outputType read from query string */
  const outputType = req.query.outputType || "pdf";

  // gets and lowercase the request Content-Type from the req headers
  const ctype = (req.get("content-type") || "").toLowerCase();
  let rows;
  const raw = req.body;

  try {
    /* only after signature verification, middleware parses the body 
    - webhook HMAC checks authenticity of the incoming JSON body
    - security principle- verify first, then parse 
    C5c. data from the parsed POST body, payload sent by the webhook caller */
    if (ctype.includes("text/csv")) {
      /* C6. WEBHOOK DATA INGESTION (SHARED-SECRET HMAC): CSV parsing after verification  
      - use CSV parser after verification */
      const csv = raw.toString("utf8");
      rows = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      // if data from the parsed POST body is JSON and not csv
    } else if (ctype.includes("application/json")) {
      /* C6. WEBHOOK DATA INGESTION (SHARED-SECRET HMAC): JSON parsing after verification 
      - webhook route defers parsing until after the signature is verified and then calls
        JSON.parse(...) */
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
        - same merge pipeline and response contract as the manual path 
        - same mergeTemplate() function handles both JWT and webhook flows 

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
      responds with the result in JSON on success 
      - success response, number of processed rows and list of job records
      - includes aggregated warnings if any */
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
    console.error("Webhook merge error:", err);
    // errors surface as 400 and bad signature returns 401
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

/* replay protection - way to reject a validly signed request that's been
captured and resent by an attacker 

Manual - blocking; authors get immediate feedback and keep full control, no silent changes
Webhook - sanitizing; external senders aren't blocked for minor issues; I still protect
          downstream renderers and keep SLAs 
          
small HTTP API that lets me:
- UPLOAD TEMPLATES; .docx or .html
  POST /api/upload
- discover placeholders in those templates
- *** MANUAL MERGE (JWT); of user data into templates
  POST /api/templates/:templateId/merge
  - JSON BODY { DATA, OUTPUTTYPE }
  - CALLS MERGETEMPLATE()
  - NORMALIZES DOCXTEMPLATER PARSE ERRORS INTO 422 WITH DETAILS
  *** CSV MERGE (JWT)
  POST /api/templates/:templateId/merge-csv
  - UPLOADS CSV VIA UPLOADCSV (MULTER)
  - PARSES CSV WITH CSV-PARSE/SYNC
  - CALLS MERGETEMPLATE() PER ROW; RETURNS A LIST OF JOBS
- *** DOWNLOAD ORIGINAL TEMPLATE (JWT)
  GET /api/templates/:templateId/download
  - USES RESOLVETEMPLATEFILE() TO STREAM ORIGINAL UPLOAD TO THE CLIENT VIA FS.CREATEREADSTREAM
- *** WEBHOOK MERGE (HMAC) 
  POST /api/webhooks/templates/:templateId 
  - HMAC VERIFICATION (VERIFYHMAC) ON RAW BODY USING CRYPTO
  - ACCEPTS RAW CSV OR RAW JSON (ARRAY OR SINGLE OBJECT)
  - CALLS MERGETEMPLATE() FOR EACH ROW/OBJECT WITH FROMWEBHOOK: TRUE (ENABLES EXTRA SANITIZATION
    IN THE HTML PATH)
  - RETURNS JOBS (+ AGGREGATED WARNINGS IF ANY)
- converts outputs to PDF/DOCX/HTML 
- audit merges in a db 

two merge entry points: JWT-protected manual route and HMAC-verified webhook route
- both routes support two templating stacks:
-- DOCX VIA PIZZIP + DOCXTEMPLATER (with strong error normalization)
-- HTML VIA MUSTACHE, optionally santitized with JSDOM, and rendered TO PDF WITH PUPPETEER
   or converted TO DOCX WITH LIBREOFFICE CLI (wrapped via child_process.spawn) 
state- templates, fields, jobs, and users- is persisted with Prisma 

KEY LIBS: EXPRESS, PASSPORT, CSV-PARSE/SYNC, CRYPTO, FS, MY MERGE.SERVICE */
