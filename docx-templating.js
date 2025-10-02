/* **DOCX RENDER & LINT HELPERS
 *** PIZZIP - ZIP HANDLING FOR DOCX CONTAINERS */
const PizZip = require("pizzip");
/* *** DOCXTEMPLATER - DOCX TEMPLATING ENGINE
Docxtemplater - templating engine that replaces placeholders inside DOCX; DOCX -> merged DOCX;
                centralizes Docxtemplater options, normalizes its errors, and provides 2 functions: a linter and a renderer
linter - tool that does static analysis on code to debug; fast, pre-merge checks that catch template problems early */
const Docxtemplater = require("docxtemplater");

/* *** DOCXTEMPLATER OPTIONS  
- sets Mustache-style {{ }} delimiters and a strict nullGetter that throws when a tag has no value */
const DOCX_OPTIONS = {
  /* when looping over arrays, Docxtemplater will duplicate whole paragraphs for each item 
  ex. items: ["A", "B"] -> - item: A
                           - item: B */
  paragraphLoop: true,
  /* converts \n inside my string values into propert Word line breaks 
  ex. address: "123 Main St \nPhiladelphia, PA" -> 2 lines in the same paragraph */
  linebreaks: true,
  // tells Docxtemplater to use Mustache-style delimiters, {{name}} instead of {name}
  delimiters: { start: "{{", end: "}}" },
  /* *** STRICT NULLGETTER - THROWS A STRUCTURED TEMPLATE_PARSE_ERROR
  nullGetter is hook that runs when a tag resolves to null/undefined */
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

/* *** TEMPLATEPARSEERROR EXTENDS ERROR - DOMAIN ERROR WITH DETAILS ARRAY
domain error - error that's valid programmatically but invalid for the problem's rules
               i.e. payload passes JSON schema but violates business constraints, like
               endDate < startDate
- lets me throw/catch a custom error class and still get stacks but with my own type */
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

/* *** ISDOCXERROR(E) & MAPDOCXDETAILS(E) DETECT/NORMALIZE DOCXTEMPLATER'S ERROR SHAPE
type guard for Docxtemplater errors (single or multi) 
- in templateUploadHandler.js AND docx-templating because: 
- old/bad templates may already be in the db
- files could be modified on disk outside my upload flow
- future regressions shouldn't crash merges 
const e = {
  message: "TemplateError",
  properties: {
    id: "undefined_tag",
    explanation: 'The tag "lastName" is undefined',
    xtag: "{{lastName}}",
    file: "word/document.xml",
    offset: 2345
  }
};
isDocxError(e); // => true 
mapDocxDetails(e);
// => [
      { id: "undefined_tag",
        explanation: 'The tag "lastName" is undefined',
        xtag: "{{lastName}}",
        file: "word/document.xml",
        offset: 2345 }
] */
function isDocxError(e) {
  /* this looks like a Docxtemplater error if either:
  - e.properties.errors exists (Docxtemplater's array of detailed errors) or e.properties.id exists */
  return !!(e && e.properties && (e.properties.errors || e.properties.id));
}

/* normalize errors to a consistent details array 
- extracts a clean id/explanation/xtag/file/offset list */
function mapDocxDetails(e) {
  /* Docxtemplater throws a TemplateError that carries extra info on e.properties.errors
  (array of parse errors) */
  const list = Array.isArray(e.properties?.errors) ? e.properties.errors : [e];
  /* if there are properties and errors, they are a template-parse problem (bad tags, duplicate
    braces, etc.) */
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

/* *** CORE RENDERER
- this is my private engine - DOCX render helper with unified error handling 
- renderer - function that takes a DOCX template and outputs the filled .docx, the merged artifact, 
             in the same format as the template with data
-- DOCX templates go through merge/render, DocxBufferOrThrow via Docxtemplater
-- (HTML templates go through merge/render, renderHtmlBuffer via Mustache)
-- converters will then transform the merged/filled DOCX to another format 
- buffer - raw file bytes; data = {} - key/value object for the tags which defaults to empty
- options object - destructure allowNulls with default of false; options defaults to {} */
function renderInternal(buffer, data = {}, options = {}) {
  // allowNulls - a "back door" flag that the linter uses to relax nullGetter
  const { allowNulls = false } = options;
  /* *** OPENS DOCX WITH PIZZIP   
  PizZip - ZIP reader/writer used by Docxtemplater to open .docx which are ZIPs  
  ZIP - compressed archive format that can bundle many files/folders into one file
  - opens the DOCX (which is a ZIP) in memory so Docxtemplater can read its XML parts
  XML - plain-text data format for structuring information using tags I define
  - a .docx file is a ZIP, a package, of XML files plus assets (images, fonts) */
  const zip = new PizZip(buffer);
  const docxOpts = allowNulls
    ? /* *** IN ALLOWSNULL MODE USED BY LINTER, RELAXES NULLGETTER TO RETURN "" INSTEAD OF THROWING 
      relaxes nullGetter only during lint - doesn't throw nullGetter during lint mode 
      - if allowNulls is true (e.g. during lint), I override the default nullGetter to return missing 
      or undefined tags as an empty strings, so render won't throw on undefined variables */
      { ...DOCX_OPTIONS, nullGetter: () => "" }
    : DOCX_OPTIONS;
  /* *** INSTANTIATES DOCXTEMPLATER 
  instantiates templating engine with the opened zip and the chosen options */
  const doc = new Docxtemplater(zip, docxOpts);
  try {
    /* *** CALLS .RENDER(DATA), THEN .GETZIP().GENERATE({ TYPE: "NODEBUFFER" })
    executes the template render; Docxtemplater instance passes data directly to render() */
    doc.render(data);
  } catch (e) {
    /* *** CATCHES DOCXTEMPLATER ERRORS AND THROWS TEMPLATEPARSEERROR(DETAILS)
    - detects its specific error shape via isDocxError(e) 
    - normalize it into a domain error, TemplateParseError, with a clean, client-safe details array 
      produced by mapDocxDetails(e) */
    if (isDocxError(e)) throw new TemplateParseError(mapDocxDetails(e), e);
    // if it's not a Docxtemplater-style error, rethrow the original error unchanged
    throw e;
  }
  /* returns the final merged DOCX from Docxtemplater instance as a Node.js Buffer, ready to write 
  to disk or convert to PDF */
  return doc.getZip().generate({ type: "nodebuffer" });
}

/* *** LINTDOCXBUFFER(BUFFER) RENDERS WITH ALLOWNULLS: TRUE AND RETURNS A LIST OF PARSE ERRORS OR []; 
LINT WRAPPER 
- public API used at upload time inside POST /api/upload route, after I detect the uploaded file is DOCX
- DOCX linter validates delimiter structure, tag/structures/syntax and returns diagnostics
-- lintDocxBuffer(buffer) returns [] if ok, or an array of { id, explanation, xtag, file, offset } */
function lintDocxBuffer(buffer) {
  try {
    /* only delimiter/tag structure errors should surface here 
    - only the linter should pass allowNulls: true; if I exported that flag publicly, app code could
      accidentally do relaxed merges and ship bad docs */
    renderInternal(buffer, {}, { allowNulls: true });
    return [];
  } catch (e) {
    if (e instanceof TemplateParseError) return e.details;
    // non-templating failure during lint (e.g. corrupt zip) -> surface minimal info
    return [{ id: "unknown_error", explanation: e.message }];
  }
}

/* *** RENDERDOCXBUFFERORTHROW(BUFFER, DATA): STRICT MERGE (THROWS TEMPLATEPARSEERROR ON TEMPLATE ISSUES)
MERGE HELPER - DOCX templating 
- this is my public merge API; it calls the engine with the strict setting (no allowNulls) so real merges 
  must error on missing tags
render - do the actual merge, throwing a TemplateParseError or template issues */
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
