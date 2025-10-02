/* central Multer config shared across routes 
multer - middleware, async/await, that parses multipart/form-data of file uploads (the incoming request) from 
         <input type="file"> or curl -F for Express, and runs before the route handler accepts a file (the routes
         can be attached to this middleware)    
- multer determines the storage engine for the uploaded file:     
.memoryStorage() - with upload.single("template"), temporarily parses file bytes into RAM memory, as one Buffer object/at req.file.buffer 
                   and any text fields, on req.body, no file is written to disk (buffer-first, streamed-piped somewhere as it) i.e. 
                   parse CSV, upload to S3, virus-scan in memory; req.file.buffer is then one storage object that I can reuse everywhere
                   fast storage that clears on reboot/crash (nothing persists)
- then file will inspected/validated, and lastly optionally saved instead of written to a temp folder on disk 
.diskStorage() - immediately writes the file to disk with my naming/path logic like uploads/ (or remote) but 
                  without me touching it; much slower storage that surivives reboot 
buffer - chunk of raw binary data stored in memory
- Multer supports custom storage engines, and there are community packages:
-- S3: multer-s3, Amazon Simple Storage Service
--- durable, scalable object storage service from AWS 
--- I store files (“objects”) in buckets, access them over HTTPS, and control access with IAM policies (Identity and Access 
    Management, who can do what to which resources under which conditions). 
--- Common features: pre-signed URLs for direct browser uploads/downloads, versioning, lifecycle policies (auto-archive/delete),
    server-side encryption, cross-region replication, great for storing user uploads, templates, and generated documents   
-- multer finds the field name named template (must match -F "template=@file", DOCX or HTML, or in curl)
-- and, for client-server alignment, multer populates:
--- req.file.buffer - raw file bytes, Buffer
--- req.file.originalname - e.g. sample.html
--- req.file.mimetype - e.g. text/html */
const multer = require("multer");

// *** MULTER MIDDLEWARE IN MEMORY STORAGE MODE - PUTS FILE BYTES IN REQ.FILE.BUFFER
const storage = multer.memoryStorage();

// base limits I can tweak in one place - 15MB, limits for file size, number of files, parts, etc.
const BASE_LIMITS = { fileSize: 15 * 1024 * 1024 };

/* *** FACTORY FUNCTION TO CREATE MULTER INSTANCES WITH BASE LIMITS AND PER-ROUTE FILTERS
WITH OPTIONAL OVERRIDES 
- makeUpload() gets called once per route config at module load time
- each multer instance is stateless between requests
--- Multer does not keep state for any pre-request buffers, streams, filenames, temp paths, or parsed fields/files; 
    all of the per-request/per file state disappears after the request/response cycle 
--- on each request, Multer spins up a new, streaming parser, Busboy, and wires it to my multer storage engine
---- Busboy parses the HTTP. byte stream, decodes each part's headers, emits events with Node streams, handles 
     backpressure efficiently, enforces limits, and is format-focused; everything is stream-driven (each request 
     gets fresh, isolated parsing objects)
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
*** UPLOADTEMPLATE ACCEPTS .DOCX AND .HTML TEMPLATES
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
      "text/html",
      // checks if the uploaded file's mimeType is in the allow-list; sets ok to true if allowed
    ].includes(file.mimetype);
    /* calls Multer's callback to accept or reject the file 
    - cb(error, acceptBoolean) 
    - if ok is true, cb(null, true); if ok is false, cb ( new Error(), false) */
    cb(ok ? null : new Error("Unsupported template type"), ok);
  },
});

/* *** UPLOADCSV ACCEPTS CSV MIMETYPES
csv--specific filters/limits */
const uploadCsv = makeUpload({
  fileFilter: (req, file, cb) => {
    /* accepts text/csv and common CSV mimetypes 
    - checks if the uploaded file's mimeType is in the allow-list ; sets ok to true if allowed */
    const ok = ["text/csv", "application/vnd.ms-excel"].includes(file.mimetype);
    /* calls Multer's callback to accept or reject the file 
    - cb(error, acceptBoolean) 
    - if ok is true, cb(null, true); if ok is false, cb ( new Error(), false) */
    cb(ok ? null : new Error("Unsupported CSV type"), ok);
  },
  // CSVs can be larger
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* when the upload instance is exported (i.e. uploadTemplate or uploadCSV), the same upload instance 
can be used across routes and concurrent requests */
module.exports = { makeUpload, uploadTemplate, uploadCsv };
