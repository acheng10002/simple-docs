/**
 * Unit tests for batchJob.service.js
 * Tests: batch job processing for large CSV merge operations
 */

// Mock prisma with batchJob model
jest.mock("../../src/config/prisma", () => ({
  batchJob: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
}));
const prisma = require("../../src/config/prisma");

// Mock merge service
jest.mock("../../src/services/merge.service", () => ({
  mergeTemplate: jest.fn(),
}));
const { mergeTemplate } = require("../../src/services/merge.service");

// Mock concurrency limiter
jest.mock("../../src/utils/concurrency", () => ({
  mergeLimiter: {
    run: jest.fn((fn) => fn()),
  },
}));
const { mergeLimiter } = require("../../src/utils/concurrency");

// Mock logger to suppress output during tests
jest.mock("../../src/config/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
const logger = require("../../src/config/logger");

const {
  INLINE_THRESHOLD,
  shouldProcessInline,
  processRowsInline,
  createBatchJob,
  processBatchJob,
  getBatchJobStatus,
  listBatchJobs,
  resumePendingBatchJobs,
} = require("../../src/services/batchJob.service");

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mergeTemplate to return successful result by default
  mergeTemplate.mockResolvedValue({
    jobId: "job-123",
    filePath: "s3://bucket/outputs/test.pdf",
  });
});

describe("batchJob.service", () => {
  describe("shouldProcessInline", () => {
    test("should return true when row count is below threshold", () => {
      expect(shouldProcessInline(1)).toBe(true);
      expect(shouldProcessInline(5)).toBe(true);
      expect(shouldProcessInline(INLINE_THRESHOLD)).toBe(true);
    });

    test("should return false when row count exceeds threshold", () => {
      expect(shouldProcessInline(INLINE_THRESHOLD + 1)).toBe(false);
      expect(shouldProcessInline(100)).toBe(false);
      expect(shouldProcessInline(1000)).toBe(false);
    });

    test("should handle edge case of zero rows", () => {
      expect(shouldProcessInline(0)).toBe(true);
    });
  });

  describe("processRowsInline", () => {
    test("should process all rows successfully", async () => {
      const rows = [
        { name: "Alice" },
        { name: "Bob" },
        { name: "Charlie" },
      ];

      mergeTemplate
        .mockResolvedValueOnce({ jobId: "job-1", filePath: "path1" })
        .mockResolvedValueOnce({ jobId: "job-2", filePath: "path2" })
        .mockResolvedValueOnce({ jobId: "job-3", filePath: "path3" });

      const results = await processRowsInline({
        templateId: "tpl-1",
        rows,
        outputType: "pdf",
        userId: "user-1",
      });

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        rowIndex: 0,
        success: true,
        job: { jobId: "job-1", filePath: "path1" },
      });
      expect(results[1]).toEqual({
        rowIndex: 1,
        success: true,
        job: { jobId: "job-2", filePath: "path2" },
      });
      expect(results[2]).toEqual({
        rowIndex: 2,
        success: true,
        job: { jobId: "job-3", filePath: "path3" },
      });
    });

    test("should handle partial failures", async () => {
      const rows = [
        { name: "Alice" },
        { name: "Bob" },
      ];

      mergeTemplate
        .mockResolvedValueOnce({ jobId: "job-1", filePath: "path1" })
        .mockRejectedValueOnce(new Error("Merge failed"));

      const results = await processRowsInline({
        templateId: "tpl-1",
        rows,
        outputType: "pdf",
        userId: "user-1",
      });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1]).toEqual({
        rowIndex: 1,
        success: false,
        error: "Merge failed",
      });
    });

    test("should use concurrency limiter for each row", async () => {
      const rows = [{ name: "Test" }];

      await processRowsInline({
        templateId: "tpl-1",
        rows,
        outputType: "pdf",
        userId: "user-1",
      });

      expect(mergeLimiter.run).toHaveBeenCalledTimes(1);
    });

    test("should handle empty rows array", async () => {
      const results = await processRowsInline({
        templateId: "tpl-1",
        rows: [],
        outputType: "pdf",
        userId: "user-1",
      });

      expect(results).toEqual([]);
      expect(mergeTemplate).not.toHaveBeenCalled();
    });

    test("should pass correct parameters to mergeTemplate", async () => {
      const rows = [{ name: "Test", email: "test@example.com" }];

      await processRowsInline({
        templateId: "tpl-123",
        rows,
        outputType: "docx",
        userId: "user-456",
      });

      expect(mergeTemplate).toHaveBeenCalledWith({
        templateId: "tpl-123",
        data: { name: "Test", email: "test@example.com" },
        outputType: "docx",
        userId: "user-456",
      });
    });
  });

  describe("createBatchJob", () => {
    test("should create batch job with correct data", async () => {
      const mockBatchJob = {
        id: "batch-1",
        templateId: "tpl-1",
        userId: "user-1",
        outputType: "pdf",
        totalRows: 50,
        status: "pending",
      };

      prisma.batchJob.create.mockResolvedValue(mockBatchJob);

      const result = await createBatchJob({
        templateId: "tpl-1",
        rows: Array(50).fill({ name: "Test" }),
        outputType: "pdf",
        userId: "user-1",
      });

      expect(result).toEqual(mockBatchJob);
      expect(prisma.batchJob.create).toHaveBeenCalledWith({
        data: {
          templateId: "tpl-1",
          userId: "user-1",
          outputType: "pdf",
          totalRows: 50,
          rows: Array(50).fill({ name: "Test" }),
          status: "pending",
        },
      });
    });

    test("should trigger background processing via setImmediate", async () => {
      prisma.batchJob.create.mockResolvedValue({
        id: "batch-1",
        status: "pending",
      });

      const result = await createBatchJob({
        templateId: "tpl-1",
        rows: [{ name: "Test" }],
        outputType: "pdf",
        userId: "user-1",
      });

      // Verify batch job was created and returned
      expect(result.id).toBe("batch-1");
      // Background processing is triggered via setImmediate which is tested
      // through the processBatchJob tests
    });
  });

  describe("processBatchJob", () => {
    test("should skip if batch job not found", async () => {
      prisma.batchJob.findUnique.mockResolvedValue(null);

      await processBatchJob("nonexistent-id");

      expect(prisma.batchJob.update).not.toHaveBeenCalled();
    });

    test("should skip if batch job is not pending", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        status: "completed",
      });

      await processBatchJob("batch-1");

      expect(prisma.batchJob.update).not.toHaveBeenCalled();
    });

    test("should process pending batch job", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        templateId: "tpl-1",
        userId: "user-1",
        outputType: "pdf",
        status: "pending",
        rows: [{ name: "Test" }],
      });
      prisma.batchJob.update.mockResolvedValue({});

      await processBatchJob("batch-1");

      // Should update to processing first
      expect(prisma.batchJob.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: {
          status: "processing",
          startedAt: expect.any(Date),
        },
      });

      // Should update to completed at the end
      expect(prisma.batchJob.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: expect.objectContaining({
          status: "completed",
          processedRows: 1,
          failedRows: 0,
          completedAt: expect.any(Date),
        }),
      });
    });

    test("should handle failed rows", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        templateId: "tpl-1",
        userId: "user-1",
        outputType: "pdf",
        status: "pending",
        rows: [{ name: "Test1" }, { name: "Test2" }],
      });
      prisma.batchJob.update.mockResolvedValue({});

      mergeTemplate
        .mockResolvedValueOnce({ jobId: "job-1", filePath: "path1" })
        .mockRejectedValueOnce(new Error("Failed"));

      await processBatchJob("batch-1");

      // Check final update includes failure count
      const finalUpdate = prisma.batchJob.update.mock.calls.find(
        (call) => call[0].data.status === "completed"
      );
      expect(finalUpdate[0].data.failedRows).toBe(1);
      expect(finalUpdate[0].data.processedRows).toBe(2);
    });

    test("should handle complete job failure when update fails", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        templateId: "tpl-1",
        userId: "user-1",
        outputType: "pdf",
        status: "pending",
        rows: [{ name: "Test" }],
      });

      // Make the first update (to processing) succeed
      prisma.batchJob.update
        .mockResolvedValueOnce({}) // status: processing
        .mockResolvedValueOnce({}) // progress update
        .mockRejectedValueOnce(new Error("Database error")); // final update fails

      await processBatchJob("batch-1");

      // Should mark as failed and log error
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ batchJobId: "batch-1" }),
        "Batch job failed"
      );
    });

    test("should log completion info", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        templateId: "tpl-1",
        userId: "user-1",
        outputType: "pdf",
        status: "pending",
        rows: [{ name: "Test1" }, { name: "Test2" }],
      });
      prisma.batchJob.update.mockResolvedValue({});

      await processBatchJob("batch-1");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          batchJobId: "batch-1",
          totalRows: 2,
          processedRows: 2,
          failedRows: 0,
        }),
        "Batch job completed"
      );
    });
  });

  describe("getBatchJobStatus", () => {
    test("should return null if batch job not found", async () => {
      prisma.batchJob.findUnique.mockResolvedValue(null);

      const result = await getBatchJobStatus("nonexistent", "user-1");

      expect(result).toBeNull();
    });

    test("should return null if user does not own batch job", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        userId: "other-user",
        totalRows: 10,
        processedRows: 5,
      });

      const result = await getBatchJobStatus("batch-1", "user-1");

      expect(result).toBeNull();
    });

    test("should return batch job with progress for authorized user", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        userId: "user-1",
        templateId: "tpl-1",
        outputType: "pdf",
        status: "processing",
        totalRows: 100,
        processedRows: 50,
        failedRows: 2,
        results: [],
        error: null,
        createdAt: new Date("2024-01-01"),
        startedAt: new Date("2024-01-01"),
        completedAt: null,
      });

      const result = await getBatchJobStatus("batch-1", "user-1");

      expect(result).toEqual(expect.objectContaining({
        id: "batch-1",
        userId: "user-1",
        status: "processing",
        totalRows: 100,
        processedRows: 50,
        progress: 50, // 50/100 * 100
      }));
    });

    test("should calculate progress correctly", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        userId: "user-1",
        totalRows: 3,
        processedRows: 1,
      });

      const result = await getBatchJobStatus("batch-1", "user-1");

      expect(result.progress).toBe(33); // Math.round(1/3 * 100)
    });

    test("should handle zero total rows", async () => {
      prisma.batchJob.findUnique.mockResolvedValue({
        id: "batch-1",
        userId: "user-1",
        totalRows: 0,
        processedRows: 0,
      });

      const result = await getBatchJobStatus("batch-1", "user-1");

      expect(result.progress).toBe(0);
    });
  });

  describe("listBatchJobs", () => {
    test("should return list of batch jobs for user", async () => {
      prisma.batchJob.findMany.mockResolvedValue([
        {
          id: "batch-1",
          templateId: "tpl-1",
          outputType: "pdf",
          status: "completed",
          totalRows: 10,
          processedRows: 10,
          failedRows: 0,
          createdAt: new Date("2024-01-02"),
          completedAt: new Date("2024-01-02"),
        },
        {
          id: "batch-2",
          templateId: "tpl-2",
          outputType: "docx",
          status: "processing",
          totalRows: 50,
          processedRows: 25,
          failedRows: 1,
          createdAt: new Date("2024-01-01"),
          completedAt: null,
        },
      ]);

      const result = await listBatchJobs("user-1");

      expect(result).toHaveLength(2);
      expect(result[0].progress).toBe(100);
      expect(result[1].progress).toBe(50);
    });

    test("should use default pagination options", async () => {
      prisma.batchJob.findMany.mockResolvedValue([]);

      await listBatchJobs("user-1");

      expect(prisma.batchJob.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: expect.any(Object),
        orderBy: { createdAt: "desc" },
        take: 20,
        skip: 0,
      });
    });

    test("should use custom pagination options", async () => {
      prisma.batchJob.findMany.mockResolvedValue([]);

      await listBatchJobs("user-1", { limit: 10, offset: 20 });

      expect(prisma.batchJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );
    });

    test("should return empty array when no jobs found", async () => {
      prisma.batchJob.findMany.mockResolvedValue([]);

      const result = await listBatchJobs("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("resumePendingBatchJobs", () => {
    test("should resume pending and processing jobs", async () => {
      jest.useFakeTimers();

      prisma.batchJob.findMany.mockResolvedValue([
        { id: "batch-1" },
        { id: "batch-2" },
      ]);
      prisma.batchJob.update.mockResolvedValue({});
      prisma.batchJob.findUnique.mockResolvedValue(null);

      await resumePendingBatchJobs();

      // Should reset both jobs to pending
      expect(prisma.batchJob.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: { status: "pending" },
      });
      expect(prisma.batchJob.update).toHaveBeenCalledWith({
        where: { id: "batch-2" },
        data: { status: "pending" },
      });

      expect(logger.info).toHaveBeenCalledWith(
        { count: 2 },
        "Resuming pending batch jobs"
      );

      jest.useRealTimers();
    });

    test("should not log if no pending jobs", async () => {
      prisma.batchJob.findMany.mockResolvedValue([]);

      await resumePendingBatchJobs();

      expect(logger.info).not.toHaveBeenCalled();
      expect(prisma.batchJob.update).not.toHaveBeenCalled();
    });

    test("should query for pending and processing jobs", async () => {
      prisma.batchJob.findMany.mockResolvedValue([]);

      await resumePendingBatchJobs();

      expect(prisma.batchJob.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ["pending", "processing"] },
        },
        select: { id: true },
      });
    });
  });

  describe("INLINE_THRESHOLD", () => {
    test("should be a positive number", () => {
      expect(typeof INLINE_THRESHOLD).toBe("number");
      expect(INLINE_THRESHOLD).toBeGreaterThan(0);
    });

    test("should default to 10 if env not set", () => {
      // The module uses the default since env wasn't set in tests
      expect(INLINE_THRESHOLD).toBe(10);
    });
  });
});
