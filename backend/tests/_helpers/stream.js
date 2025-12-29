/* Node's Readable strem class from the built-in stream module 
Readable (stream) - data source I can read from (e.g. files, HTTP responses, S3 bodies) */
const { Readable } = require("stream");
/* Readable.from(iterable) builds a Readable stream from any iterable
- stream emits buf as the first chunk then...
- ends immediately if there are no more items in the iterable 
- this way, I get a proper Node Readable stream that behaves like a remote body but sourced from an in-memory buffer */
exports.bufferToStream = (buf) => Readable.from([buf]);
