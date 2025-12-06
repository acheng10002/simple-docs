/* APP.JS WIRES EVERYTHING, INCLUDING MIDDLEWARE: PASSPORT -> ROUTES -> BODY PARSERS
LOADS ENVS WITH DOTENV  */
require("dotenv").config();

// SENTRY MUST BE FIRST - captures all errors
const { initSentry, Sentry } = require("./sentry");
initSentry();
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
const addRequestId = require("express-request-id").default();
const logger = require("./logger");
const pinoHttp = require("pino-http");

/* ENV CHECK
- startup validations for required env variables - fails fast if a critical secret/URL is missing */
const requiredEnvVars = [
  "JWT_SECRET",
  "WEBHOOK_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "S3_BUCKET",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

// optional environment variables with defaults
const optionalEnvVars = {
  PORT: "3000",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
};

/* looks up each required key in process.env/ Node's env var object 
- keeps any key whose value is null or undefined in missing variable array */
const missing = requiredEnvVars.filter((k) => !process.env[k]?.trim());
if (missing.length > 0) {
  console.error("Missing required environment variables", missing);
  console.error("\nRequired variables:");
  console.error(" JWT_SECRET             - Secret key for JWT token signing");
  console.error(
    " WEBHOOK_SECRET         - Shared secret key for webhook HMAC verification"
  );
  console.error(
    " DATABASE_URL           - PostgreSQL connection string (pooled)"
  );
  console.error(
    " DIRECT_URL             - PostgreSQL connection string (direct)"
  );
  console.error(" S3_BUCKET              - AWS S3 bucket name");
  console.error(" AWS_REGION             - AWS region (e.g., us-east-1)");
  console.error(" AWS_ACCESS_KEY_ID      - AWS access key");
  console.error(" AWS_SECRET_ACCESS_KEY  - AWS secret key");
  // abort the process with exit code 1, non-zero means failure
  process.exit(1);
}

// validates S3_BUCKET format (lowercase alphanumeric with dots/hyphens)
if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(process.env.S3_BUCKET)) {
  console.error(`❌ Invalid S3_BUCKET format: ${process.env.S3_BUCKET}"`);
  console.error(
    "Bucket names must be lowercase alphanumeric with dots/hyphens only"
  );
  process.exit(1);
}

// validates AWS_REGION
const validRegions = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
];

if (!validRegions.includes(process.env.AWS_REGION)) {
  console.warn(`⚠️ Unusual AWS_REGION: "${process.env.AWS_REGION}"`);
  console.warn(`Common regions: ${validRegions.slice(0, 4).join(", ")}, ...`);
}

// sets defaults for optional variables
Object.entries(optionalEnvVars).forEach(([key, defaultVal]) => {
  if (!process.env[key]) {
    process.env[key] = defaultVal;
    console.log(`Using default ${key}=${defaultVal}`);
  }
});

console.log("✅ Environment validation passed");

// BUILDS AN EXPRESS APP
const app = express();

// Request ID middleware - adds req.id to every request
app.use(addRequestId);

// Sentry request handler - MUST be before routes
// app.use(Sentry.Handlers.requestHandler());

// Sentry tracing handler (performance monitoring)
// app.use(Sentry.Handlers.tracingHandler());

// structured logging middleware - adds req.log to every request
app.use(
  pinoHttp({
    logger: logger,
    // includes request ID in all logs
    customProps: (req) => ({
      requestId: req.id,
    }),
    // don't log health check endpoint to reduce noise
    autoLogging: {
      ignore: (req) => req.url === "/health",
    },
  })
);

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

// DEBUG: Test route for Sentry error capture (remove in prod)
app.get("/debug-sentry", (req, res) => {
  throw new Error("Test error for Sentry!");
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

// Sentry error handler - MUST be after routes, before other error handlers
// app.use(Sentry.Handlers.errorHandler());

Sentry.setupExpressErrorHandler(app);

// custom error handler for user-friendly responses
app.use((err, req, res, next) => {
  // Sentry will have already captured this error
  req.log.error({ err, sentryId: res.sentry }, "Unhandled error");

  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    // gives users this ID for support
    sentryId: res.sentry,
  });
});

const PORT = process.env.PORT || 3000;

// STARTS HTTP SERVER
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`);
});

async function gracefulShutdown(signal) {
  logger.info({ signal }, "Shutdown signal received, closing gracefully");

  server.close(async () => {
    logger.info("HTTP server closed");
    await prisma.$disconnect();
    logger.info("Database connections closed");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

// GRACEFUL SHUTDOWN HANDLERS
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

/* SIGTERM - polite shutdown request usually sent by other programs, my platform, process managers/orchestrators,
             Unix "signal" that tells my Node process to stop, "terminate" covers prod stops/rollouts */
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// KEY LIBS: EXPRESS, DOTENV, PASSPORT SETUP
