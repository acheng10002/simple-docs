/* DOCX RENDER & LINT HELPERS
PIZZIP - ZIP reader/writer used by Docxtemplater to open .docx which are ZIPs */
const PizZip = require("pizzip");
/* DOCXTEMPLATER - DOCX TEMPLATING ENGINE 
edits XML parts and then re-zips the package back into a valid .docx */
const Docxtemplater = require("docxtemplater");

/* *** DOCXTEMPLATER OPTIONS  
- sets Mustache-style {{ }} delimiters and a strict nullGetter that throws when a tag has no value */
const DOCX_OPTIONS = {
  // when looping over arrays, Docxtemplater will duplicate whole paragraphs for each item
  paragraphLoop: true,
  // converts \n inside my string values into proper Word line breaks
  linebreaks: true,
  // tells Docxtemplater to use Mustache-style delimiters, {{name}} instead of {name}
  delimiters: { start: "{{", end: "}}" },
  // nullGetter is hook that runs when a tag resolves to null/undefined
  nullGetter: (part) => {
    // part.value is the tag name like "firstName"
    const tag = part?.value;
    // throws a custom TEMPLATE_PARSE_ERROR when a tag resolves to null/undefined
    const err = new Error("TEMPLATE_PARSE_ERROR");
    err.details = [
      { id: "undefined_tag", explanation: `Tag "${tag}" is undefined` },
    ];
    throw err;
  },
};

// lets me throw/catch a custom error class and still get stacks but with my own type
class TemplateParseError extends Error {
  /* details - structured info about what went wrong i.e. Docxtemplater errors
  cause - original low-level error */
  constructor(details, cause) {
    // calls the parent Error constructor with a message, sets err.message
    super("TEMPLATE_PARSE_ERROR");
    // overrides the default name ("Error")
    this.name = "TemplateParseError";
    // attaches my structured payload so callers can return helpful 422 responses
    this.details = details;
    // if provided, stores the original error
    if (cause) this.cause = cause;
  }
}

/* ISDOCXERROR(E) & MAPDOCXDETAILS(E) DETECT/NORMALIZE DOCXTEMPLATER'S ERROR SHAPE
type guard for Docxtemplater errors (single or multi) */
function isDocxError(e) {
  /* a Docxtemplater error if either:
  - e.properties.errors exists (Docxtemplater's array of detailed errors) or e.properties.id exists */
  return !!(e && e.properties && (e.properties.errors || e.properties.id));
}

// normalize errors to a consistent details array
function mapDocxDetails(e) {
  // Docxtemplater throws a TemplateError that carries extra info on e.properties.errors
  const list = Array.isArray(e.properties?.errors) ? e.properties.errors : [e];
  // if there are errors, they are a template-parse problem (bad tags, duplicate braces, etc.)
  return list.map((er) => ({
    // machine-friendly code e.g. duplicate_open-tag
    id: er.properties?.id,
    // short human description e.g. "Duplicate open tag, expected one open tag"
    explanation: er.properties?.explanation,
    // snippet of the offending text e.g. {{last, Name}}
    xtag: er.properties?.xtag,
    // which XML part (often word/document.xml)
    file: er.properties?.file,
    // byte/char position within that file's text slice
    offset: er.properties?.offset,
  }));
}

/* CORE RENDERER
buffer - raw file bytes 
data = {} - key/value object for the tags which defaults to empty
options object - destructure allowNulls with default of false; options defaults to {} */
function renderInternal(buffer, data = {}, options = {}) {
  // allowNulls - a "back door" flag that the linter uses to relax nullGetter
  const { allowNulls = false } = options;
  /* OPENS DOCX WITH PIZZIP   
  ZIP - compressed archive format that can bundle many files/folders into one file
  opens the DOCX (which is a ZIP) in memory so Docxtemplater can read its XML parts
  XML - plain-text data format for structuring information using tags I define
  - a .docx file is a ZIP container, a package of XML files, plus assets (images, fonts) */
  const zip = new PizZip(buffer);
  const docxOpts = allowNulls
    ? /* IN ALLOWSNULL MODE USED BY LINTER, RELAXES NULLGETTER TO RETURN "" INSTEAD OF THROWING 
      - so render won't throw on undefined variables */
      { ...DOCX_OPTIONS, nullGetter: () => "" }
    : DOCX_OPTIONS;
  // INSTANTIATES DOCXTEMPLATER
  const doc = new Docxtemplater(zip, docxOpts);
  try {
    /* CALLS .RENDER(DATA), THEN .GETZIP().GENERATE({ TYPE: "NODEBUFFER" })
    Docxtemplater instance passes data directly to render() which executes the template render */
    doc.render(data);
  } catch (e) {
    // CATCHES DOCXTEMPLATER ERRORS AND THROWS TEMPLATEPARSEERROR(DETAILS)
    if (isDocxError(e)) throw new TemplateParseError(mapDocxDetails(e), e);
    // if it's not a Docxtemplater-style error, rethrow the original error unchanged
    throw e;
  }
  // returns the final merged DOCX from Docxtemplater instance as a Node.js Buffer,
  return doc.getZip().generate({ type: "nodebuffer" });
}

/* LINTDOCXBUFFER(BUFFER) RENDERS WITH ALLOWNULLS: TRUE; 
- public API used at upload time inside POST /api/upload route, after I detect the uploaded file is DOCX
- DOCX linter validates delimiter structure, tag/structures/syntax and returns diagnostics
- lintDocxBuffer(buffer) returns [] if ok, or an parse errors array of { id, explanation, xtag, file, offset } */
function lintDocxBuffer(buffer) {
  try {
    // only delimiter/tag structure errors should surface here
    renderInternal(buffer, {}, { allowNulls: true });
    return [];
  } catch (e) {
    if (e instanceof TemplateParseError) return e.details;
    // non-templating failure during lint (e.g. corrupt zip) -> surfaces minimal info
    return [{ id: "unknown_error", explanation: e.message }];
  }
}

/* RENDERDOCXBUFFERORTHROW(BUFFER, DATA): STRICT MERGE (THROWS TEMPLATEPARSEERROR ON TEMPLATE ISSUES)
MERGE HELPER - DOCX templating 
- public merge API, calls the engine with the strict setting (no allowNulls) so real merges must error on 
  missing tags */
function renderDocxBufferOrThrow(templateBuffer, data) {
  return renderInternal(templateBuffer, data);
}

module.exports = {
  DOCX_OPTIONS,
  TemplateParseError,
  lintDocxBuffer,
  renderDocxBufferOrThrow,
};

// KEY LIBS: PIZZIP, DOCXTEMPLATER
