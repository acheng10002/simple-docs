/* ADMIN ROUTES - Protected endpoints for administrative tasks
   Includes scheduled cleanup endpoint for GitHub Actions */

const express = require("express");
const { runCleanup, OUTPUT_RETENTION_DAYS } = require("../services/cleanup.service");

const router = express.Router();

/**
 * Middleware to verify cleanup secret
 * Protects admin endpoints from unauthorized access
 */
function verifyCleanupSecret(req, res, next) {
  const authHeader = req.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  if (token !== process.env.CLEANUP_SECRET) {
    req.log.warn({ ip: req.ip }, "Invalid cleanup secret attempted");
    return res.status(403).json({ error: "Invalid authorization token" });
  }

  next();
}

/**
 * POST /api/admin/cleanup
 * Runs cleanup for expired template versions and old merge outputs
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
        templateVersions: {
          deleted: result.versions.deleted,
          errors: result.versions.errors,
        },
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
    res.status(500).json({
      success: false,
      error: "Cleanup failed",
      message: err.message,
    });
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
