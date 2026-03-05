/* TEMPLATE UPLOAD ENDPOINT (A PUBLIC API SURFACE) & PLACEHOLDER DISCOVERY 
- CALLS INTO SERVICES: UPLOAD PATH -> TEMPLATE.SERVICE.JS (PERSIST METADATA) AND LINTS (HTML: HTML-LINT.JS; DOCX: DOCX-TEMPLATING.JS)
- accepts .docx/.html uploads, validates file type, lints HTML & DOCX, extracts placeholders, AND THEN saves template 
  to disk and metadata to the db */
// backend framework that handles HTTP requests and response
const express = require("express");
// function that inspects the file signature part of a file's raw binary data
const FileType = require("file-type");
// module that provides utilities for working with file and directory paths safely
const path = require("path");
const { randomUUID } = require("crypto");
const authenticateSupabase = require("../middleware/supabase-auth");
const prisma = require("../config/prisma");
const { errorResponse, ErrorCodes } = require("../utils/errorResponse");
// middleware specific to template upload route
const { uploadTemplate } = require("../middleware/upload.middleware");
// service functions that produce the db records merge.service.js will read
const {
  extractFieldsFromTemplate,
  storeTemplateAndFields,
} = require("../services/template.service");
const { validate } = require("../middleware/validate");
const {
  templateIdParams,
  templateVersionParams,
  updateTemplateBody,
} = require("../schemas/template.schemas");

// shared linter utilities
const { lintDocxBuffer } = require("../utils/docx-templating");
const { lintHtmlBuffer } = require("../utils/html-lint");
// Supabase Storage instance
const {
  s3,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  withPrefix,
} = require("../storage/supabase-storage");

// creates a new isolated router object
const router = express.Router();

/* MULTER
A1. TEMPLATE UPLOAD - INGESTION & DISCOVERY: multipart body parsing */

// allowed MIME types - docx, html, pdf, xlsx, pptx
const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "text/html", // HTML
  "application/pdf", // PDF
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // XLSX
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
];

// fallback map from known file exts to their expected MIME types if magic-byte MIME detection fails
const FALLBACK_MIME_MAP = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html",
  ".htm": "text/html",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/* upload route
- multer.memoryStorage() middleware, async/await (which runs before the route handler accepts a file)... 
-- gets plugged into this route
-- finds the field name named template (must match -F "template=@file", DOCX or HTML, or in curl)
-- and, for client-server alignment, populates:
--- req.file.buffer - raw file bytes, Buffer
--- req.file.originalname - e.g. sample.html
--- req.file.mimetype - e.g. text/html */
router.post("/upload", authenticateSupabase, uploadTemplate.single("template"), async (req, res) => {
  try {
    /* gets the uploaded file from the request, and responds with 400 Bad Request if no file found 
    
    A2. TEMPLATE UPLOAD - INGESTION & DISCOVERY: basic request guard */
    const file = req.file;
    // POSSIBLE ERROR - no file sent
    if (!file) return errorResponse.badRequest(res, "No file uploaded", ErrorCodes.MISSING_FIELD);

    // MIME (detection & normalization
    const declared = (file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname).toLowerCase();

    /* VALIDATES TYPE WITH FILE-TYPE + EXTENSION FALLBACKS
    MAGIC-BYTE MIME DETECTION (+FALLBACKS)
    inspects file's binary content, its file signature (magic bytes), and tries to infer/validate the MIME type 
    - file-type lib's fromBuffer function reads the  magic bytes, first N bytes 
    - file-type compares that byte pattern against a db of known file signatures (with known mappings to MIME types)
    - if a match is found, function returns an object with file extension and MIME type 
    
    A3. TEMPLATE UPLOAD - INGESTION & DISCOVERY: file type detection (magic bytes + fallback)
    TEMPLATE UPLOAD & PARSE - CHECKS MIME TYPE FROM UPLOAD (I have raw bytes in req.file.buffer)
    TEMPLATE UPLOAD & PARSE - VALIDATES FILE SIGNATURE WITH FILE-TYPE LIBRARY
    A3a. primary file type detection (magic bytes + fallback) */
    let fileType = await FileType.fromBuffer(file.buffer);

    /* extension-based fallback if fileTypeFromBuffer/magic-byte detection fails to detect MIME type from 
    the file's binary content; fallback executes regardless of ZIP status 
    A3b. fallback file type detection by extension (+zip signature for .docx) */
    if (!fileType) {
      // extracts file ext from uploaded file's original name and converts it to lowercase
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === ".docx") {
        const ZIP_MAGIC = "504b0304";
        /* extracts the first 4 bytes from the file's raw binary data, converts those 4 bytes into a hex,
        compares the result to the known ZIP magic number/file signature, and stores the boolean result */
        const isZip = file.buffer.slice(0, 4).toString("hex") === ZIP_MAGIC;
        /* for docx, if the file signature is ZIP_MAGIC and the file ext is recognized, assign a fallback MIME 
        type */
        if (isZip) {
          // sets a fileType object
          fileType = {
            // removes the leading dot bc file-type returns extensions without the dot
            ext: "docx",
            // returns the corresponding MIME type from the fallback map
            mime: FALLBACK_MIME_MAP[".docx"],
          };
        }
        // HTML relies on detection
      } else if (ext === ".html" || ext === ".htm") {
        fileType = {
          ext: ext.slice(1),
          mime: FALLBACK_MIME_MAP[".html"],
        };
      }
    }

    // cross-checks and finalizes
    const finalMime =
      fileType?.mime ||
      (ext === ".docx"
        ? FALLBACK_MIME_MAP[".docx"]
        : ext === ".html" || ext === ".htm"
          ? FALLBACK_MIME_MAP[".html"]
          : null);

    /*  compares MIME types & if still no fileType or if file type not on the allowed list, reject

    A3c. allow-list enforcement */
    if (!finalMime || !ALLOWED_MIME_TYPES.includes(finalMime)) {
      //  POSSIBLE ERROR - type not allowed or MIME detection rejected the file
      return errorResponse.unsupportedMediaType(res, "Unsupported or undetectable file type");
    }

    if (declared && declared !== finalMime) {
      req.log.warn(
        { declaredMime: declared, computedMime: finalMime },
        "MIME type mismatch detected"
      );
    }

    /* BLOCKS EXECUTION ON DOCX/HTML TEMPLATE ROUTES IF TEMPLATES ARE INVALID
    HTML ONLY LINT - LINTS HTML WITH LINTHTMLBUFFER FROM HTML-LINT.JS 
    - blocks bad HTML
    A3d. lint HTML delimiters before saving anything (fail-fast) */
    if (fileType.ext === "html" || fileType.mime === "text/html") {
      // calls my HTML linter on the raw bytes, req.file.buffer
      const { errors, warnings } = lintHtmlBuffer(file.buffer, {
        // flag any http(s):// references as warnings
        allowRemote: false,
        // no requirePrintCss
        requirePrintCss: false,
      });
      // if there are warnings, log them to the server console but continue
      if (warnings.length)
        req.log.warn({ warnings }, "HTML template has warnings");
      // if there are errors, fail fast, send 422 Unprocessable Entity with details
      if (errors.length) {
        return errorResponse.unprocessable(
          res,
          "Template blocked by HTML linter",
          ErrorCodes.TEMPLATE_PARSE_ERROR,
          { details: errors }
        );
      }
    }

    /* DOCX ONLY LINT - LINTS DOCX WITH LINTDOCXBUFFER FROM DOCX-TEMPLATING.JS IN "ALLOW NULLS" MODE
    - blocks bad DOCX
    A3d. lint DOCX delimiters before saving anything (fail-fast) */
    if (fileType.ext === "docx") {
      // when upload hits my endpoint, DOCX linter will run
      const lint = lintDocxBuffer(file.buffer);
      if (lint.length) {
        return errorResponse.unprocessable(
          res,
          "Template has invalid Docxtemplater delimiters/tags",
          ErrorCodes.TEMPLATE_PARSE_ERROR,
          { details: lint }
        );
      }
    }

    /* PERSIST & PARSE
    A4. TEMPLATE UPLOAD - INGESTION & DISCOVERY: prepare filenames
    - displayName: Original filename as uploaded by user (e.g. "My Invoice.docx")
    - storageKey: Sanitized, timestamped S3 key (e.g. "1735482000-uuid-My_Invoice.docx") */

    const sanitize = (name) => path.basename(name).replace(/[^\w.\- ]+/g, "_");

    // Original filename for display (preserve spaces and special chars)
    const originalName = path.basename(file.originalname);

    // Sanitized filename for S3 storage
    const safeName = sanitize(file.originalname);
    const stamped = `${Date.now()}-${randomUUID()}-${safeName}`;

    // Handle duplicate display names with auto-increment (per user)
    let displayName = originalName;
    let counter = 1;
    while (await prisma.template.findFirst({
      where: { displayName, isActive: true, uploadedById: req.user.id }
    })) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      displayName = `${base} (${counter})${ext}`;
      counter++;
    }

    /* WRITES SANITIZED/TIMESTAMPED FILENAME TO UPLOADS_DIR VIA FS/PROMISES
    A5. TEMPLATE UPLOAD - INGESTION & DISCOVERY: persist original uploaded file 

    /* S3 upload of original template
    builds the object key (path/filename) that the file will have in my S3 bucket 
    - template literal inserts the timestamped filename, stamped, into uploads/ 
    - result with be /uploads/1696038435123-sample.html */
    const s3Key = withPrefix(`uploads/${stamped}`);
    // uses AWS SDK v3 client instance s3 to send a command
    await s3.send(
      // creates a PutObjectCommand i.e. upload this object to S3
      new PutObjectCommand({
        // options object includes name of the target S3 bucket pulled from my .env and...
        Bucket: process.env.S3_BUCKET,
        // the destination key in S# (path + filename)
        Key: s3Key,
        /* the actual bytes to upload, file buffer is the in-memory buffer I got from Multer's memoryStorage()
        - S3 will store these bytes as the object's content */
        Body: file.buffer,
        /* sets the object's Content-Type metadata 
        - this helps browsers and downstream services handle the file correctly (e.g. render vs download) */
        ContentType: fileType.mime,
      })
    );

    /* FIELD EXTRACTION - delegates to format-specific service based on MIME type
    Extracts placeholders/fields from the template using the appropriate parser:
    - DOCX: Docxtemplater placeholders
    - HTML: Mustache placeholders
    - PDF: Form field names
    - XLSX: Cell placeholders
    - PPTX: Slide placeholders

    A6-A7. TEMPLATE UPLOAD - INGESTION & DISCOVERY: extracts fields via format-specific service */
    const fieldNames = await extractFieldsFromTemplate(file.buffer, finalMime);

    let savedTemplate;
    try {
      /* persists a new Template record with storageKey (S3 key), displayName (user-friendly), mimeType and nested
      fields, Field[] (creates one Field[] row for each field)
      - Prisma call uses include: { fields: true }, so returned template object includes savedTemplate.fields

      PERSIST TEMPLATE + FIELDS VIA PRISMA
      A8a. TEMPLATE UPLOAD - INGESTION & DISCOVERY: persists template metadata + fields */
      savedTemplate = await storeTemplateAndFields(stamped, displayName, finalMime, fieldNames, req.user.id);
    } catch (dbError) {
      // ROLLBACK: Deletes the S3 file if db save fails
      req.log.warn({ s3Key }, "Database save failed, cleaning up S3 file");
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: s3Key,
          })
        );
        req.log.info({ s3Key }, "S3 file cleanup successful");
      } catch (cleanupErr) {
        req.log.error(
          { cleanupErr, s3Key },
          "S3 cleanup failed - orphaned file"
        );
      }
      // Re-throws the original database error
      throw dbError;
    }

    // OUTPUT - JSON 200 returns templateId and deduped field names meaning upload and parse succeeded
    res.status(200).json({
      /* A8b. TEMPLATE UPLOAD - INGESTION & DISCOVERY: this templateId is what merge API uses later as
      db id of the newly saved template 
      A9. TEMPLATE UPLOAD - INGESTION & DISCOVERY: respond to client */
      templateId: savedTemplate.id,
      // names of the fields via .map(f => f.name)
      fields: savedTemplate.fields.map((f) => f.name),
      // confirms successful upload and validation of file signature
      message: `File "${file.originalname}" successfully uploaded and validated.`,
    });

    /* A10. TEMPLATE UPLOAD - INGESTION & DISCOVERY: error handling
    - catches and logs any unexpected server errors, unexpected issues return 500; validation failures already 
      exited with 400/415 */
  } catch (err) {
    req.log.error({ err }, "Upload failed");
    errorResponse.internal(res, "Internal server error");
  }
});

/* GET /api/templates
- lists all templates (both active and inactive) for the authenticated user */
router.get(
  "/templates",
  authenticateSupabase,
  async (req, res) => {
    try {
      const templates = await prisma.template.findMany({
        where: {
          uploadedById: req.user.id,
        },
        include: {
          fields: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.json(templates);
    } catch (err) {
      req.log.error({ err }, "Failed to fetch templates");
      errorResponse.internal(res, "Failed to load templates");
    }
  }
);

/* GET /api/templates/:id/versions
 * Returns all non-expired version history for a template */
router.get(
  "/templates/:id/versions",
  authenticateSupabase,
  validate({ params: templateIdParams }),
  async (req, res) => {
    try {
      const { id } = req.params; // Already validated by Zod

      // Verify template exists and belongs to user
      const template = await prisma.template.findUnique({
        where: { id },
      });

      if (!template || template.uploadedById !== req.user.id) {
        return errorResponse.notFound(res, "Template not found", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      // Get all non-expired versions, ordered by version number ascending (oldest first)
      const versions = await prisma.templateVersion.findMany({
        where: {
          templateId: id,
          expiresAt: { gt: new Date() },
        },
        orderBy: {
          versionNumber: "asc",
        },
        select: {
          id: true,
          versionNumber: true,
          displayName: true,
          createdAt: true,
          mimeType: true,
          fieldsSnapshot: true,
        },
      });

      res.json(versions);
    } catch (err) {
      req.log.error(
        { err, templateId: req.params.id },
        "Failed to fetch version history"
      );
      errorResponse.internal(res, "Failed to load version history");
    }
  }
);

/* POST /api/templates/:id/versions/:versionId/revert
 * Reverts template to a specific version */
router.post(
  "/templates/:id/versions/:versionId/revert",
  authenticateSupabase,
  validate({ params: templateVersionParams }),
  async (req, res) => {
    try {
      const { id, versionId } = req.params; // Already validated by Zod

      // First, check if the version exists at all
      const versionCheck = await prisma.templateVersion.findUnique({
        where: { id: versionId },
        select: { id: true, templateId: true, expiresAt: true, versionNumber: true },
      });

      if (!versionCheck) {
        req.log.warn({ versionId, templateId: id }, "Version ID not found in database");
        return errorResponse.notFound(res, "Version not found. It may have been deleted or never existed.", ErrorCodes.NOT_FOUND);
      }

      if (versionCheck.templateId !== id) {
        req.log.warn(
          { versionId, requestedTemplateId: id, actualTemplateId: versionCheck.templateId },
          "Version belongs to different template"
        );
        return errorResponse.notFound(res, "Version not found for this template.", ErrorCodes.NOT_FOUND);
      }

      if (versionCheck.expiresAt <= new Date()) {
        req.log.warn(
          { versionId, expiresAt: versionCheck.expiresAt },
          "Version has expired"
        );
        return errorResponse.notFound(res, "Version has expired and is no longer available.", ErrorCodes.NOT_FOUND);
      }

      // Fetch the full version data
      const version = await prisma.templateVersion.findUnique({
        where: { id: versionId },
      });

      if (!version) {
        return errorResponse.notFound(res, "Version not found or has expired", ErrorCodes.NOT_FOUND);
      }

      // Verify the S3 file still exists
      const s3Key = withPrefix(`uploads/${version.storageKey}`);
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: s3Key,
          })
        );
      } catch (s3Error) {
        req.log.error(
          { s3Key, storageKey: version.storageKey, versionId, s3Error: s3Error.message },
          "Version file not found in S3"
        );
        return errorResponse.notFound(res, "Version file not found in storage. The file may have been deleted.", ErrorCodes.FILE_NOT_FOUND);
      }

      // Get current template state and verify ownership
      const currentTemplate = await prisma.template.findUnique({
        where: { id },
        include: { fields: true },
      });

      if (!currentTemplate || currentTemplate.uploadedById !== req.user.id) {
        return errorResponse.notFound(res, "Template not found", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      // Create version of CURRENT state before reverting
      const maxVersion = await prisma.templateVersion.findFirst({
        where: { templateId: id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      const nextVersionNumber = (maxVersion?.versionNumber || 0) + 1;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 60);

      await prisma.templateVersion.create({
        data: {
          templateId: id,
          versionNumber: nextVersionNumber,
          storageKey: currentTemplate.storageKey,
          mimeType: currentTemplate.mimeType,
          displayName: currentTemplate.displayName,
          defaultOutputType: currentTemplate.defaultOutputType,
          outputNameFormat: currentTemplate.outputNameFormat,
          pageSize: currentTemplate.pageSize,
          orientation: currentTemplate.orientation,
          fieldsSnapshot: currentTemplate.fields.map((f) => ({
            id: f.id,
            name: f.name,
          })),
          expiresAt,
        },
      });

      // Delete current fields
      await prisma.field.deleteMany({
        where: { templateId: id },
      });

      // Restore fields from version snapshot
      await prisma.field.createMany({
        data: version.fieldsSnapshot.map((f) => ({
          templateId: id,
          name: f.name,
        })),
      });

      // Update template to version state
      const updatedTemplate = await prisma.template.update({
        where: { id },
        data: {
          storageKey: version.storageKey,
          mimeType: version.mimeType,
          displayName: version.displayName,
          defaultOutputType: version.defaultOutputType,
          outputNameFormat: version.outputNameFormat,
          pageSize: version.pageSize,
          orientation: version.orientation,
        },
        include: { fields: true },
      });

      req.log.info(
        {
          templateId: id,
          versionId,
          versionNumber: version.versionNumber,
        },
        "Template reverted to previous version"
      );

      res.json({
        message: `Reverted to version ${version.versionNumber}`,
        template: updatedTemplate,
      });
    } catch (err) {
      req.log.error(
        { err, templateId: req.params.id },
        "Failed to revert template"
      );
      errorResponse.internal(res, "Failed to revert template");
    }
  }
);

/* GET /api/templates/:id
- gets a single template by ID */
router.get(
  "/templates/:id",
  authenticateSupabase,
  validate({ params: templateIdParams }),
  async (req, res) => {
    try {
      const { id } = req.params; // Already validated by Zod

      const template = await prisma.template.findUnique({
        where: { id },
        include: {
          fields: true,
        },
      });

      // Check template exists and belongs to user
      if (!template || template.uploadedById !== req.user.id) {
        return errorResponse.notFound(res, "Template not found", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      res.json(template);
    } catch (err) {
      req.log.error({ err, templateId: req.params.id }, "Failed to fetch template");
      errorResponse.internal(res, "Failed to load template");
    }
  }
);

/* DELETE /api/templates/:id
- deactivates a template (soft delete) */
router.delete(
  "/templates/:id",
  authenticateSupabase,
  validate({ params: templateIdParams }),
  async (req, res) => {
    try {
      const { id } = req.params; // Already validated by Zod

      // Check if template exists, belongs to user, and is active
      const template = await prisma.template.findUnique({
        where: { id },
      });

      if (!template || template.uploadedById !== req.user.id) {
        return errorResponse.notFound(res, "Template not found", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      if (!template.isActive) {
        return errorResponse.notFound(res, "Template already deactivated", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      // Deactivate template (soft delete)
      await prisma.template.update({
        where: { id },
        data: { isActive: false },
      });

      req.log.info({ templateId: id }, "Template deactivated");
      res.status(204).send();
    } catch (err) {
      req.log.error({ err, templateId: req.params.id }, "Failed to deactivate template");
      errorResponse.internal(res, "Failed to deactivate template");
    }
  }
);

/* POST /api/templates/:id/activate
- reactivates a deactivated template */
router.post(
  "/templates/:id/activate",
  authenticateSupabase,
  validate({ params: templateIdParams }),
  async (req, res) => {
    try {
      const { id } = req.params; // Already validated by Zod

      // Check if template exists, belongs to user, and is inactive
      const template = await prisma.template.findUnique({
        where: { id },
      });

      if (!template || template.uploadedById !== req.user.id) {
        return errorResponse.notFound(res, "Template not found", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      if (template.isActive) {
        return errorResponse.badRequest(res, "Template is already active", ErrorCodes.VALIDATION_ERROR);
      }

      // Activate template
      await prisma.template.update({
        where: { id },
        data: { isActive: true },
      });

      req.log.info({ templateId: id }, "Template activated");
      res.status(204).send();
    } catch (err) {
      req.log.error({ err, templateId: req.params.id }, "Failed to activate template");
      errorResponse.internal(res, "Failed to activate template");
    }
  }
);

/* PUT /api/templates/:id
- updates a template's metadata (displayName, defaultOutputType, outputNameFormat)
- optionally replaces the template file */
router.put(
  "/templates/:id",
  authenticateSupabase,
  uploadTemplate.single("template"),
  validate({ params: templateIdParams }),
  async (req, res) => {
    try {
      const { id } = req.params; // Already validated by Zod
      const { displayName, defaultOutputType, outputNameFormat, pageSize, orientation } = req.body;
      const file = req.file;

      // Check if template exists and belongs to user
      const existingTemplate = await prisma.template.findUnique({
        where: { id },
        include: { fields: true },
      });

      if (!existingTemplate || existingTemplate.uploadedById !== req.user.id) {
        return errorResponse.notFound(res, "Template not found", ErrorCodes.TEMPLATE_NOT_FOUND);
      }

      // Prepare update data
      const updateData = {};

      // Update displayName if provided
      if (displayName && displayName.trim()) {
        updateData.displayName = displayName.trim();
      }

      // Update defaultOutputType if provided (allow null to clear it)
      if ('defaultOutputType' in req.body) {
        updateData.defaultOutputType = defaultOutputType || null;
      }

      // Update outputNameFormat if provided (allow null to clear it)
      if ('outputNameFormat' in req.body) {
        updateData.outputNameFormat = outputNameFormat || null;
      }

      // Update pageSize if provided (allow null to clear it)
      if ('pageSize' in req.body) {
        updateData.pageSize = pageSize || null;
      }

      // Update orientation if provided (allow null to clear it)
      if ('orientation' in req.body) {
        updateData.orientation = orientation || null;
      }

      // If a replacement file is provided, process it
      if (file) {
        // MIME detection and validation (same as upload route)
        const declared = (file.mimetype || "").toLowerCase();
        const ext = path.extname(file.originalname).toLowerCase();

        let fileType = await FileType.fromBuffer(file.buffer);

        // Extension-based fallback
        if (!fileType) {
          if (ext === ".docx") {
            const ZIP_MAGIC = "504b0304";
            const isZip = file.buffer.slice(0, 4).toString("hex") === ZIP_MAGIC;
            if (isZip) {
              fileType = {
                ext: "docx",
                mime: FALLBACK_MIME_MAP[".docx"],
              };
            }
          } else if (ext === ".html" || ext === ".htm") {
            fileType = {
              ext: ext.slice(1),
              mime: FALLBACK_MIME_MAP[".html"],
            };
          }
        }

        const finalMime =
          fileType?.mime ||
          (ext === ".docx"
            ? FALLBACK_MIME_MAP[".docx"]
            : ext === ".html" || ext === ".htm"
              ? FALLBACK_MIME_MAP[".html"]
              : null);

        if (!finalMime || !ALLOWED_MIME_TYPES.includes(finalMime)) {
          return errorResponse.unsupportedMediaType(res, "Unsupported or undetectable file type");
        }

        // Lint the new file
        if (fileType.ext === "html" || fileType.mime === "text/html") {
          const { errors, warnings } = lintHtmlBuffer(file.buffer, {
            allowRemote: false,
            requirePrintCss: false,
          });
          if (warnings.length)
            req.log.warn({ warnings }, "HTML template has warnings");
          if (errors.length) {
            return errorResponse.unprocessable(
              res,
              "Template blocked by HTML linter",
              ErrorCodes.TEMPLATE_PARSE_ERROR,
              { details: errors }
            );
          }
        }

        if (fileType.ext === "docx") {
          const lint = lintDocxBuffer(file.buffer);
          if (lint.length) {
            return errorResponse.unprocessable(
              res,
              "Template has invalid Docxtemplater delimiters/tags",
              ErrorCodes.TEMPLATE_PARSE_ERROR,
              { details: lint }
            );
          }
        }

        // Create version snapshot of CURRENT state before replacing
        const maxVersion = await prisma.templateVersion.findFirst({
          where: { templateId: id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });

        const nextVersionNumber = (maxVersion?.versionNumber || 0) + 1;

        // Set expiration to 30 days from now
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Snapshot CURRENT state before replacing
        await prisma.templateVersion.create({
          data: {
            templateId: id,
            versionNumber: nextVersionNumber,
            storageKey: existingTemplate.storageKey,
            mimeType: existingTemplate.mimeType,
            displayName: existingTemplate.displayName,
            defaultOutputType: existingTemplate.defaultOutputType,
            outputNameFormat: existingTemplate.outputNameFormat,
            pageSize: existingTemplate.pageSize,
            orientation: existingTemplate.orientation,
            fieldsSnapshot: existingTemplate.fields.map((f) => ({
              id: f.id,
              name: f.name,
            })),
            expiresAt,
          },
        });

        req.log.info(
          { templateId: id, versionNumber: nextVersionNumber },
          "Created template version before replacement"
        );

        // Upload new file to S3
        const sanitize = (name) => path.basename(name).replace(/[^\w.\- ]+/g, "_");
        const safeName = sanitize(file.originalname);
        const stamped = `${Date.now()}-${randomUUID()}-${safeName}`;
        const s3Key = withPrefix(`uploads/${stamped}`);

        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: s3Key,
            Body: file.buffer,
            ContentType: fileType.mime,
          })
        );

        // Extract fields from new file
        const fieldNames = await extractFieldsFromTemplate(file.buffer, finalMime);

        // Update template with new file info
        updateData.storageKey = stamped;
        updateData.mimeType = finalMime;
        // Reset outputNameFormat since fields have changed
        updateData.outputNameFormat = null;

        // Delete old fields and create new ones
        await prisma.field.deleteMany({
          where: { templateId: id },
        });

        await prisma.field.createMany({
          data: fieldNames.map((name) => ({
            templateId: id,
            name,
          })),
        });
      }

      // Update template in database
      const updatedTemplate = await prisma.template.update({
        where: { id },
        data: updateData,
        include: { fields: true },
      });

      req.log.info({ templateId: id }, "Template updated successfully");
      res.json(updatedTemplate);
    } catch (err) {
      req.log.error({ err, templateId: req.params.id }, "Failed to update template");
      errorResponse.internal(res, "Failed to update template");
    }
  }
);

module.exports = router;
