jest.mock("../../src/config/prisma");
const prisma = require("../../src/config/prisma");

const {
  getUserFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  moveTemplate,
} = require("../../src/services/folder.service");

beforeEach(() => {
  // resetAllMocks clears the mockResolvedValueOnce queue (clearAllMocks does not),
  // preventing unconsumed values from leaking between tests
  jest.resetAllMocks();

  // Safe defaults so exhausted mocks don't return undefined
  // (which causes infinite recursion in recursive helpers)
  prisma.folder.findMany.mockResolvedValue([]);
  prisma.folder.findUnique.mockResolvedValue(null);
  prisma.folder.findFirst.mockResolvedValue(null);
  prisma.folder.update.mockResolvedValue({});
  prisma.folder.delete.mockResolvedValue({});
  prisma.folder.create.mockResolvedValue({});
  prisma.template.updateMany.mockResolvedValue({ count: 0 });
  prisma.template.findUnique.mockResolvedValue(null);
  prisma.template.update.mockResolvedValue({});
});

describe("folder.service", () => {
  describe("getUserFolders", () => {
    test("returns folders for user ordered by depth and name", async () => {
      const mockFolders = [
        { id: "f1", name: "Alpha", depth: 1 },
        { id: "f2", name: "Beta", depth: 1 },
      ];
      prisma.folder.findMany.mockResolvedValueOnce(mockFolders);

      const result = await getUserFolders("user-1");

      expect(result).toEqual(mockFolders);
      expect(prisma.folder.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        include: {
          _count: {
            select: {
              templates: { where: { isActive: true } },
              children: true,
            },
          },
        },
        orderBy: [{ depth: "asc" }, { name: "asc" }],
      });
    });
  });

  describe("createFolder", () => {
    test("creates root folder", async () => {
      // findFirst for duplicate check returns null (default)
      prisma.folder.create.mockResolvedValue({
        id: "new-folder",
        name: "Documents",
        depth: 1,
        parentId: null,
      });

      const result = await createFolder("user-1", "Documents");

      expect(result.name).toBe("Documents");
      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: { name: "Documents", parentId: null, depth: 1, userId: "user-1" },
        include: { _count: { select: { templates: true, children: true } } },
      });
    });

    test("creates nested folder with correct depth", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "parent-1", depth: 2, userId: "user-1" }) // parent lookup
        .mockResolvedValueOnce(null); // duplicate check
      prisma.folder.create.mockResolvedValue({
        id: "child-1",
        name: "Child",
        depth: 3,
        parentId: "parent-1",
      });

      const result = await createFolder("user-1", "Child", "parent-1");

      expect(result.depth).toBe(3);
      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: { name: "Child", parentId: "parent-1", depth: 3, userId: "user-1" },
        include: { _count: { select: { templates: true, children: true } } },
      });
    });

    test("throws when parent not found", async () => {
      // findFirst returns null (default) — parent not found

      await expect(
        createFolder("user-1", "Child", "nonexistent")
      ).rejects.toThrow("Parent folder not found");
    });

    test("throws when max depth exceeded", async () => {
      prisma.folder.findFirst.mockResolvedValueOnce({
        id: "deep-parent",
        depth: 4,
        userId: "user-1",
      });

      await expect(
        createFolder("user-1", "TooDeep", "deep-parent")
      ).rejects.toThrow("Maximum folder depth of 4 exceeded");
    });

    test("throws when duplicate name exists at same level", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "parent-1", depth: 1, userId: "user-1" }) // parent
        .mockResolvedValueOnce({ id: "existing", name: "Duplicate" }); // duplicate

      await expect(
        createFolder("user-1", "Duplicate", "parent-1")
      ).rejects.toThrow("A folder with this name already exists in the same location");
    });

    test("throws when duplicate root folder name exists", async () => {
      prisma.folder.findFirst.mockResolvedValueOnce({ id: "existing", name: "Docs" });

      await expect(
        createFolder("user-1", "Docs")
      ).rejects.toThrow("A root folder with this name already exists");
    });
  });

  describe("renameFolder", () => {
    test("renames folder successfully", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Old", parentId: null, userId: "user-1" })
        .mockResolvedValueOnce(null); // no duplicate
      prisma.folder.update.mockResolvedValue({ id: "f1", name: "New" });

      const result = await renameFolder("user-1", "f1", "New");

      expect(result.name).toBe("New");
    });

    test("throws when folder not found", async () => {
      await expect(
        renameFolder("user-1", "nonexistent", "New")
      ).rejects.toThrow("Folder not found");
    });

    test("throws when duplicate name exists in same location", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Old", parentId: null })
        .mockResolvedValueOnce({ id: "f2", name: "Taken" });

      await expect(
        renameFolder("user-1", "f1", "Taken")
      ).rejects.toThrow("A folder with this name already exists in the same location");
    });
  });

  describe("moveFolder", () => {
    test("moves folder to new parent with correct depth", async () => {
      // 1. findFirst: folder lookup
      // 2. findFirst: new parent lookup
      // 3. findFirst: duplicate check
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Folder", depth: 1, children: [] })
        .mockResolvedValueOnce({ id: "p1", depth: 2, userId: "user-1" })
        .mockResolvedValueOnce(null);

      // checkIsDescendant: walks up from p1
      // getMaxChildDepth: findUnique for f1's depth
      prisma.folder.findUnique
        .mockResolvedValueOnce({ parentId: null }) // p1's parent is root → no cycle
        .mockResolvedValueOnce({ depth: 1 }); // f1's depth for getMaxChildDepth

      // getMaxChildDepth: children of f1 (none)
      // recalculateSubtreeDepths: children of f1 (none)
      // findMany defaults to [] for both

      // getMaxChildDepth initial findMany (the OR query)
      // Already defaults to []

      prisma.folder.update.mockResolvedValue({
        id: "f1",
        name: "Folder",
        depth: 3,
        parentId: "p1",
      });

      const result = await moveFolder("user-1", "f1", "p1");

      expect(result.depth).toBe(3);
      expect(result.parentId).toBe("p1");
    });

    test("moves folder to root", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Folder", depth: 3, parentId: "p1", children: [] })
        .mockResolvedValueOnce(null); // no duplicate at root

      // findMany defaults to [] for recalculateSubtreeDepths children

      prisma.folder.update.mockResolvedValue({
        id: "f1",
        name: "Folder",
        depth: 1,
        parentId: null,
      });

      const result = await moveFolder("user-1", "f1", null);

      expect(result.depth).toBe(1);
      expect(result.parentId).toBeNull();
    });

    test("throws when moving folder into itself", async () => {
      prisma.folder.findFirst.mockResolvedValueOnce({
        id: "f1",
        name: "Folder",
        depth: 1,
        children: [],
      });

      await expect(
        moveFolder("user-1", "f1", "f1")
      ).rejects.toThrow("Cannot move folder into itself");
    });

    test("throws when folder not found", async () => {
      await expect(
        moveFolder("user-1", "nonexistent", "p1")
      ).rejects.toThrow("Folder not found");
    });

    test("throws when target folder not found", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Folder", depth: 1, children: [] })
        .mockResolvedValueOnce(null); // target not found

      await expect(
        moveFolder("user-1", "f1", "nonexistent")
      ).rejects.toThrow("Target folder not found");
    });

    test("detects circular reference", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Parent", depth: 1, children: [] })
        .mockResolvedValueOnce({ id: "f2", depth: 2, userId: "user-1" });

      // Cycle detection: walking up from f2, f2's parent is f1 (the folder being moved)
      prisma.folder.findUnique.mockResolvedValueOnce({ parentId: "f1" });

      await expect(
        moveFolder("user-1", "f1", "f2")
      ).rejects.toThrow("Circular reference: cannot move folder into its own subtree");
    });

    test("throws when move would exceed max depth", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Folder", depth: 1, children: [] })
        .mockResolvedValueOnce({ id: "p1", depth: 3, userId: "user-1" });

      // checkIsDescendant: p1's parent is root (no cycle)
      prisma.folder.findUnique
        .mockResolvedValueOnce({ parentId: null });

      // getMaxChildDepth initial findMany (OR query) - returns folder list
      prisma.folder.findMany.mockResolvedValueOnce([]);

      // getMaxChildDepth recursive: findUnique for f1 depth
      prisma.folder.findUnique.mockResolvedValueOnce({ depth: 1 });

      // getMaxChildDepth recursive: children of f1 → has a child
      prisma.folder.findMany.mockResolvedValueOnce([{ id: "child1" }]);

      // getMaxChildDepth recursive: findUnique for child1 depth
      prisma.folder.findUnique.mockResolvedValueOnce({ depth: 2 });

      // getMaxChildDepth recursive: children of child1 → none
      // defaults to []

      // f1 depth=1, max child depth=2, offset=1. newDepth=4. 4+1=5 > 4

      await expect(
        moveFolder("user-1", "f1", "p1")
      ).rejects.toThrow("Moving this folder would exceed maximum depth of 4");
    });

    test("throws when duplicate name exists at target", async () => {
      prisma.folder.findFirst
        .mockResolvedValueOnce({ id: "f1", name: "Folder", depth: 1, children: [] })
        .mockResolvedValueOnce({ id: "p1", depth: 1, userId: "user-1" })
        .mockResolvedValueOnce({ id: "existing", name: "Folder" }); // duplicate at target

      // checkIsDescendant: no cycle
      prisma.folder.findUnique.mockResolvedValueOnce({ parentId: null });

      // getMaxChildDepth: initial findMany (OR query)
      prisma.folder.findMany.mockResolvedValueOnce([]);

      // getMaxChildDepth: findUnique for f1 depth, no children
      prisma.folder.findUnique.mockResolvedValueOnce({ depth: 1 });
      // findMany for children defaults to []

      await expect(
        moveFolder("user-1", "f1", "p1")
      ).rejects.toThrow("A folder with this name already exists in the target location");
    });
  });

  describe("deleteFolder", () => {
    test("deletes folder and unfiles templates in subtree", async () => {
      prisma.folder.findFirst.mockResolvedValueOnce({ id: "f1", userId: "user-1" });
      // getSubtreeFolderIds: f1 has one child, child has no children
      prisma.folder.findMany
        .mockResolvedValueOnce([{ id: "child1" }]) // f1's children
        .mockResolvedValueOnce([]); // child1 has no children
      prisma.template.updateMany.mockResolvedValue({ count: 3 });

      await deleteFolder("user-1", "f1");

      expect(prisma.template.updateMany).toHaveBeenCalledWith({
        where: { folderId: { in: ["f1", "child1"] } },
        data: { folderId: null },
      });
      expect(prisma.folder.delete).toHaveBeenCalledWith({
        where: { id: "f1" },
      });
    });

    test("throws when folder not found", async () => {
      await expect(
        deleteFolder("user-1", "nonexistent")
      ).rejects.toThrow("Folder not found");
    });

    test("handles deep subtree deletion", async () => {
      prisma.folder.findFirst.mockResolvedValueOnce({ id: "root", userId: "user-1" });
      prisma.folder.findMany
        .mockResolvedValueOnce([{ id: "level2a" }, { id: "level2b" }])
        .mockResolvedValueOnce([{ id: "level3" }]) // level2a's children
        .mockResolvedValueOnce([]) // level3 has no children
        .mockResolvedValueOnce([]); // level2b has no children

      await deleteFolder("user-1", "root");

      expect(prisma.template.updateMany).toHaveBeenCalledWith({
        where: { folderId: { in: ["root", "level2a", "level3", "level2b"] } },
        data: { folderId: null },
      });
    });
  });

  describe("moveTemplate", () => {
    test("moves template to folder", async () => {
      prisma.template.findUnique.mockResolvedValueOnce({ id: "t1" });
      prisma.folder.findFirst.mockResolvedValueOnce({ id: "f1", userId: "user-1" });
      prisma.template.update.mockResolvedValue({
        id: "t1",
        folderId: "f1",
        fields: [],
        folder: { id: "f1" },
      });

      const result = await moveTemplate("user-1", "t1", "f1");

      expect(result.folderId).toBe("f1");
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { folderId: "f1" },
        include: { fields: true, folder: true },
      });
    });

    test("unfiles template (moves to root)", async () => {
      prisma.template.findUnique.mockResolvedValueOnce({ id: "t1", folderId: "f1" });
      prisma.template.update.mockResolvedValue({
        id: "t1",
        folderId: null,
        fields: [],
        folder: null,
      });

      const result = await moveTemplate("user-1", "t1", null);

      expect(result.folderId).toBeNull();
    });

    test("throws when template not found", async () => {
      await expect(
        moveTemplate("user-1", "nonexistent", "f1")
      ).rejects.toThrow("Template not found");
    });

    test("throws when target folder not found", async () => {
      prisma.template.findUnique.mockResolvedValueOnce({ id: "t1" });
      // findFirst returns null (default) — folder not found

      await expect(
        moveTemplate("user-1", "t1", "nonexistent")
      ).rejects.toThrow("Folder not found");
    });
  });
});
