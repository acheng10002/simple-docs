/* SUPABASE STORAGE CLIENT
- S3-compatible storage using Supabase
- provides similar interface to s3.js for easier migration */
const { createClient } = require("@supabase/supabase-js");

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
- executes PutObject, GetObject, and HeadObject operations using Supabase Storage */
const storageClient = {
  async send(command) {
    if (command instanceof PutObjectCommand) {
      // upload operation
      const { Key, Body, ContentType } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, Body, {
          contentType: ContentType,
          upsert: true, // overwrites if exists
        });

      if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }
      return data;
    }

    if (command instanceof GetObjectCommand) {
      // download operation
      const { Key } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);

      if (error) {
        throw new Error(`Supabase Storage download failed: ${error.message}`);
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
    }

    if (command instanceof HeadObjectCommand) {
      // metadata check operation
      const { Key } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      // gets file info using list with search
      const pathParts = path.split("/");
      const fileName = pathParts.pop();
      const folder = pathParts.length > 0 ? pathParts.join("/") : "";

      const { data, error } = await supabase.storage.from(bucket).list(folder, {
        search: fileName,
      });

      if (error) {
        throw new Error(`Supabase Storage head failed: ${error.message}`);
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
    }

    if (command instanceof DeleteObjectCommand) {
      // delete operation
      const { Key } = command.params;
      const { bucket, path } = getBucketAndPath(Key);

      const { error } = await supabase.storage.from(bucket).remove([path]);

      if (error) {
        throw new Error(`Supabase Storage delete failed: ${error.message}`);
      }

      // mimics S3 DeleteObjectCommand response
      return { DeleteMarker: false, VersionId: null };
    }

    throw new Error(`Unknown command type: ${command.constructor.name}`);
  },
};

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
};
