// Mock dependencies BEFORE importing
jest.mock("../../src/config/prisma");
jest.mock("../../src/middleware/supabase-auth");
jest.mock("../../src/storage/supabase-storage");

const request = require("supertest");
const express = require("express");
const templateRouter = require("../../src/routes/template.routes");
const authenticateSupabase = require("../../src/middleware/supabase-auth");
const prisma = require("../../src/config/prisma");
const { s3, HeadObjectCommand } = require("../../src/storage/supabase-storage");

// Mock user for authenticated requests
const mockUser = {
  id: "cluser0000000000000000001",
  email: "test@example.com",
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

  app.use("/api", templateRouter);
  return app;
};

describe("Template Routes", () => {
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

  describe("GET /api/templates", () => {
    test("should return list of templates for authenticated user only", async () => {
      const mockTemplates = [
        {
          id: "cltemplat0000000000000001",
          displayName: "Invoice Template",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          isActive: true,
          uploadedById: "cluser0000000000000000001",
          fields: [{ id: "clfield000000000000000001", name: "customer_name" }],
        },
      ];

      prisma.template.findMany.mockResolvedValue(mockTemplates);

      const response = await request(app).get("/api/templates");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTemplates);
      // Verify query filters by user
      expect(prisma.template.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { uploadedById: "cluser0000000000000000001" },
        })
      );
    });

    test("should return 500 on database error", async () => {
      prisma.template.findMany.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/templates");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to load templates");
    });
  });

  describe("GET /api/templates/:id", () => {
    test("should return a single template by ID when user owns it", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        uploadedById: "cluser0000000000000000001",
        fields: [{ id: "clfield000000000000000001", name: "customer_name" }],
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).get("/api/templates/cltemplat0000000000000001");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTemplate);
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const response = await request(app).get("/api/templates/clnonexis0000000000000001");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        uploadedById: "other-user-456", // Different user
        fields: [{ id: "clfield000000000000000001", name: "customer_name" }],
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).get("/api/templates/cltemplat0000000000000001");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
    });
  });

  describe("DELETE /api/templates/:id (Deactivate)", () => {
    test("should deactivate an active template owned by user", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        isActive: true,
        uploadedById: "cluser0000000000000000001",
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);
      prisma.template.update.mockResolvedValue({ ...mockTemplate, isActive: false });

      const response = await request(app).delete("/api/templates/cltemplat0000000000000001");

      expect(response.status).toBe(204);
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: "cltemplat0000000000000001" },
        data: { isActive: false },
      });
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const response = await request(app).delete("/api/templates/clnonexis0000000000000001");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        isActive: true,
        uploadedById: "other-user-456", // Different user
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).delete("/api/templates/cltemplat0000000000000001");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
      expect(prisma.template.update).not.toHaveBeenCalled();
    });

    test("should return 404 when template already deactivated", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        isActive: false,
        uploadedById: "cluser0000000000000000001",
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).delete("/api/templates/cltemplat0000000000000001");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template already deactivated");
    });

    test("should return 500 on database error", async () => {
      prisma.template.findUnique.mockResolvedValue({ id: "cltemplat0000000000000001", isActive: true, uploadedById: "cluser0000000000000000001" });
      prisma.template.update.mockRejectedValue(new Error("Database error"));

      const response = await request(app).delete("/api/templates/cltemplat0000000000000001");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to deactivate template");
    });
  });

  describe("POST /api/templates/:id/activate", () => {
    test("should activate an inactive template owned by user", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        isActive: false,
        uploadedById: "cluser0000000000000000001",
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);
      prisma.template.update.mockResolvedValue({ ...mockTemplate, isActive: true });

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/activate");

      expect(response.status).toBe(204);
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: "cltemplat0000000000000001" },
        data: { isActive: true },
      });
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const response = await request(app).post("/api/templates/clnonexis0000000000000001/activate");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        isActive: false,
        uploadedById: "other-user-456", // Different user
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/activate");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
      expect(prisma.template.update).not.toHaveBeenCalled();
    });

    test("should return 400 when template already active", async () => {
      const mockTemplate = {
        id: "cltemplat0000000000000001",
        displayName: "Invoice Template",
        isActive: true,
        uploadedById: "cluser0000000000000000001",
      };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/activate");

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Template is already active");
    });

    test("should return 500 on database error", async () => {
      prisma.template.findUnique.mockResolvedValue({ id: "cltemplat0000000000000001", isActive: false, uploadedById: "cluser0000000000000000001" });
      prisma.template.update.mockRejectedValue(new Error("Database error"));

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/activate");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to activate template");
    });
  });

  describe("GET /api/templates/:id/versions", () => {
    test("should return version history for a template owned by user", async () => {
      const mockTemplate = { id: "cltemplat0000000000000001", uploadedById: "cluser0000000000000000001" };
      const mockVersions = [
        {
          id: "clversion0000000000000001",
          versionNumber: 2,
          displayName: "Invoice v2",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          createdAt: new Date("2024-01-15"),
          fieldsSnapshot: [{ id: "clfield000000000000000001", name: "customer_name" }],
        },
        {
          id: "clversion0000000000000002",
          versionNumber: 1,
          displayName: "Invoice v1",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          createdAt: new Date("2024-01-10"),
          fieldsSnapshot: [],
        },
      ];

      prisma.template.findUnique.mockResolvedValue(mockTemplate);
      prisma.templateVersion.findMany.mockResolvedValue(mockVersions);

      const response = await request(app).get("/api/templates/cltemplat0000000000000001/versions");

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].versionNumber).toBe(2);
    });

    test("should return 404 when template not found", async () => {
      prisma.template.findUnique.mockResolvedValue(null);

      const response = await request(app).get("/api/templates/clnonexis0000000000000001/versions");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      const mockTemplate = { id: "cltemplat0000000000000001", uploadedById: "other-user-456" };

      prisma.template.findUnique.mockResolvedValue(mockTemplate);

      const response = await request(app).get("/api/templates/cltemplat0000000000000001/versions");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
      expect(prisma.templateVersion.findMany).not.toHaveBeenCalled();
    });

    test("should return empty array when no versions exist", async () => {
      prisma.template.findUnique.mockResolvedValue({ id: "cltemplat0000000000000001", uploadedById: "cluser0000000000000000001" });
      prisma.templateVersion.findMany.mockResolvedValue([]);

      const response = await request(app).get("/api/templates/cltemplat0000000000000001/versions");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test("should return 500 on database error", async () => {
      prisma.template.findUnique.mockResolvedValue({ id: "cltemplat0000000000000001", uploadedById: "cluser0000000000000000001" });
      prisma.templateVersion.findMany.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/templates/cltemplat0000000000000001/versions");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to load version history");
    });
  });

  describe("POST /api/templates/:id/versions/:versionId/revert", () => {
    test("should revert template to a previous version when user owns it", async () => {
      const mockVersion = {
        id: "clversion0000000000000001",
        templateId: "cltemplat0000000000000001",
        versionNumber: 1,
        storageKey: "old-storage-key",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        displayName: "Old Name",
        defaultOutputType: "pdf",
        outputNameFormat: "customer_name",
        fieldsSnapshot: [{ id: "clfield000000000000000001", name: "customer_name" }],
        expiresAt: new Date(Date.now() + 86400000), // Tomorrow
      };

      const mockCurrentTemplate = {
        id: "cltemplat0000000000000001",
        storageKey: "current-storage-key",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        displayName: "Current Name",
        uploadedById: "cluser0000000000000000001",
        fields: [{ id: "clfield000000000000000002", name: "invoice_date" }],
      };

      prisma.templateVersion.findUnique.mockResolvedValue(mockVersion);
      prisma.template.findUnique.mockResolvedValue(mockCurrentTemplate);
      prisma.templateVersion.findFirst.mockImplementation((args) => {
        if (args.orderBy?.versionNumber === "desc") {
          return Promise.resolve({ versionNumber: 1 });
        }
        return Promise.resolve(mockVersion);
      });
      prisma.templateVersion.create.mockResolvedValue({});
      prisma.field.deleteMany.mockResolvedValue({});
      prisma.field.createMany.mockResolvedValue({});
      prisma.template.update.mockResolvedValue({
        ...mockCurrentTemplate,
        ...mockVersion,
        fields: mockVersion.fieldsSnapshot,
      });

      // Mock S3 HeadObjectCommand to succeed
      s3.send.mockResolvedValue({});

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/versions/clversion0000000000000001/revert");

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("Reverted to version");
    });

    test("should return 404 when version not found", async () => {
      prisma.templateVersion.findUnique.mockResolvedValue(null);

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/versions/clnonexis0000000000000001/revert");

      expect(response.status).toBe(404);
    });

    test("should return 404 when template belongs to different user (tenant isolation)", async () => {
      const mockVersion = {
        id: "clversion0000000000000001",
        templateId: "cltemplat0000000000000001",
        versionNumber: 1,
        storageKey: "old-storage-key",
        expiresAt: new Date(Date.now() + 86400000),
      };

      const mockCurrentTemplate = {
        id: "cltemplat0000000000000001",
        uploadedById: "other-user-456", // Different user
        fields: [],
      };

      prisma.templateVersion.findUnique.mockResolvedValue(mockVersion);
      prisma.template.findUnique.mockResolvedValue(mockCurrentTemplate);
      s3.send.mockResolvedValue({});

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/versions/clversion0000000000000001/revert");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe("Template not found");
      expect(prisma.templateVersion.create).not.toHaveBeenCalled();
    });

    test("should return 404 when S3 file not found", async () => {
      const mockVersion = {
        id: "clversion0000000000000001",
        templateId: "cltemplat0000000000000001",
        versionNumber: 1,
        storageKey: "missing-key",
        expiresAt: new Date(Date.now() + 86400000),
      };

      prisma.templateVersion.findUnique.mockResolvedValue(mockVersion);
      s3.send.mockRejectedValue(new Error("Not found"));

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/versions/clversion0000000000000001/revert");

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain("Version file not found");
    });

    test("should return 500 on database error", async () => {
      const mockVersion = {
        id: "clversion0000000000000001",
        templateId: "cltemplat0000000000000001",
        storageKey: "key",
        expiresAt: new Date(Date.now() + 86400000),
      };

      prisma.templateVersion.findUnique.mockResolvedValue(mockVersion);
      s3.send.mockResolvedValue({});
      prisma.template.findUnique.mockRejectedValue(new Error("Database error"));

      const response = await request(app).post("/api/templates/cltemplat0000000000000001/versions/clversion0000000000000001/revert");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to revert template");
    });
  });
});
