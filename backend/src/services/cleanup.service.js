/* CLEANUP SERVICE - Scheduled cleanup for old merge outputs */

const prisma = require("../config/prisma");
const { s3, DeleteObjectCommand, withPrefix } = require("../storage/supabase-storage");
const logger = require("../config/logger");

// Default retention period for merge outputs (90 days)
const OUTPUT_RETENTION_DAYS = parseInt(process.env.OUTPUT_RETENTION_DAYS, 10) || 90;

/**
 * Delete old merge outputs (DB records + S3 files)
 * @param {number} retentionDays - Number of days to retain outputs
 * @returns {Promise<{deleted: number, errors: number}>}
 */
async function cleanupOldOutputs(retentionDays = OUTPUT_RETENTION_DAYS) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  let deleted = 0;
  let errors = 0;

  try {
    // Find old merge jobs
    const oldJobs = await prisma.mergeJob.findMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
      select: {
        id: true,
        filePath: true,
      },
    });

    logger.info({ count: oldJobs.length, retentionDays }, "Found old merge outputs");

    for (const job of oldJobs) {
      try {
        // Delete S3 file first
        if (job.filePath) {
          // Handle both s3:// prefix and raw paths
          const rawPath = job.filePath.replace(/^s3:\/\/[^/]+\//, "");
          const s3Key = withPrefix(rawPath);

          try {
            await s3.send(
              new DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: s3Key,
              })
            );
            logger.debug({ s3Key, jobId: job.id }, "Deleted S3 file for old output");
          } catch (s3Err) {
            // Log but continue - file might already be deleted
            logger.warn({ s3Err, s3Key, jobId: job.id }, "Failed to delete S3 output file");
          }
        }

        // Delete DB record
        await prisma.mergeJob.delete({
          where: { id: job.id },
        });

        deleted++;
        logger.debug({ jobId: job.id }, "Deleted old merge job");
      } catch (err) {
        errors++;
        logger.error(
          { err, jobId: job.id, filePath: job.filePath },
          "Failed to delete old merge job"
        );
      }
    }

    logger.info({ deleted, errors, retentionDays }, "Completed old outputs cleanup");
    return { deleted, errors };
  } catch (err) {
    logger.error({ err }, "Failed to query old merge jobs");
    throw err;
  }
}

/**
 * Run all cleanup tasks
 * @returns {Promise<{outputs: {deleted: number, errors: number}}>}
 */
async function runCleanup() {
  logger.info("Starting scheduled cleanup");

  const outputs = await cleanupOldOutputs();

  logger.info({ outputs }, "Cleanup completed");

  return { outputs };
}

module.exports = {
  cleanupOldOutputs,
  runCleanup,
  OUTPUT_RETENTION_DAYS,
};
