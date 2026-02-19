const { z } = require("zod");
const { pagination } = require("./common");

// Template-specific CUID with appropriate error message
const templateCuid = z.string().regex(/^c[a-z0-9]{24}$/, "Invalid template ID format");

const templateIdParams = z.object({
  templateId: templateCuid,
});

const mergeBody = z.object({
  data: z.record(z.string(), z.unknown()).default({}),
  outputType: z.enum(["pdf", "docx", "html", "jpg", "xlsx", "pptx", "ppsx"]).default("docx"),
  testMode: z.union([z.boolean(), z.literal('true'), z.literal('false')]).default(false),
});

const csvMergeBody = z.object({
  outputType: z.enum(["pdf", "docx", "html", "jpg", "xlsx", "pptx", "ppsx"]).default("pdf"),
});

const jobIdParams = z.object({
  id: z.coerce.number({ error: "Invalid job ID" }).int("Invalid job ID"),
});

const batchJobIdParams = z.object({
  id: z.coerce.number({ error: "Invalid batch job ID" }).int("Invalid batch job ID"),
});

const batchJobsQuery = pagination;

module.exports = {
  templateIdParams,
  mergeBody,
  csvMergeBody,
  jobIdParams,
  batchJobIdParams,
  batchJobsQuery,
};
