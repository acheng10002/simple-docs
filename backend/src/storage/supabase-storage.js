/* SUPABASE STORAGE CLIENT
- S3-compatible storage using Supabase
- provides similar interface to s3.js for easier migration
- includes retry logic with exponential backoff for transient errors */
const { createClient } = require("@supabase/supabase-js");

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.STORAGE_MAX_RETRIES, 10) || 3,
  baseDelayMs: parseInt(process.env.STORAGE_RETRY_BASE_MS, 10) || 100,
  maxDelayMs: parseInt(process.env.STORAGE_RETRY_MAX_MS, 10) || 5000,
};

/**
 * Check if an error is transient and should be retried
 */
function isTransientError(error) {
  if (!error) return false;

  const message = (error.message || "").toLowerCase();
  const status = error.status || error.statusCode;

  // Rate limiting
  if (status === 429) return true;

  // Server errors (5xx)
  if (status >= 500 && status < 600) return true;

  // Network/timeout errors
  if (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("temporarily unavailable")
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateBackoff(attempt) {
  // Exponential: baseDelay * 2^attempt
  const exponentialDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelayMs);

  // Add jitter (±25%)
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic
 * @param {Function} fn - Async function to execute
 * @param {string} operation - Operation name for logging
 * @returns {Promise<any>} - Result from fn
 */
async function withRetry(fn, operation) {
  let lastError;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry non-transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= RETRY_CONFIG.maxRetries) {
        throw error;
      }

      // Calculate backoff and wait
      const delayMs = calculateBackoff(attempt);
      console.log(
        `[Storage] ${operation} failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), ` +
          `retrying in ${delayMs}ms: ${error.message}`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// validates required environment variables
if (!process.env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL is required for Supabase Storage");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Supabase Storage");
}

// creates Supabase client with service role key (bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // disables auth for service role operations
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/* helper to consistently add an optional prefix (a "folder-like" path) to all storage paths */
function withPrefix(key) {
  const prefix = (process.env.STORAGE_PREFIX || "").trim();
  const clean = (s) =>
    String(s || "")
      // trims leading slashes
      .replace(/^\/*/, "")
      // no parent segments
      .replace(/\.\./g, "");
  // returns the original key
  if (!prefix) return clean(key);
  return `${clean(prefix).replace(/\/+$/, "")}/${clean(key)}`;
}

/* determines which bucket to use based on the file path
- uploads/* -> templates bucket
- outputs/* -> outputs bucket */
function getBucketAndPath(key) {
  const cleanKey = withPrefix(key);

  if (cleanKey.startsWith("uploads/")) {
    return {
      bucket: "templates",
      path: cleanKey.replace(/^uploads\//, ""),
    };
  }

  if (cleanKey.startsWith("outputs/")) {
    return {
      bucket: "outputs",
      path: cleanKey.replace(/^outputs\//, ""),
    };
  }

  // fallback to templates bucket if no prefix matches
  return {
    bucket: "templates",
    path: cleanKey,
  };
}

/* PutObjectCommand-compatible wrapper for Supabase Storage upload
- mimics AWS SDK v3 PutObjectCommand interface */
class PutObjectCommand {
  constructor(params) {
    this.params = params;
  }
}

/* GetObjectCommand-compatible wrapper for Supabase Storage download
- mimics AWS SDK v3 GetObjectCommand interface */
class GetObjectCommand {
  constructor(params) {
    this.params = params;
  }
}

/* HeadObjectCommand-compatible wrapper for Supabase Storage metadata check
- mimics AWS SDK v3 HeadObjectCommand interface */
class HeadObjectCommand {
  constructor(params) {
    this.params = params;
  }
}

/* DeleteObjectCommand-compatible wrapper for Supabase Storage delete
- mimics AWS SDK v3 DeleteObjectCommand interface */
class DeleteObjectCommand {
  constructor(params) {
    this.params = params;
  }
}

/* Storage client wrapper that mimics S3Client.send() interface
- executes PutObject, GetObject, and HeadObject operations using Supabase Storage
- automatically retries transient errors with exponential backoff */
const storageClient = {
  async send(command) {
    if (command instanceof PutObjectCommand) {
      // upload operation with retry
      const { Key, Body, ContentType } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      return withRetry(async () => {
        const { data, error } = await supabase.storage
          .from(bucket)
          .upload(path, Body, {
            contentType: ContentType,
            upsert: true, // overwrites if exists
          });

        if (error) {
          const err = new Error(`Supabase Storage upload failed: ${error.message}`);
          err.status = error.statusCode || error.status;
          throw err;
        }
        return data;
      }, `upload ${Key}`);
    }

    if (command instanceof GetObjectCommand) {
      // download operation with retry
      const { Key } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      return withRetry(async () => {
        const { data, error } = await supabase.storage
          .from(bucket)
          .download(path);

        if (error) {
          const err = new Error(`Supabase Storage download failed: ${error.message}`);
          err.status = error.statusCode || error.status;
          throw err;
        }

        // converts Blob to Node.js stream to match S3 GetObjectCommand response
        const buffer = Buffer.from(await data.arrayBuffer());
        const { Readable } = require("stream");
        const stream = Readable.from(buffer);

        // mimics S3 GetObjectCommand response structure
        return {
          Body: stream,
          ContentType: data.type,
          ContentLength: data.size,
        };
      }, `download ${Key}`);
    }

    if (command instanceof HeadObjectCommand) {
      // metadata check operation with retry
      const { Key } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      // gets file info using list with search
      const pathParts = path.split("/");
      const fileName = pathParts.pop();
      const folder = pathParts.length > 0 ? pathParts.join("/") : "";

      return withRetry(async () => {
        const { data, error } = await supabase.storage.from(bucket).list(folder, {
          search: fileName,
        });

        if (error) {
          const err = new Error(`Supabase Storage head failed: ${error.message}`);
          err.status = error.statusCode || error.status;
          throw err;
        }

        // finds the specific file in the list
        const file = data?.find((f) => f.name === fileName);

        if (!file) {
          const notFoundError = new Error("Not Found");
          notFoundError.name = "NotFound";
          throw notFoundError;
        }

        // mimics S3 HeadObjectCommand response structure
        return {
          ContentLength: file.metadata?.size || 0,
          ContentType: file.metadata?.mimetype || "application/octet-stream",
          LastModified: new Date(file.updated_at || file.created_at),
        };
      }, `head ${Key}`);
    }

    if (command instanceof DeleteObjectCommand) {
      // delete operation with retry
      const { Key } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      return withRetry(async () => {
        const { error } = await supabase.storage.from(bucket).remove([path]);

        if (error) {
          const err = new Error(`Supabase Storage delete failed: ${error.message}`);
          err.status = error.statusCode || error.status;
          throw err;
        }

        // mimics S3 DeleteObjectCommand response
        return { DeleteMarker: false, VersionId: null };
      }, `delete ${Key}`);
    }

    throw new Error(`Unknown command type: ${command.constructor.name}`);
  },
};

/**
 * Check storage connectivity by listing from templates bucket
 * @returns {Promise<{ok: boolean, latencyMs: number, error?: string}>}
 */
async function checkStorageHealth() {
  const start = Date.now();
  try {
    const { error } = await supabase.storage
      .from("templates")
      .list("", { limit: 1 });

    if (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

module.exports = {
  /* exposes storage client instance to send commands with:
  await storageClient.send(new PutObjectCommand({...})) */
  s3: storageClient,
  // the 3 command classes I'll construct per call
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  // builds consistent storage paths everywhere
  withPrefix,
  // exposes raw Supabase client for advanced operations
  supabase,
  // health check for storage connectivity
  checkStorageHealth,
};
