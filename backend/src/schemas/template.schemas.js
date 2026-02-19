const { z } = require("zod");

// Template-specific CUID with appropriate error message
const templateCuid = z.string().regex(/^c[a-z0-9]{24}$/, "Invalid template ID format");

const templateIdParams = z.object({
  id: templateCuid,
});

const templateVersionParams = z.object({
  id: templateCuid,
  versionId: z.string().regex(/^c[a-z0-9]{24}$/, "Invalid version ID format"),
});

const updateTemplateBody = z.object({
  displayName: z.string().max(255).optional(),
  defaultOutputType: z.enum(["pdf", "docx", "html", "jpg", "xlsx", "pptx", "ppsx"]).nullable().optional(),
  outputNameFormat: z.string().max(500).nullable().optional(),
  pageSize: z.enum(["A4", "Letter", "Legal"]).nullable().optional(),
  orientation: z.enum(["portrait", "landscape"]).nullable().optional(),
}).passthrough(); // Allow additional fields from multipart form data

module.exports = {
  templateIdParams,
  templateVersionParams,
  updateTemplateBody,
};
