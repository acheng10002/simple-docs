/* TEMPLATE SERVICE - TEMPLATE UTILITIES AND ORCHESTRATION
Coordinates field extraction across all format services and manages template storage */

const prisma = require('../config/prisma');
const path = require('path');
const { s3, HeadObjectCommand, withPrefix } = require('../storage/supabase-storage');

// Import format-specific services
const docxService = require('./docxService');
const htmlService = require('./htmlService');
const pdfService = require('./pdfService');
const xlsxService = require('./xlsxService');
const pptxService = require('./pptxService');

/**
 * Get Content-Type based on file extension
 */
function contentTypeFor(name) {
  const ext = path.extname(name).toLowerCase();

  if (ext === '.docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.html' || ext === '.htm')
    return 'text/html';
  if (ext === '.pdf')
    return 'application/pdf';
  if (ext === '.xlsx')
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.pptx')
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  return 'application/octet-stream';
}

/**
 * Resolve template file metadata for download
 * Finds template in DB, resolves S3 path, stats file, derives MIME type
 */
async function resolveTemplateFile(templateId) {
  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) return null;

  const s3Key = withPrefix(`uploads/${tpl.storageKey}`);
  let head;

  try {
    head = await s3.send(
      new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s3Key })
    );
  } catch {
    return { tpl, missing: true };
  }

  return {
    tpl,
    s3Key,
    stat: { size: Number(head.ContentLength || 0) },
    etag: head.ETag,
    lastModified: head.LastModified,
    contentType: contentTypeFor(tpl.storageKey),
    downloadName: tpl.displayName,  // Use user-friendly display name for downloads
  };
}

/**
 * Extract fields from template buffer based on MIME type
 * Delegates to appropriate format service
 */
async function extractFieldsFromTemplate(buffer, mimeType) {
  switch (mimeType) {
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return await docxService.extractDocxFields(buffer);

    case 'text/html':
      return await htmlService.extractHtmlFields(buffer);

    case 'application/pdf':
      return await pdfService.extractPdfFields(buffer);

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return await xlsxService.extractXlsxFields(buffer);

    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return await pptxService.extractPptxFields(buffer);

    default:
      throw new Error(`Unsupported template format: ${mimeType}`);
  }
}

/**
 * Store template and its fields in database
 * Creates Template + Field[] rows via Prisma
 */
async function storeTemplateAndFields(storageKey, displayName, mimeType, fieldNames) {
  return await prisma.template.create({
    data: {
      storageKey,
      displayName,
      mimeType,
      fields: {
        create: fieldNames.map((name) => ({ name })),
      },
    },
    include: {
      fields: true,
    },
  });
}

module.exports = {
  contentTypeFor,
  resolveTemplateFile,
  extractFieldsFromTemplate,
  storeTemplateAndFields,
};
