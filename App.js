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
const rateLimit = require("express-rate-limit");
const prisma = require("./prisma");
const addRequestId = require("express-request-id")();

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

// Request ID middleware - adds req.id to every request
app.use(addRequestId);

// times out long-running merges/conversions
app.use((req, res, next) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  next();
});

// clients don't need this header, and it leaks stack info, so better for security
app.disable("x-powered-by");

// RATE-LIMITING - protects upload and webhook endpoints from abuse
const uploadLimiter = rateLimit({
  // 15 minutes
  windowMs: 15 * 60 * 1000,
  // limit each IP to 10 uploads per window
  max: 10,
  message: "Too many uploads, please try again later",
});

const webhookLimiter = rateLimit({
  // 15 minutes
  windowMs: 15 * 60 * 1000,
  // webhooks might have a higher volume
  max: 100,
  message: "Too many webhook requests, please try again later",
});

app.use("/api/upload", uploadLimiter);
app.use("/api/webhooks", webhookLimiter);

/* INITIALIZES PASSPORT (JWT STRATEGY)
- before routes, initialize passport so merge.routes.js can authenticate */
app.use(passport.initialize());

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// BODY PARSERS (in intentional order)
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
B1. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): body parsing */
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

  server.close(async () => {
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

// GRACEFUL SHUTDOWN HANDLERS
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

/* SIGTERM - polite shutdown request usually sent by other programs, my platform, process managers/orchestrators,
             Unix "signal" that tells my Node process to stop, "terminate" covers prod stops/rollouts */
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// KEY LIBS: EXPRESS, DOTENV, PASSPORT SETUP
