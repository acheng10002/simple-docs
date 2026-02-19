const { z } = require("zod");
const { cuid } = require("./common");

const folderIdParams = z.object({
  id: cuid,
});

const createFolderBody = z.object({
  name: z.string({ error: "Folder name is required" })
    .min(1, "Folder name is required")
    .max(100, "Folder name must be 100 characters or less")
    .transform(s => s.trim())
    .refine(s => s.length > 0, "Folder name is required"),
  parentId: z.union([cuid, z.null()]).optional(),
});

const renameFolderBody = z.object({
  name: z.string({ error: "Folder name is required" })
    .min(1, "Folder name is required")
    .max(100, "Folder name must be 100 characters or less")
    .transform(s => s.trim())
    .refine(s => s.length > 0, "Folder name is required"),
});

const moveFolderBody = z.object({
  newParentId: z.union([cuid, z.null()]).optional(),
});

const moveTemplateParams = z.object({
  id: cuid,
});

const moveTemplateBody = z.object({
  folderId: z.union([cuid, z.null()]).optional(),
});

module.exports = {
  folderIdParams,
  createFolderBody,
  renameFolderBody,
  moveFolderBody,
  moveTemplateParams,
  moveTemplateBody,
};
