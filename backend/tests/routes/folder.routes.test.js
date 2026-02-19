// Mock dependencies BEFORE importing
jest.mock("../../src/config/prisma");
jest.mock("../../src/middleware/supabase-auth");

const request = require("supertest");
const express = require("express");
const folderRouter = require("../../src/routes/folder.routes");
const authenticateSupabase = require("../../src/middleware/supabase-auth");
const prisma = require("../../src/config/prisma");

// Mock user for authenticated requests
const mockUser = {
  id: "cluser0000000000000000001",
  email: "test@example.com",
};

// Valid CUID test IDs (format: c + 24 lowercase alphanumeric chars)
const testIds = {
  folder1: "clfolder00000000000000001",
  folder2: "clfolder00000000000000002",
  folderNew: "clfoldern0000000000000001",
  parent1: "clparent00000000000000001",
  oldParent: "cloldpare0000000000000001",
  existing: "clexistin0000000000000001",
  template1: "cltemplat0000000000000001",
  nonexistent: "clnonexis0000000000000001",
};

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Add mock logger to requests
  app.use((req, res, next) => {
    req.log = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    next();
  });

  app.use("/api", folderRouter);
  return app;
};

describe("Folder Routes", () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();

    // Mock authentication middleware to pass through and set user
    authenticateSupabase.mockImplementation((req, res, next) => {
      req.user = mockUser;
      next();
    });
  });

  describe("GET /api/folders", () => {
    test("should return list of folders for user", async () => {
      const mockFolders = [
        { id: testIds.folder1, name: "Documents", depth: 1, parentId: null, _count: { templates: 5, children: 2 } },
        { id: testIds.folder2, name: "Reports", depth: 1, parentId: null, _count: { templates: 3, children: 0 } },
      ];

      prisma.folder.findMany.mockResolvedValue(mockFolders);

      const response = await request(app).get("/api/folders");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockFolders);
      expect(prisma.folder.findMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
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

    test("should return empty array when no folders exist", async () => {
      prisma.folder.findMany.mockResolvedValue([]);

      const response = await request(app).get("/api/folders");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test("should return 500 when database error occurs", async () => {
      prisma.folder.findMany.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/folders");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to load folders");
    });
  });

  describe("POST /api/folders", () => {
    test("should create a root folder successfully", async () => {
      const newFolder = {
        id: testIds.folderNew,
        name: "New Folder",
        depth: 1,
        parentId: null,
        _count: { templates: 0, children: 0 },
      };

      prisma.folder.findFirst.mockResolvedValue(null); // No existing folder
      prisma.folder.create.mockResolvedValue(newFolder);

      const response = await request(app)
        .post("/api/folders")
        .send({ name: "New Folder" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(newFolder);
    });

    test("should create a nested folder successfully", async () => {
      const parentFolder = { id: testIds.parent1, name: "Parent", depth: 1 };
      const newFolder = {
        id: testIds.folderNew,
        name: "Child Folder",
        depth: 2,
        parentId: testIds.parent1,
        _count: { templates: 0, children: 0 },
      };

      prisma.folder.findFirst
        .mockResolvedValueOnce(parentFolder) // Parent exists
        .mockResolvedValueOnce(null); // No duplicate
      prisma.folder.create.mockResolvedValue(newFolder);

      const response = await request(app)
        .post("/api/folders")
        .send({ name: "Child Folder", parentId: testIds.parent1 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(newFolder);
    });

    test("should return 400 when folder name is missing", async () => {
      const response = await request(app)
        .post("/api/folders")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Folder name is required");
    });

    test("should return 400 when folder name is only whitespace", async () => {
      const response = await request(app)
        .post("/api/folders")
        .send({ name: "   " });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Folder name is required");
    });

    test("should return 400 when folder name exceeds 100 characters", async () => {
      const longName = "a".repeat(101);

      const response = await request(app)
        .post("/api/folders")
        .send({ name: longName });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Folder name must be 100 characters or less");
    });

    test("should return 400 when max depth exceeded", async () => {
      const parentFolder = { id: testIds.parent1, name: "Deep", depth: 4 };

      prisma.folder.findFirst.mockResolvedValueOnce(parentFolder);

      const response = await request(app)
        .post("/api/folders")
        .send({ name: "Too Deep", parentId: testIds.parent1 });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Maximum folder depth of 4 exceeded");
    });

    test("should return 404 when parent folder not found", async () => {
      prisma.folder.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/folders")
        .send({ name: "Child", parentId: testIds.nonexistent });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Parent folder not found");
    });

    test("should return 409 when duplicate folder name exists", async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: testIds.existing, name: "Duplicate" });

      const response = await request(app)
        .post("/api/folders")
        .send({ name: "Duplicate" });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toBe("A root folder with this name already exists");
    });
  });

  describe("PUT /api/folders/:id", () => {
    test("should rename folder successfully", async () => {
      const folder = { id: testIds.folder1, name: "Old Name", parentId: null };
      const renamedFolder = {
        id: testIds.folder1,
        name: "New Name",
        parentId: null,
        _count: { templates: 0, children: 0 },
      };

      prisma.folder.findFirst
        .mockResolvedValueOnce(folder) // Folder exists
        .mockResolvedValueOnce(null); // No duplicate
      prisma.folder.update.mockResolvedValue(renamedFolder);

      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}`)
        .send({ name: "New Name" });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("New Name");
    });

    test("should return 400 when name is missing", async () => {
      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Folder name is required");
    });

    test("should return 404 when folder not found", async () => {
      prisma.folder.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .put(`/api/folders/${testIds.nonexistent}`)
        .send({ name: "New Name" });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Folder not found");
    });

    test("should return 409 when duplicate name exists in same location", async () => {
      const folder = { id: testIds.folder1, name: "Old Name", parentId: null };
      const existing = { id: testIds.folder2, name: "New Name", parentId: null };

      prisma.folder.findFirst
        .mockResolvedValueOnce(folder)
        .mockResolvedValueOnce(existing);

      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}`)
        .send({ name: "New Name" });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toBe("A folder with this name already exists in the same location");
    });
  });

  describe("PUT /api/folders/:id/move", () => {
    test("should move folder to new parent successfully", async () => {
      const folder = { id: testIds.folder1, name: "Folder", depth: 1, children: [] };
      const newParent = { id: testIds.parent1, name: "Parent", depth: 1 };
      const movedFolder = {
        id: testIds.folder1,
        name: "Folder",
        depth: 2,
        parentId: testIds.parent1,
        _count: { templates: 0, children: 0 },
      };

      prisma.folder.findFirst
        .mockResolvedValueOnce(folder) // Folder exists
        .mockResolvedValueOnce(newParent) // New parent exists
        .mockResolvedValueOnce(null); // No duplicate
      prisma.folder.findUnique.mockResolvedValue(null); // For cycle detection
      prisma.folder.findMany.mockResolvedValue([]); // No children
      prisma.folder.update.mockResolvedValue(movedFolder);

      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}/move`)
        .send({ newParentId: testIds.parent1 });

      expect(response.status).toBe(200);
      expect(response.body.parentId).toBe(testIds.parent1);
    });

    test("should move folder to root successfully", async () => {
      const folder = { id: testIds.folder1, name: "Folder", depth: 2, parentId: testIds.oldParent, children: [] };
      const movedFolder = {
        id: testIds.folder1,
        name: "Folder",
        depth: 1,
        parentId: null,
        _count: { templates: 0, children: 0 },
      };

      prisma.folder.findFirst
        .mockResolvedValueOnce(folder) // Folder exists
        .mockResolvedValueOnce(null); // No duplicate at root
      prisma.folder.findMany.mockResolvedValue([]); // No children
      prisma.folder.update.mockResolvedValue(movedFolder);

      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}/move`)
        .send({ newParentId: null });

      expect(response.status).toBe(200);
      expect(response.body.parentId).toBe(null);
    });

    test("should return 400 when trying to move folder into itself", async () => {
      const folder = { id: testIds.folder1, name: "Folder", depth: 1, children: [] };

      prisma.folder.findFirst.mockResolvedValueOnce(folder);

      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}/move`)
        .send({ newParentId: testIds.folder1 });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Cannot move folder into itself");
    });

    test("should return 404 when folder not found", async () => {
      prisma.folder.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .put(`/api/folders/${testIds.nonexistent}/move`)
        .send({ newParentId: testIds.parent1 });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Folder not found");
    });

    test("should return 404 when target folder not found", async () => {
      const folder = { id: testIds.folder1, name: "Folder", depth: 1, children: [] };

      prisma.folder.findFirst
        .mockResolvedValueOnce(folder) // Folder exists
        .mockResolvedValueOnce(null); // Target not found

      const response = await request(app)
        .put(`/api/folders/${testIds.folder1}/move`)
        .send({ newParentId: testIds.nonexistent });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Target folder not found");
    });
  });

  describe("DELETE /api/folders/:id", () => {
    test("should delete folder successfully", async () => {
      const folder = { id: testIds.folder1, name: "Folder" };

      prisma.folder.findFirst.mockResolvedValue(folder);
      prisma.folder.findMany.mockResolvedValue([]); // No children
      prisma.template.updateMany.mockResolvedValue({ count: 0 });
      prisma.folder.delete.mockResolvedValue(folder);

      const response = await request(app).delete(`/api/folders/${testIds.folder1}`);

      expect(response.status).toBe(204);
    });

    test("should return 404 when folder not found", async () => {
      prisma.folder.findFirst.mockResolvedValue(null);

      const response = await request(app).delete(`/api/folders/${testIds.nonexistent}`);

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Folder not found");
    });
  });

  describe("PUT /api/templates/:id/move", () => {
    test("should move template to folder successfully", async () => {
      const template = { id: testIds.template1, name: "Template" };
      const folder = { id: testIds.folder1, name: "Folder" };
      const movedTemplate = {
        id: testIds.template1,
        name: "Template",
        folderId: testIds.folder1,
        fields: [],
        folder: folder,
      };

      prisma.template.findUnique.mockResolvedValue(template);
      prisma.folder.findFirst.mockResolvedValue(folder);
      prisma.template.update.mockResolvedValue(movedTemplate);

      const response = await request(app)
        .put(`/api/templates/${testIds.template1}/move`)
        .send({ folderId: testIds.folder1 });

      expect(response.status).toBe(200);
      expect(response.body.folderId).toBe(testIds.folder1);
    });

    test("should unfile template successfully", async () => {
      const template = { id: testIds.template1, name: "Template", folderId: testIds.folder1 };
      const unfiledTemplate = {
        id: testIds.template1,
        name: "Template",
        folderId: null,
        fields: [],
        folder: null,
      };

      prisma.template.findUnique.mockResolvedValue(template);
      prisma.template.update.mockResolvedValue(unfiledTemplate);

      const response = await request(app)
        .put(`/api/templates/${testIds.template1}/move`)
        .send({ folderId: null });

      expect(response.status).toBe(200);
      expect(response.body.folderId).toBe(null);
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .put(`/api/templates/${testIds.nonexistent}/move`)
        .send({ folderId: testIds.folder1 });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when target folder not found", async () => {
      const template = { id: testIds.template1, name: "Template" };

      prisma.template.findUnique.mockResolvedValue(template);
      prisma.folder.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .put(`/api/templates/${testIds.template1}/move`)
        .send({ folderId: testIds.nonexistent });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Folder not found");
    });
  });

  describe("Authentication", () => {
    test("should return 401 when not authenticated", async () => {
      authenticateSupabase.mockImplementation((req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const response = await request(app).get("/api/folders");

      expect(response.status).toBe(401);
    });
  });
});
