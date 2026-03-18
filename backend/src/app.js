/* APP.JS WIRES EVERYTHING, INCLUDING MIDDLEWARE: PASSPORT -> ROUTES -> BODY PARSERS
LOADS ENVS WITH DOTENV  */
require("dotenv").config();

const errorLogger = require("./utils/error-logger");
// SERVER ENTRY POINT - backend framework that handles HTTP requests and response
const express = require("express");
// router for template ingestion & discovery
const uploadRouter = require("./routes/template.routes");
// router for merge execution & webhook intake
const mergeRouter = require("./routes/merge.routes");
const authRouter = require("./routes/auth.routes");
const folderRouter = require("./routes/folder.routes");
const adminRouter = require("./routes/admin.routes");
const { createRateLimiter } = require("./middleware/rate-limiter");
const { getMemoryStats } = require("./middleware/memory-guard");
const { mergeLimiter: concurrencyLimiter } = require("./utils/concurrency");
const { templateCache } = require("./utils/templateCache");
const { resumePendingBatchJobs } = require("./services/batchJob.service");
const { getWorkerStats, shutdown: shutdownConversion } = require("./services/conversionService");
const { checkStorageHealth } = require("./storage/supabase-storage");
const prisma = require("./config/prisma");
const addRequestId = require("express-request-id").default();
const logger = require("./config/logger");
const pinoHttp = require("pino-http");
const cors = require("cors");

/* ENV CHECK
- startup validations for required env variables - fails fast if a critical secret/URL is missing */
const requiredEnvVars = [
  "JWT_SECRET",
  "WEBHOOK_SECRET",
  "CLEANUP_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
];

// optional environment variables with defaults
const optionalEnvVars = {
  PORT: "3000",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  OUTPUT_RETENTION_DAYS: "90",
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
    " CLEANUP_SECRET         - Secret key for scheduled cleanup endpoint"
  );
  console.error(
    " DATABASE_URL           - PostgreSQL connection string (pooled)"
  );
  console.error(
    " DIRECT_URL             - PostgreSQL connection string (direct)"
  );
  console.error(" SUPABASE_URL           - Supabase project URL");
  console.error(" SUPABASE_SERVICE_ROLE_KEY - Supabase service role key");
  console.error(" SUPABASE_ANON_KEY      - Supabase anonymous/public key");
  // abort the process with exit code 1, non-zero means failure
  process.exit(1);
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

// CORS configuration - only enabled in development
if (process.env.NODE_ENV !== "production") {
  app.use(
    cors({
      // frontend dev server
      origin: "http://localhost:5173",
      // allow cookies/auth headers
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  console.log("CORS enabled for development (localhost:5173)");
} else {
  console.log("CORS disabled - production uses same origin");
}

// RATE-LIMITING - protects upload and webhook endpoints from abuse (PostgreSQL-backed for multi-instance)
const uploadLimiter = createRateLimiter({
  // 15 minutes
  windowMs: 15 * 60 * 1000,
  // limit each IP to 10 uploads per window
  max: 10,
  message: "Too many uploads, please try again later",
}, "upload");

const webhookLimiter = createRateLimiter({
  // 15 minutes
  windowMs: 15 * 60 * 1000,
  // webhooks might have a higher volume
  max: 100,
  message: "Too many webhook requests, please try again later",
}, "webhook");

app.use("/api/upload", uploadLimiter);
app.use("/api/webhooks", webhookLimiter);

app.get("/health", async (req, res) => {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    // Check storage connectivity
    const storage = await checkStorageHealth();

    const memory = getMemoryStats();
    const concurrency = concurrencyLimiter.stats();
    const cache = templateCache.getStats();
    const worker = getWorkerStats();

    // Report degraded if storage is down but DB is up
    const status = storage.ok ? "healthy" : "degraded";

    res.status(storage.ok ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      database: { ok: true },
      storage,
      memory,
      concurrency,
      templateCache: cache,
      conversionWorker: worker,
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

// Auth routes first - login/register should not require authentication
app.use("/api", authRouter);
// Folder routes must come before template routes to match /templates/:id/move before /templates/:id
app.use("/api", folderRouter);
// POST /api/upload - mounts the upload routes from ./templateUploadHandler under /api
app.use("/api", uploadRouter);
/* POST /api/templates/:templateId/merge, /api/webhooks, etc. - mounts the merge and download routes
from ./merge.routes under /api */
app.use("/api", mergeRouter);
// Admin routes for scheduled tasks (cleanup, etc.)
app.use("/api", adminRouter);

app.use(errorLogger.expressErrorHandler);

const PORT = process.env.PORT || 3000;

// STARTS HTTP SERVER
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`);

  // Resume any pending batch jobs from previous server instance
  try {
    await resumePendingBatchJobs();
  } catch (err) {
    logger.error({ err }, "Failed to resume pending batch jobs");
  }
});

async function gracefulShutdown(signal) {
  logger.info({ signal }, "Shutdown signal received, closing gracefully");

  server.close(async () => {
    logger.info("HTTP server closed");

    // Shutdown conversion worker
    try {
      await shutdownConversion();
      logger.info("Conversion worker shutdown complete");
    } catch (err) {
      logger.warn({ err }, "Error shutting down conversion worker");
    }

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

// UNCAUGHT EXCEPTION HANDLER - last resort for unexpected errors
process.on("uncaughtException", (err, origin) => {
  logger.error({ err, origin }, "Uncaught exception - attempting graceful shutdown");

  // Attempt graceful shutdown, but with shorter timeout since we're in an unstable state
  server.close(() => {
    prisma.$disconnect().finally(() => {
      process.exit(1);
    });
  });

  // Force exit after 5s if graceful shutdown fails
  setTimeout(() => {
    logger.error("Forced exit after uncaught exception");
    process.exit(1);
  }, 5000);
});

// UNHANDLED REJECTION HANDLER - catches unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled promise rejection");
  // Don't exit - just log. Node.js 15+ treats these as uncaughtException by default,
  // but we log explicitly for visibility. Consider exiting in production if this becomes frequent.
});

// KEY LIBS: EXPRESS, DOTENV, PASSPORT SETUP
