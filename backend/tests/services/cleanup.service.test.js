jest.mock("../../src/config/prisma");
jest.mock("../../src/storage/supabase-storage");
jest.mock("../../src/config/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const prisma = require("../../src/config/prisma");
const { s3, withPrefix } = require("../../src/storage/supabase-storage");
const { cleanupOldOutputs, runCleanup } = require("../../src/services/cleanup.service");

beforeEach(() => {
  jest.resetAllMocks();
  withPrefix.mockImplementation((key) => key);
  prisma.mergeJob.findMany.mockResolvedValue([]);
  prisma.mergeJob.delete.mockResolvedValue({});
  s3.send.mockResolvedValue({});
});

describe("cleanupOldOutputs", () => {
  test("deletes old merge jobs and their S3 files", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([
      { id: "job-1", filePath: "outputs/file1.pdf" },
      { id: "job-2", filePath: "outputs/file2.pdf" },
    ]);

    const result = await cleanupOldOutputs(90);

    expect(result).toEqual({ deleted: 2, errors: 0 });
    expect(s3.send).toHaveBeenCalledTimes(2);
    expect(prisma.mergeJob.delete).toHaveBeenCalledTimes(2);
    expect(prisma.mergeJob.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
    expect(prisma.mergeJob.delete).toHaveBeenCalledWith({ where: { id: "job-2" } });
  });

  test("queries with correct cutoff date", async () => {
    await cleanupOldOutputs(30);

    const callArgs = prisma.mergeJob.findMany.mock.calls[0][0];
    const cutoff = callArgs.where.createdAt.lt;

    // Cutoff should be ~30 days ago
    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    const diffMs = Math.abs(cutoff.getTime() - expectedCutoff.getTime());
    expect(diffMs).toBeLessThan(1000);
  });

  test("strips s3:// prefix from file path", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([
      { id: "job-1", filePath: "s3://my-bucket/outputs/file.pdf" },
    ]);

    await cleanupOldOutputs();

    expect(withPrefix).toHaveBeenCalledWith("outputs/file.pdf");
  });

  test("handles jobs with no filePath", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([
      { id: "job-1", filePath: null },
    ]);

    const result = await cleanupOldOutputs();

    expect(result).toEqual({ deleted: 1, errors: 0 });
    expect(s3.send).not.toHaveBeenCalled();
    expect(prisma.mergeJob.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
  });

  test("continues deleting DB record when S3 deletion fails", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([
      { id: "job-1", filePath: "outputs/file.pdf" },
    ]);
    s3.send.mockRejectedValue(new Error("S3 error"));

    const result = await cleanupOldOutputs();

    expect(result).toEqual({ deleted: 1, errors: 0 });
    expect(prisma.mergeJob.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
  });

  test("counts errors when DB deletion fails", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([
      { id: "job-1", filePath: "outputs/file1.pdf" },
      { id: "job-2", filePath: "outputs/file2.pdf" },
    ]);
    prisma.mergeJob.delete
      .mockRejectedValueOnce(new Error("DB error"))
      .mockResolvedValueOnce({});

    const result = await cleanupOldOutputs();

    expect(result).toEqual({ deleted: 1, errors: 1 });
  });

  test("returns zero counts when no old jobs found", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([]);

    const result = await cleanupOldOutputs();

    expect(result).toEqual({ deleted: 0, errors: 0 });
    expect(s3.send).not.toHaveBeenCalled();
    expect(prisma.mergeJob.delete).not.toHaveBeenCalled();
  });

  test("throws when query for old jobs fails", async () => {
    prisma.mergeJob.findMany.mockRejectedValue(new Error("DB connection failed"));

    await expect(cleanupOldOutputs()).rejects.toThrow("DB connection failed");
  });
});

describe("runCleanup", () => {
  test("runs cleanupOldOutputs and returns results", async () => {
    prisma.mergeJob.findMany.mockResolvedValue([
      { id: "job-1", filePath: "outputs/file.pdf" },
    ]);

    const result = await runCleanup();

    expect(result).toEqual({
      outputs: { deleted: 1, errors: 0 },
    });
  });
});
