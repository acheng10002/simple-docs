/* BATCH JOB SERVICE
Handles background processing of large CSV merge jobs */

const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { mergeTemplate } = require('./merge.service');
const { mergeLimiter: concurrencyLimiter } = require('../utils/concurrency');

// Threshold for inline vs background processing
const INLINE_THRESHOLD = parseInt(process.env.BATCH_INLINE_THRESHOLD, 10) || 10;

// Bounded concurrency for inline processing (process multiple rows in parallel)
const INLINE_CONCURRENCY = parseInt(process.env.BATCH_INLINE_CONCURRENCY, 10) || 3;

/**
 * Determine if rows should be processed inline or queued
 * @param {number} rowCount - Number of rows to process
 * @returns {boolean} - true if should process inline
 */
function shouldProcessInline(rowCount) {
  return rowCount <= INLINE_THRESHOLD;
}

/**
 * Process rows inline with bounded concurrency
 * @param {Object} params - Processing parameters
 * @returns {Promise<Array>} - Array of job results
 */
async function processRowsInline({ templateId, rows, outputType, userId }) {
  const results = [];

  // Process in batches of INLINE_CONCURRENCY
  for (let i = 0; i < rows.length; i += INLINE_CONCURRENCY) {
    const batch = rows.slice(i, i + INLINE_CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (row, batchIndex) => {
        const rowIndex = i + batchIndex;
        try {
          const job = await concurrencyLimiter.run(async () => {
            return mergeTemplate({
              templateId,
              data: row,
              outputType,
              userId,
            });
          });
          return { rowIndex, success: true, job };
        } catch (err) {
          console.error('Row merge failed:', { rowIndex, error: err.message, data: Object.keys(row) });
          return { rowIndex, success: false, error: err.message };
        }
      })
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Create a batch job for background processing
 * @param {Object} params - Job parameters
 * @returns {Promise<Object>} - Created batch job
 */
async function createBatchJob({ templateId, rows, outputType, userId }) {
  const batchJob = await prisma.batchJob.create({
    data: {
      templateId,
      userId,
      outputType,
      totalRows: rows.length,
      rows: rows, // Store rows as JSON
      status: 'pending',
    },
  });

  // Trigger background processing (non-blocking)
  setImmediate(() => {
    processBatchJob(batchJob.id).catch(err => {
      logger.error({ err, batchJobId: batchJob.id }, 'Failed to process batch job');
    });
  });

  return batchJob;
}

/**
 * Process a batch job in the background
 * @param {string} batchJobId - Batch job ID
 */
async function processBatchJob(batchJobId) {
  const batchJob = await prisma.batchJob.findUnique({
    where: { id: batchJobId },
  });

  if (!batchJob || batchJob.status !== 'pending') {
    return;
  }

  // Mark as processing
  await prisma.batchJob.update({
    where: { id: batchJobId },
    data: {
      status: 'processing',
      startedAt: new Date(),
    },
  });

  const results = [];
  let processedRows = 0;
  let failedRows = 0;

  try {
    const rows = batchJob.rows;

    // Process rows sequentially to avoid overwhelming the system
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const job = await concurrencyLimiter.run(async () => {
          return mergeTemplate({
            templateId: batchJob.templateId,
            data: row,
            outputType: batchJob.outputType,
            userId: batchJob.userId,
          });
        });

        results.push({
          rowIndex: i,
          success: true,
          mergeJobId: job.jobId,
          filePath: job.filePath,
        });
        processedRows++;
      } catch (err) {
        results.push({
          rowIndex: i,
          success: false,
          error: err.message,
        });
        failedRows++;
        processedRows++;
      }

      // Update progress periodically (every 10 rows)
      if (i % 10 === 0 || i === rows.length - 1) {
        await prisma.batchJob.update({
          where: { id: batchJobId },
          data: {
            processedRows,
            failedRows,
            results,
          },
        });
      }
    }

    // Mark as completed
    await prisma.batchJob.update({
      where: { id: batchJobId },
      data: {
        status: 'completed',
        processedRows,
        failedRows,
        results,
        completedAt: new Date(),
      },
    });

    logger.info(
      { batchJobId, totalRows: rows.length, processedRows, failedRows },
      'Batch job completed'
    );
  } catch (err) {
    // Mark as failed
    await prisma.batchJob.update({
      where: { id: batchJobId },
      data: {
        status: 'failed',
        error: err.message,
        results,
        completedAt: new Date(),
      },
    });

    logger.error({ err, batchJobId }, 'Batch job failed');
  }
}

/**
 * Get batch job status
 * @param {string} batchJobId - Batch job ID
 * @param {string} userId - User ID for authorization
 * @returns {Promise<Object|null>} - Batch job status
 */
async function getBatchJobStatus(batchJobId, userId) {
  const batchJob = await prisma.batchJob.findUnique({
    where: { id: batchJobId },
    select: {
      id: true,
      templateId: true,
      userId: true,
      outputType: true,
      status: true,
      totalRows: true,
      processedRows: true,
      failedRows: true,
      results: true,
      error: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!batchJob) {
    return null;
  }

  // Authorization check
  if (batchJob.userId !== userId) {
    return null;
  }

  return {
    ...batchJob,
    progress: batchJob.totalRows > 0
      ? Math.round((batchJob.processedRows / batchJob.totalRows) * 100)
      : 0,
  };
}

/**
 * List batch jobs for a user
 * @param {string} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Array>} - List of batch jobs
 */
async function listBatchJobs(userId, { limit = 20, offset = 0 } = {}) {
  const batchJobs = await prisma.batchJob.findMany({
    where: { userId },
    select: {
      id: true,
      templateId: true,
      outputType: true,
      status: true,
      totalRows: true,
      processedRows: true,
      failedRows: true,
      createdAt: true,
      completedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  return batchJobs.map(job => ({
    ...job,
    progress: job.totalRows > 0
      ? Math.round((job.processedRows / job.totalRows) * 100)
      : 0,
  }));
}

/**
 * Resume pending batch jobs on server startup
 * Called from app.js on startup
 */
async function resumePendingBatchJobs() {
  const pendingJobs = await prisma.batchJob.findMany({
    where: {
      status: { in: ['pending', 'processing'] },
    },
    select: { id: true },
  });

  if (pendingJobs.length > 0) {
    logger.info({ count: pendingJobs.length }, 'Resuming pending batch jobs');

    for (const job of pendingJobs) {
      // Reset to pending so they get reprocessed
      await prisma.batchJob.update({
        where: { id: job.id },
        data: { status: 'pending' },
      });

      setImmediate(() => {
        processBatchJob(job.id).catch(err => {
          logger.error({ err, batchJobId: job.id }, 'Failed to resume batch job');
        });
      });
    }
  }
}

module.exports = {
  INLINE_THRESHOLD,
  shouldProcessInline,
  processRowsInline,
  createBatchJob,
  processBatchJob,
  getBatchJobStatus,
  listBatchJobs,
  resumePendingBatchJobs,
};
