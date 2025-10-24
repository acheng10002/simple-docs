/* central Multer config shared across routes 
- Multer supports custom storage engines, and there are community packages:
-- S3: multer-s3, Amazon Simple Storage Service
-- multer finds the field name named template (must match -F "template=@file", DOCX or HTML, or in curl)
-- for client-server alignment, multer populates:
--- req.file.buffer - raw file bytes, Buffer
--- req.file.originalname - e.g. sample.html
--- req.file.mimetype - e.g. text/html */
const multer = require("multer");

// *** MULTER MIDDLEWARE IN MEMORY STORAGE MODE - PUTS FILE BYTES IN REQ.FILE.BUFFER
const storage = multer.memoryStorage();

// base limits I can tweak in one place - 15MB, limits for file size, number of files, parts, etc.
const BASE_LIMITS = { fileSize: 15 * 1024 * 1024 };

/* FACTORY FUNCTION TO CREATE MULTER INSTANCES WITH BASE LIMITS AND PER-ROUTE FILTERS
WITH OPTIONAL OVERRIDES 
- makeUpload() gets called once per route config at module load time
- each multer instance is stateless between requests
- options argument has two parts ( options arg defaults to {} so calling makeUpload() is safe): 
- limits - defaults to an empty object 
- fileFilter - optional callback to accept or reject files */
function makeUpload({ limits = {}, fileFilter } = {}) {
  // creates and returns a configured middleware, multer instance
  return multer({
    // uses pre-defined storage, RAM
    storage,
    /* supplies upload limits to Multer, and merges route-specific limits over BASE_LIMITS 
    - in object spread, later properties win
    - keys from the first object are copied, then keys from the second object are copied over 
      them; the value from the second object overwrites the one from the first object
    - if both define the same key, route limit's value overrides the base limit's */
    limits: { ...BASE_LIMITS, ...limits },
    // optional per-route validation- lets a route decide which mimetypes/filenames to accept
    fileFilter,
  });
}

/* uploadTemplate and uploadCsv are prebuilt route-specific middlewares
UPLOADTEMPLATE ACCEPTS .DOCX AND .HTML TEMPLATES
- template-specific filters/limits */
const uploadTemplate = makeUpload({
  /* req - Express request
  file - Multer's file descriptor; has file.mimetype, file.originalname, etc.
  cb - per-file decision hook/callback parameter that Multer passes into the optional fileFilter 
       function and I must call it exactly once inside fileFilter to accept/reject the file */
  fileFilter: (req, file, cb) => {
    // allows .docx and .html MIME types
    const ok = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/zip",
      "text/html",
      "application/xhtml+xml",
      // checks if the uploaded file's mimeType is in the allow-list; sets ok to true if allowed
    ].includes(file.mimetype);
    /* calls Multer's callback to accept or reject the file 
    - cb(error, acceptBoolean) 
    - if ok is true, cb(null, true); if ok is false, cb ( new Error(), false) */
    cb(ok ? null : new Error("Unsupported template type"), ok);
  },
});

/* UPLOADCSV ACCEPTS CSV MIMETYPES
csv - specific filters/limits */
const uploadCsv = makeUpload({
  fileFilter: (req, file, cb) => {
    /* accepts text/csv and common CSV mimetypes 
    - checks if the uploaded file's mimeType is in the allow-list ; sets ok to true if allowed */
    const ok = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/csv",
      "text/x-csv",
      "application/x-csv",
      "text/plain",
      "application/octet-stream",
    ].includes(file.mimetype);
    // calls Multer's callback to accept or reject the file
    cb(ok ? null : new Error("Unsupported CSV type"), ok);
  },
  // CSVs can be larger
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* when the upload instance is exported (i.e. uploadTemplate or uploadCSV), the same upload instance 
can be used across routes and concurrent requests */
module.exports = { makeUpload, uploadTemplate, uploadCsv };
