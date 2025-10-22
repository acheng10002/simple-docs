// Node's fs API
const fs = require("fs");
// path utilities
const path = require("path");
// promise-based pipline helper for streaming
const { pipeline } = require("stream/promises");
// initialized S3 client plus the GetObject command
const { s3, GetObjectCommand } = require("./s3");

/* async function that will download an object from S3 (bucket + key) and save it as a 
local file (destPath) */
async function downloadS3ObjectToFile({ bucket, key, destPath }) {
  // ensures the destination directory exists (creates parent folders if needed)
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  /* chooses a temporary filename next to the final destination 
  - this enables atomic writes (write to temp, then rename)
  - using PID + timestamp reduces collisions */
  const tmpPath = `${destPath}.part-${process.pid}-${Date.now()}`;
  // opens a writable stream to the temp file
  const out = fs.createWriteStream(tmpPath);

  let resp;
  try {
    // sends a GetObject request to S3 and awaits the response
    resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    const status = e.$metadata?.httpStatusCode;
    /* using either HTTP 404 or SDK error name... */
    if (status === 404 || e.name === "NoSuckKey") {
      // normalizes "missing object" errors into a familiar local-file style error (ENOENT)
      const err = new Error(`S3 object not found: s3://${bucket}/${key}`);
      err.code = "ENOENT";
      throw err;
    }
    if (status === 403 || e.name === "AccessDenied") {
      // similarly normalizes permission errors into EACCES
      const err = new Error(`Access denied for s3://${bucket}/${key}`);
      err.code = "EACCES";
      throw err;
    }
    // any other error, rethrow as-is
    throw e;
  }

  try {
    /* streams the S3 response body, a readable stream, into the temp file, out, using pipeline 
    - this propagates stream errors and closes streams for me */
    await pipeline(resp.Body, out);
    // on success, atomically renames the temp file to the final destPath
    await fs.promises.rename(tmpPath, destPath);
    // if streaming or renaming fails, the code...
  } catch (e) {
    try {
      // tries to close the temp file stream
      out.destroy();
    } catch {}
    try {
      // tries to delete the temp file (so no corrupt partial filers linger)
      await fs.promises.rm(tmpPath, { force: true });
    } catch {}
    // rethrows the original error
    throw e;
  }

  // returns a metadata bundle...
  return {
    // the object's content length from S3 header
    bytes: resp.ContentLength,
    // its type from S3 header
    contentType: resp.ContentType,
    // and the final local path
    path: destPath,
  };
}

module.exports = { downloadS3ObjectToFile };
