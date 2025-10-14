const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { s3, GetObjectCommand } = require("./s3");

/*
Download an S3 object to a local file using streaming (low memory)
@param {object} opts
@param {string} opts.bucket
@param {string} opts.key
@param {string} opts.destPath
@returns {Promise<{ bytes?: number, contentType?: string, path: string }>}
*/

async function downloadS3ObjectToFile({ bucket, key, destPath }) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const out = fs.createWriteStream(destPath);
    await pipeline(resp.Body, out);

    return {
      bytes: resp.ContentLength,
      contentType: resp.ContentType,
      path: destPath,
    };
  } catch (e) {
    const status = e.$metadata?.httpStatusCode;
    if (status === 404 || e.name === "NoSuckKey") {
      const err = new Error(`S3 object not found: s3://${bucket}/${key}`);
      err.code = "ENOENT";
      throw err;
    }
    if (status === 403 || e.name === "AccessDenied") {
      const err = new Error(`Access denied for s3://${bucket}/${key}`);
      err.code = "EACCES";
      throw err;
    }
    throw e;
  }
}

module.exports = { downloadS3ObjectToFile };
