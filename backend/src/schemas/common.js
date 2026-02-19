const { z } = require("zod");

// CUID pattern from existing code: /^c[a-z0-9]{24}$/
const cuid = z.string().regex(/^c[a-z0-9]{24}$/, "Invalid ID format");

// Email validation (matches existing regex)
const email = z.string({ error: "Email is required" })
  .min(1, "Email is required")
  .email("Invalid email format");

// Password with strength requirements (from auth.routes.js validatePasswordStrength)
const password = z.string({ error: "Password is required" })
  .min(8, "Password must contain at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one special character");

// Simple password (for login - just requires non-empty)
const simplePassword = z.string().min(1, "Password is required");

// Non-empty trimmed string
const requiredString = (fieldName = "Field") => z.string()
  .min(1, `${fieldName} is required`)
  .transform(s => s.trim())
  .refine(s => s.length > 0, `${fieldName} is required`);

// Output types (all possible values)
const outputType = z.enum(["pdf", "docx", "html", "jpg", "xlsx", "pptx", "ppsx"]).default("pdf");

// Pagination parameters
const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// Nullable CUID (for optional parent references)
const nullableCuid = z.union([cuid, z.null()]).optional();

module.exports = {
  cuid,
  email,
  password,
  simplePassword,
  requiredString,
  outputType,
  pagination,
  nullableCuid,
};
