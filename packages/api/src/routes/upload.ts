/**
 * Upload routes — server-side file upload to Linode Object Storage.
 *
 *   POST /api/upload/pfp — upload a profile picture (multipart/form-data)
 *   GET  /api/files/:key — proxy-read files from object storage
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { uploadObject, readObject, isStorageConfigured } from "../lib/storage.js";

// Allowed image MIME types for PFPs
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// Map MIME type to file extension
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Max file size: 2 MB
const MAX_FILE_SIZE = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUploadRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/upload/pfp — upload profile picture (multipart form-data)
  // -------------------------------------------------------------------------

  app.post("/api/upload/pfp", requireAuth(db), async (c) => {
    if (!isStorageConfigured()) {
      return c.json(
        { error: "File upload not available (object storage not configured)" },
        503,
      );
    }

    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ error: "file field is required (multipart/form-data)" }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      return c.json(
        {
          error: `Invalid file type. Must be one of: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
        },
        400,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: "File must be under 2 MB" }, 400);
    }

    const user = c.get("user");
    const ext = MIME_TO_EXT[file.type] ?? "bin";
    const key = `pfp/${user.id}/${randomUUID()}.${ext}`;

    // Determine API base URL from request
    const url = new URL(c.req.url);
    const apiBaseUrl = `${url.protocol}//${url.host}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadObject(key, file.type, buffer, apiBaseUrl);

    return c.json({
      publicUrl: result.publicUrl,
      key: result.key,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/files/:path — proxy-read files from object storage
  // -------------------------------------------------------------------------

  app.get("/api/files/*", async (c) => {
    if (!isStorageConfigured()) {
      return c.json({ error: "File storage not configured" }, 503);
    }

    const key = c.req.path.replace("/api/files/", "");
    if (!key) {
      return c.json({ error: "File key is required" }, 400);
    }

    // Only allow reads from known prefixes
    if (!key.startsWith("pfp/")) {
      return c.json({ error: "Not found" }, 404);
    }

    try {
      const file = await readObject(key);
      if (!file.body) {
        return c.json({ error: "Not found" }, 404);
      }

      return new Response(file.body, {
        headers: {
          "Content-Type": file.contentType ?? "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (err: unknown) {
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (code === 404) {
        return c.json({ error: "Not found" }, 404);
      }
      throw err;
    }
  });

  return app;
}
