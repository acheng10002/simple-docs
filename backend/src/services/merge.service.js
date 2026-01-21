/* MERGE SERVICE - FORMAT-AGNOSTIC ORCHESTRATOR
Coordinates merging across all format services and manages output generation */

const path = require('path');
const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const logger = require('../config/logger');
const {
  s3,
  PutObjectCommand,
  GetObjectCommand,
  withPrefix,
} = require('../storage/supabase-storage');

// Import format-specific services
const docxService = require('./docxService');
const htmlService = require('./htmlService');
const pdfService = require('./pdfService');
const xlsxService = require('./xlsxService');
const pptxService = require('./pptxService');
const conversionService = require('./conversionService');

/**
 * Timeout wrapper for promises
 */
function withTimeout(promise, ms, operation) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timeout after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

/**
 * Load template buffer from S3
 */
async function loadTemplateBuffer(template) {
  const key = withPrefix(`uploads/${template.storageKey}`);
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    })
  );

  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Extract dot-path keys from nested object
 */
function flattenKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * Map of allowed output types per template MIME type
 */
const ALLOWED_OUTPUTS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['pdf', 'docx', 'html', 'jpg'],
  'text/html': ['pdf', 'docx', 'html'],
  'application/pdf': ['pdf', 'jpg'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'pdf'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'ppsx', 'pdf', 'jpg'],
};

/**
 * Get file extension for output type
 */
function getExtension(outputType) {
  return outputType;
}

/**
 * Get Content-Type for output type
 */
function getContentType(outputType) {
  const types = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    html: 'text/html',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    jpg: 'image/jpeg',
  };
  return types[outputType] || 'application/octet-stream';
}

/**
 * Add test watermark footer to PDF buffer
 * Uses pdf-lib to add "TEST - NOT FOR PRODUCTION" footer to each page
 */
async function addTestFooterToPdf(pdfBuffer) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const footerText = 'TEST - NOT FOR PRODUCTION';
  const fontSize = 10;

  for (const page of pages) {
    const { width } = page.getSize();
    const textWidth = helveticaFont.widthOfTextAtSize(footerText, fontSize);

    // Draw footer centered at bottom of page
    page.drawText(footerText, {
      x: (width - textWidth) / 2,
      y: 20,
      size: fontSize,
      font: helveticaFont,
      color: rgb(0.5, 0.5, 0.5), // Gray color
    });
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Add test watermark footer to HTML buffer
 */
function addTestFooterToHtml(htmlBuffer) {
  const html = htmlBuffer.toString('utf-8');
  const footerHtml = `
    <div style="position: fixed; bottom: 10px; left: 0; right: 0; text-align: center; font-size: 10px; color: gray; font-family: sans-serif;">
      TEST - NOT FOR PRODUCTION
    </div>
  `;

  // Insert before </body> if exists, otherwise append
  if (html.includes('</body>')) {
    return Buffer.from(html.replace('</body>', footerHtml + '</body>'));
  }
  return Buffer.from(html + footerHtml);
}

/**
 * Main merge orchestrator
 * Delegates to format-specific services based on template MIME type
 */
async function mergeTemplate({
  templateId,
  data,
  outputType,
  userId = null,
  fromWebhook = false,
  testMode = false,
}) {
  // Fetch template with fields
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    include: { fields: true },
  });

  if (!template) throw new Error('Template not found');

  // Validate data against stored fields
  const allowed = new Set(template.fields.map((f) => f.name));
  const provided = flattenKeys(data);
  const extras = provided.filter((k) => !allowed.has(k));
  if (extras.length) logger.warn({ extras }, 'Unexpected fields in merge data');

  const providedSet = new Set(provided);
  const missing = [...allowed].filter((k) => !providedSet.has(k));
  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.status = 422;
    throw err;
  }

  // Validate output type for template format
  const allowedOutputs = ALLOWED_OUTPUTS[template.mimeType];
  if (!allowedOutputs || !allowedOutputs.includes(outputType)) {
    throw new Error(
      `outputType '${outputType}' not supported for ${template.mimeType}. ` +
      `Allowed: ${allowedOutputs?.join(', ') || 'none'}`
    );
  }

  // Load template bytes from S3
  const templateBuffer = await loadTemplateBuffer(template);

  // Merge template based on format
  let mergedBuffer;
  let intermediateFormat = null;

  switch (template.mimeType) {
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      // DOCX template
      mergedBuffer = await docxService.fillDocxTemplate(templateBuffer, data);
      intermediateFormat = 'docx';
      break;
    }

    case 'text/html': {
      // HTML template
      mergedBuffer = htmlService.fillHtmlTemplate(templateBuffer, data);
      if (fromWebhook) {
        mergedBuffer = htmlService.sanitizeHtml(mergedBuffer);
      }
      intermediateFormat = 'html';
      break;
    }

    case 'application/pdf': {
      // PDF form template
      mergedBuffer = await pdfService.fillPdfForm(templateBuffer, data);
      intermediateFormat = 'pdf';
      break;
    }

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
      // XLSX template
      mergedBuffer = await xlsxService.fillXlsxTemplate(templateBuffer, data, outputType);
      intermediateFormat = 'xlsx';
      break;
    }

    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
      // PPTX template
      mergedBuffer = await pptxService.fillPptxTemplate(templateBuffer, data, outputType);
      intermediateFormat = 'pptx';
      break;
    }

    default:
      throw new Error(`Unsupported template format: ${template.mimeType}`);
  }

  // Convert to desired output format if needed
  let outputBuffer = mergedBuffer;

  // DOCX conversions
  if (intermediateFormat === 'docx' && outputType !== 'docx') {
    if (outputType === 'pdf') {
      outputBuffer = await docxService.convertDocxToPdf(mergedBuffer);
    } else if (outputType === 'html') {
      outputBuffer = await docxService.convertDocxToHtml(mergedBuffer);
    } else if (outputType === 'jpg') {
      outputBuffer = await conversionService.convertDocxToJpg(
        mergedBuffer,
        docxService.convertDocxToHtml
      );
    }
  }

  // HTML conversions
  if (intermediateFormat === 'html' && outputType !== 'html') {
    if (outputType === 'pdf') {
      outputBuffer = await htmlService.convertHtmlToPdf(mergedBuffer);
    } else if (outputType === 'docx') {
      outputBuffer = await htmlService.convertHtmlToDocx(mergedBuffer);
    }
  }

  // PDF conversions
  if (intermediateFormat === 'pdf' && outputType === 'jpg') {
    outputBuffer = await conversionService.convertPdfToJpg(mergedBuffer);
  }

  // PPTX conversions
  if (intermediateFormat === 'pptx' && outputType === 'jpg') {
    // Note: PPTX to JPG requires PPTX->PDF->JPG conversion
    logger.warn('PPTX to JPG conversion not fully implemented, returning PPTX');
    // TODO: Implement PPTX to PDF conversion using LibreOffice
  }

  // Generate filename based on template settings
  const safeBase = path
    .basename(template.displayName)
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.[^.]+$/, '');

  // outputNameFormat is now required, but check for safety
  if (!template.outputNameFormat || !data[template.outputNameFormat]) {
    logger.error({
      templateId: template.id,
      outputNameFormat: template.outputNameFormat,
      dataKeys: Object.keys(data),
      dataValues: data,
    }, 'outputNameFormat validation failed');
    throw new Error('Template outputNameFormat is not configured or field value is missing');
  }

  // Use outputNameFormat field value for filename
  const fieldValue = String(data[template.outputNameFormat])
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.+$/, '') // Remove trailing dots to prevent double-dot issues
    .substring(0, 100); // Limit field value length
  const baseFilename = `${safeBase}-${fieldValue}`;
  const ext = getExtension(outputType);

  // Check for existing files with same name and add incremental counter if needed
  let filename = baseFilename;
  let counter = 0;
  let isDuplicate = true;

  while (isDuplicate) {
    const testPath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${filename}.${ext}`)}`;
    const existing = await prisma.mergeJob.findFirst({
      where: { filePath: testPath },
    });

    if (!existing) {
      isDuplicate = false;
    } else {
      counter++;
      filename = `${baseFilename}-${counter}`;
    }
  }

  const filePath = `s3://${process.env.S3_BUCKET}/${withPrefix(`outputs/${filename}.${ext}`)}`;

  // Upload to S3
  const s3Key = filePath.replace(/^s3:\/\/[^/]+\//, '');
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: outputBuffer,
      ContentType: getContentType(outputType),
    })
  );

  // Create MergeJob record
  const job = await prisma.mergeJob.create({
    data: {
      templateId: template.id,
      data,
      outputType,
      status: 'succeeded',
      filePath,
      userId: userId || null,
    },
  });

  return { jobId: job.id, filePath };
}

module.exports = { mergeTemplate };
