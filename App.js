/* APP.JS WIRES EVERYTHING, INCLUDING MIDDLEWARE: PASSPORT -> ROUTES -> BODY PARSERS
LOADS ENVS WITH DOTENV  */
require("dotenv").config();
// SERVER ENTRY POINT - backend framework that handles HTTP requests and response
const express = require("express");
// imports the passport property of passport.js
const { passport } = require("./passport");
// router for template ingestion & discovery
const uploadRouter = require("./templateUploadHandler");
// router for merge execution & webhook intake
const mergeRouter = require("./merge.routes");

/* ENV CHECK
- startup validations for required env variables - fails fast if a critical secret/URL is missing */
const requiredEnvVars = ["JWT_SECRET", "WEBHOOK_SECRET", "DATABASE_URL"];
/* looks up each required key in process.env/ Node's env var object 
- keeps any key whose value is null or undefined in missing variable array */
const missing = requiredEnvVars.filter((k) => process.env[k] == null);
if (missing.length > 0) {
  /* if at least one required env var is missing, print an err to stderr 
  stderr - where a program writes errors, warnings, progress, and logs */
  console.error("Missing required environment variables:", missing);
  // abort the process with exit code 1, non-zero means failure
  process.exit(1);
}

// BUILDS AN EXPRESS APP
const app = express();

// times out long-running merges/conversions
app.use((req, res, next) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  next();
});

// clients don't need this header, and it leaks stack info, so better for security
app.disable("x-powered-by");

/* INITIALIZES PASSPORT (JWT STRATEGY)
- before routes, initialize passport so merge.routes.js can authenticate */
app.use(passport.initialize());

/* BODY PARSERS (in intentional order) 
- express.raw({ type: 'application/json' }) - RAW body parser so that I can hash the raw req.body 
                                              exactly as received for HMAC verification on webhook route
- express.raw() collects exact bytes of the HTTP body and makes them available as a Node Buffer 
  at req.body
- buffer - fixed-length chunk of raw bytes from file in memory */
const rawJson = express.raw({
  // only requests with these Content-Types will be handled as raw Buffers by this middleware
  type: ["application/json", "application/*+json", "text/csv"],
  // limit: "10mb",
});

/* MOUNTS ROUTERS 
- upload and merge endpoints live under /api, again webhooks need RAW bytes for /api/webhooks/ 
C1. WEBHOOK DATA INGESTION REQUEST LIFECYCLE (SHARED-SECRET HMAC): body parsing */
app.use("/api/webhooks", rawJson);

/* enables JSON body parsing for all other routes, adds size limit for safety 
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

// STARTS HTTP SERVER
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

async function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);

  ServerSideEncryption.close(async () => {
    console.log("HTTP server closed");
    await prisma.$disconnect();
    console.log("Database connections closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

/* GRACEFUL SHUTDOWN HANDLERS 
- caching both of these handlers lets my server finish cleaning instead of dying mid-request
- close HTTP server, close db connections, flush logs (any log messages still sitting in buffer actual get written 
  to their destinations), delete temp files before exiting
SIGINT - sent when I press Ctrl+C in the terminal, Unix "signal" that tells my Node process to stop, "interrupt"
         covers local/dev workflows */
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

/* SIGTERM - polite shutdown request usually sent by other programs, my platform, process managers/orchestrators,
             Unix "signal" that tells my Node process to stop, "terminate" covers prod stops/rollouts */
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// KEY LIBS: EXPRESS, DOTENV, PASSPORT SETUP
