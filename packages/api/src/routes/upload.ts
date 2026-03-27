/**
 * Upload routes — presigned URL generation for direct browser-to-bucket uploads.
 *
 *   POST /api/upload/pfp — generate a presigned PUT URL for a profile picture
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { createPresignedUploadUrl, isStorageConfigured } from "../lib/storage.js";

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

// Presigned URL expiry: 5 minutes
const URL_EXPIRY_SECONDS = 300;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUploadRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/upload/pfp — presigned URL for profile picture upload
  // -------------------------------------------------------------------------

  app.post("/api/upload/pfp", requireAuth(db), async (c) => {
    if (!isStorageConfigured()) {
      return c.json(
        { error: "File upload not available (object storage not configured)" },
        503,
      );
    }

    const body = await parseJsonBody(c, "POST /api/upload/pfp");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { filename, contentType } = body as {
      filename?: string;
      contentType?: string;
    };

    if (!contentType) {
      return c.json({ error: "contentType is required" }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return c.json(
        {
          error: `Invalid contentType. Must be one of: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
        },
        400,
      );
    }

    const user = c.get("user");
    const ext = MIME_TO_EXT[contentType] ?? "bin";
    const key = `pfp/${user.id}/${randomUUID()}.${ext}`;

    // Ignore the filename param for the key (security) but accept it for API compat
    void filename;

    const result = await createPresignedUploadUrl(
      key,
      contentType,
      MAX_FILE_SIZE,
      URL_EXPIRY_SECONDS,
    );

    return c.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
    });
  });

  return app;
}
