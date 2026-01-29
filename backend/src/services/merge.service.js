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
 * Add test watermark footer to DOCX buffer
 * Uses pizzip and docxtemplater to add footer to document
 */
async function addTestFooterToDocx(docxBuffer) {
  const PizZip = require('pizzip');
  const zip = new PizZip(docxBuffer);

  // Footer XML content with "TEST - NOT FOR PRODUCTION" text
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:color w:val="808080"/>
        <w:sz w:val="20"/>
      </w:rPr>
      <w:t>TEST - NOT FOR PRODUCTION</w:t>
    </w:r>
  </w:p>
</w:ftr>`;

  // Add footer file to the zip
  zip.file('word/footer1.xml', footerXml);

  // Update document.xml.rels to reference the footer
  const relsPath = 'word/_rels/document.xml.rels';
  if (zip.file(relsPath)) {
    let relsContent = zip.file(relsPath).asText();

    // Check if footer relationship already exists
    if (!relsContent.includes('footer1.xml')) {
      // Find the highest rId number
      const rIdMatches = relsContent.match(/rId(\d+)/g) || [];
      const maxRId = rIdMatches.reduce((max, rId) => {
        const num = parseInt(rId.replace('rId', ''), 10);
        return num > max ? num : max;
      }, 0);
      const newRId = `rId${maxRId + 1}`;

      // Add footer relationship before closing tag
      const footerRel = `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`;
      relsContent = relsContent.replace('</Relationships>', footerRel + '</Relationships>');
      zip.file(relsPath, relsContent);

      // Update document.xml to reference the footer
      const docPath = 'word/document.xml';
      if (zip.file(docPath)) {
        let docContent = zip.file(docPath).asText();

        // Add footer reference to sectPr if it exists
        if (docContent.includes('<w:sectPr')) {
          // Add footerReference before the closing sectPr tag
          const footerRef = `<w:footerReference w:type="default" r:id="${newRId}"/>`;
          docContent = docContent.replace(/<w:sectPr([^>]*)>/, `<w:sectPr$1>${footerRef}`);
          zip.file(docPath, docContent);
        }
      }

      // Update [Content_Types].xml to include footer content type
      const contentTypesPath = '[Content_Types].xml';
      if (zip.file(contentTypesPath)) {
        let contentTypes = zip.file(contentTypesPath).asText();
        if (!contentTypes.includes('footer1.xml')) {
          const footerOverride = '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>';
          contentTypes = contentTypes.replace('</Types>', footerOverride + '</Types>');
          zip.file(contentTypesPath, contentTypes);
        }
      }
    }
  }

  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

/**
 * Add test watermark footer to XLSX buffer
 * Uses exceljs to add header/footer to print settings
 */
async function addTestFooterToXlsx(xlsxBuffer) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);

  // Add footer to each worksheet
  workbook.eachSheet((worksheet) => {
    worksheet.headerFooter = {
      ...worksheet.headerFooter,
      oddFooter: '&C&8&K808080TEST - NOT FOR PRODUCTION',
      evenFooter: '&C&8&K808080TEST - NOT FOR PRODUCTION',
    };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Add test watermark to PPTX buffer
 * Adds text box with watermark to each slide
 */
async function addTestFooterToPptx(pptxBuffer) {
  const PizZip = require('pizzip');
  const zip = new PizZip(pptxBuffer);

  // Get list of slide files
  const slideFiles = Object.keys(zip.files).filter(name =>
    name.match(/^ppt\/slides\/slide\d+\.xml$/)
  );

  // Add watermark text box to each slide
  for (const slidePath of slideFiles) {
    let slideContent = zip.file(slidePath).asText();

    // Create a text box shape for the watermark
    const watermarkShape = `
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="99999" name="TestWatermark"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="6400000"/>
            <a:ext cx="9144000" cy="300000"/>
          </a:xfrm>
          <a:prstGeom prst="rect"/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr lang="en-US" sz="1000">
                <a:solidFill>
                  <a:srgbClr val="808080"/>
                </a:solidFill>
              </a:rPr>
              <a:t>TEST - NOT FOR PRODUCTION</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;

    // Insert the watermark shape before the closing spTree tag
    if (slideContent.includes('</p:spTree>')) {
      slideContent = slideContent.replace('</p:spTree>', watermarkShape + '</p:spTree>');
      zip.file(slidePath, slideContent);
    }
  }

  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

/**
 * Add test watermark to JPG buffer
 * Uses sharp to add text overlay
 */
async function addTestFooterToJpg(jpgBuffer) {
  // Dynamic import for sharp (if available) or fallback
  try {
    const sharp = require('sharp');

    const image = sharp(jpgBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;

    // Create SVG text overlay
    const svgText = `
      <svg width="${width}" height="${height}">
        <rect x="0" y="${height - 30}" width="${width}" height="30" fill="rgba(255,255,255,0.8)"/>
        <text x="${width / 2}" y="${height - 10}" font-family="sans-serif" font-size="12" fill="#808080" text-anchor="middle">
          TEST - NOT FOR PRODUCTION
        </text>
      </svg>`;

    return await image
      .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
  } catch {
    // If sharp is not available, return original buffer with a warning
    logger.warn('Sharp not available for JPG watermark, returning original image');
    return jpgBuffer;
  }
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

  // Test mode: add footer, return buffer directly without saving
  if (testMode) {
    let testBuffer = outputBuffer;

    // Add test footer based on output type
    switch (outputType) {
      case 'pdf':
        testBuffer = await addTestFooterToPdf(outputBuffer);
        break;
      case 'html':
        testBuffer = addTestFooterToHtml(outputBuffer);
        break;
      case 'docx':
        testBuffer = await addTestFooterToDocx(outputBuffer);
        break;
      case 'xlsx':
        testBuffer = await addTestFooterToXlsx(outputBuffer);
        break;
      case 'pptx':
      case 'ppsx':
        testBuffer = await addTestFooterToPptx(outputBuffer);
        break;
      case 'jpg':
        testBuffer = await addTestFooterToJpg(outputBuffer);
        break;
      default:
        // For any other format, use original buffer
        logger.warn({ outputType }, 'No test watermark implementation for this format');
    }

    return {
      testMode: true,
      buffer: testBuffer,
      filename: `${filename}.${ext}`,
      contentType: getContentType(outputType),
    };
  }

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
  // Note: We don't store raw merge data to avoid PII exposure
  const job = await prisma.mergeJob.create({
    data: {
      templateId: template.id,
      data: null,
      outputType,
      status: 'succeeded',
      filePath,
      userId: userId || null,
    },
  });

  return { jobId: job.id, filePath };
}

module.exports = { mergeTemplate };
