/* ADMIN ROUTES - Protected endpoints for administrative tasks
   Includes scheduled cleanup endpoint for GitHub Actions */

const express = require("express");
const { runCleanup, OUTPUT_RETENTION_DAYS } = require("../services/cleanup.service");
const { errorResponse, ErrorCodes } = require("../utils/errorResponse");

const router = express.Router();

/**
 * Middleware to verify cleanup secret
 * Protects admin endpoints from unauthorized access
 */
function verifyCleanupSecret(req, res, next) {
  const authHeader = req.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return errorResponse.unauthorized(res, "Missing authorization token", ErrorCodes.UNAUTHORIZED);
  }

  if (token !== process.env.CLEANUP_SECRET) {
    req.log.warn({ ip: req.ip }, "Invalid cleanup secret attempted");
    return errorResponse.forbidden(res, "Invalid authorization token", ErrorCodes.FORBIDDEN);
  }

  next();
}

/**
 * POST /api/admin/cleanup
 * Runs cleanup for old merge outputs
 * Protected by CLEANUP_SECRET
 */
router.post("/admin/cleanup", verifyCleanupSecret, async (req, res) => {
  try {
    req.log.info("Cleanup endpoint triggered");

    const result = await runCleanup();

    res.json({
      success: true,
      message: "Cleanup completed",
      result: {
        mergeOutputs: {
          deleted: result.outputs.deleted,
          errors: result.outputs.errors,
          retentionDays: OUTPUT_RETENTION_DAYS,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Cleanup endpoint failed");
    errorResponse.internal(res, "Cleanup failed", { details: err.message });
  }
});

/**
 * GET /api/admin/health
 * Simple health check for admin endpoints
 * Protected by CLEANUP_SECRET
 */
router.get("/admin/health", verifyCleanupSecret, (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
