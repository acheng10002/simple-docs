// imports the AWS SDK v3 S3 pieces I need
const {
  /* the HTTP client used to talk to S3 
  HTTP client - any piece of software that sends HTTP requests and reads HTTP responses */
  S3Client,
  // operation to upload bytes to a buffer/key
  PutObjectCommand,
  // operation to download bytes (returns a stream)
  GetObjectCommand,
  // lightweight metadata check (size, etag, etc.) without downloading
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

// instantiates a single S3 client for the whole app
const s3 = new S3Client({
  // reads the AWS region from my .env
  region: process.env.AWS_REGION,
});

/* helper to consistently add an optional prefix (a "folder-like" path) to all S3 keys (each 
key corresponds to a stored object/file) */
function withPrefix(key) {
  // returns the original key
  return key;
}

module.exports = {
  /* exposes s3 client instance to send commands with:
  await s3.send(new PutObjectCommand({...}) */
  s3,
  // the 3 command classes I'll construct per call
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  // builds consistent S3 object keys everywhere
  withPrefix,
};
