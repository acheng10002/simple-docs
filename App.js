/* *** APP.JS WIRES EVERYTHING, INCLUDING MIDDLEWARE:
PASSPORT -> ROUTES -> BODY PARSERS
- bootstraps Express and mounts routers 
-- routers - grouping of routes and middleware that can be mounted under a base path, here it's /api;
             modular "mini-apps"
- starts HTTP server
- entry point that ties routers together - /api/... -> merge.routes.js, templateUploadHandler.js 
-- body-parser - middleware that reads raw HTTP request body and populates req.body/req.file so that 
                 I can read them in handlers or decode them 
- middleware - function that sits in the req -> res pipline that can read/modify req and res objects and 
               run side effects like logging, auth checks, and db lookups, or decide what's next
- logging - recording useful facts about reach req/res (and errors) to a destination that cna inspected
- HTTP request body - data payload/byte stream sent after the request line and headers
- bye stream - sequence of bytes delivered over time
--- body-parser looks at Content-Type, reads/accumulates the request stream, parses it (JSON decode, form 
   decode,etc.), and enforce limits/encodings and throws on malformed input
--- body-parsers in my project: express.json() and express.raw({ type: 'application/json' })
--- not in project: express.urlencoded({ extended: true }) - parses classic HTML form posts/ regular 
    bodies */
// *** LOADS ENVS WITH DOTENV
require("dotenv").config();
// ** SERVER ENTRY POINT - backend framework that handles HTTP requests and response
const express = require("express");
// imports the passport property of passport.js
const { passport } = require("./passport");
// router for template ingestion & discovery
const uploadRouter = require("./templateUploadHandler");
// router for merge execution & webhook intake
const mergeRouter = require("./merge.routes");

/* *ENV SANITY CHECK
- startup validations for required env variables - fails fast if a critical secret/URL is missing */
const requiredEnvVars = ["JWT_SECRET", "WEBHOOK_SECRET", "DATABASE_URL"];
/* looks up each required key in process.env/ Node's env var object 
- keeps any key whose value is null or undefined in missing variable
- missing is an array of the missing variables' names */
const missing = requiredEnvVars.filter((k) => process.env[k] == null);
if (missing.length > 0) {
  /* if at least one required env var is missing, print an err to stderr 
  - every process has 3 std I/O streams:
  -- stdin - where a program reads from
  -- stdout - where a program writes its normal results
  -- stderr - where a program writes errors, warnings, progress, and logs */
  console.error("Missing required environment variables:", missing);
  /* abort the process with exit code 1, non-zero means failure 
  - process - currently running Node process (my app), the global Node.js process object
  - prevents server from starting in a broken config */
  process.exit(1);
}

// *** BUILDS AN EXPRESS APP
const app = express();

/* ***INITIALIZES PASSPORT (JWT STRATEGY)
- before routes, initialize passport so merge.routes.js can authenticate */
app.use(passport.initialize());

/* *** BODY PARSERS (in intentional order) 
- express.raw({ type: 'application/json' }) - RAW body parser so that I can hash the raw req.body 
                                              exactly as received for HMAC verification on webhook route
- express.raw() collects exact bytes of the HTTP body and makes them available as a Node Buffer 
  at req.body
- buffer - fixed-length chunk of raw bytes from file in memory */
const rawJson = express.raw({
  /* only requests with these Content-Types will be handled as raw Buffers by this middleware 
  - NOT HANDLED - Form posts: multipart/form-data, application/x-www-form-urlencoded
    Plain text: text/plain
    HTML/XML: text/html, application/xml, text/xml */
  type: ["application/json", "application/*+json", "text/csv"],
  // limit: "10mb",
});

/* *** MOUNTS ROUTERS 
- upload and merge endpoints live under /api
- webhooks need RAW bytes for /api/webhooks/ so I can HMAC the exact payload- needs to be mounted 
  first and only for that subtree 
C1. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): body parsing 
- when I read a file, fs.readFile, Node gives me a Buffer containing that file's bytes
- the file on disk -> bytes -> represented in Node as a Buffer */
app.use("/api/webhooks", rawJson);

/* enables JSON body parsing for all other routes
- adds size limit for safety 
B1. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): body parsing 
express.json() - parses application.json requests/regular bodies, Content-Type: application/json, 
                 into req.body for all routes other than webhook
                 manual merge route reads { data, outputType } from req.body
- express.json() decodes bytes to a string, parses them to a JS object, losing the original bytes */
app.use(express.json({ limit: "10mb" }));

// POST /api/upload - mounts the upload routes from ./templateUploadHandler under /api
app.use("/api", uploadRouter);
/* POST /api/templates/:templateId/merge, /api/webhooks, etc. - mounts the merge and download routes 
from ./merge.routes under /api */
app.use("/api", mergeRouter);

const PORT = process.env.PORT || 3000;

/* *** GRACEFUL SHUTDOWN HANDLERS 
- caching both of these handlers lets my server finish cleaning instead of dying mid-request
- close HTTP server, close db connections, flush logs (any log messages
still sitting in buffer actual get written to their destinations), delete temp files before exiting
SIGINT - sent when I press Ctrl+C in the terminal 
         Unix "signal" that tells my Node process to stop; "interrupt"
         covers local/dev workflows */
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

/* SIGTERM - polite shutdown request usually sent by other programs, my platform, process managers/orchestrators
             Unix "signal" that tells my Node process to stop; "terminate" 
             covers prod stops/rollouts */
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

/* *** STARTS HTTP SERVER 
- starts the server on port 3000 and logs the URL to the console */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

/* KEY LIBS HERE - EXPRESS, DOTENV, PASSPORT SETUP 
- WEBHOOK'S HMAC VERIFIER USES CRYPTO AND EXPRESS.RAW() BODY
- CSV INGESTION PATH USES MULTER + CSV-PARSE/SYNC + PRISMA AUDIT + MERGETEMPLATE 

RUNTIME DEPS 
- WEB SERVER & AUTH: EXPRESS*(backend framework for HTTP reqs and reses), PASSPORT*(authentication strategy), 
  PASSPORT-JWT(JWT strategy), DOTENV, JSONWEBTOKEN(TOKEN UTILITIES)
- UPLOAD & PARSING: MULTER*(middleware, async/await, that parses multipart/form-data of file uploads (the 
  incoming request)), FILE-TYPE*(function to inspect the file signature/first few bytes of a file's raw 
  binary data), CSV-PARSE
- HTML TEMPLATING/RENDERING/SANITIZATION: MUSTACHE, PUPPETEER, JSDOM*(body parser that gets 
  document.body.textContent-plain text-from HTML), PARSE5
- DOCX TEMPLATING & PARSING: PIZZIP, DOCXTEMPLATER*(DOCX -> merged DOCX templating engine), MAMMOTH*(body parser 
  that extracts plain text from DOCX)
- CONVERSIONS: LIBREOFFICE-CONVERT, CHILD_PROCESS (CLI), OS
- FS & UTILS: FS/PROMISES*(promise-based version of Node's file system that lets me do I/O operations cleanly), 
  PATH*(utilities for working with file and directory paths safely), UTIL
- CRYPTO/HMAC: CRYPTO*(Node's cryptography module that gives me access to low-level primitives like hashes, HMACs, 
  ciphers, signatures, random bytes, and key derivation )
- DATABASE: @PRISMA/CLIENT*(client to interact with my db where state is/data persists) */
