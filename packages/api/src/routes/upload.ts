/**
 * Upload routes — presigned URL generation for browser-direct uploads.
 *
 *   POST /api/upload/pfp — get a presigned PUT URL for a profile picture
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  beginLocalConstrainedUpload,
  completeLocalConstrainedUpload,
  generatePresignedUpload,
  getStorageBackend,
  isStorageConfigured,
  LocalUploadError,
  readLocalUpload,
  releaseLocalConstrainedUpload,
  verifyLocalConstrainedUploadToken,
  verifyLocalUploadToken,
  writeLocalConstrainedUpload,
  writeLocalUpload,
} from "../lib/storage.js";

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

const LOCAL_MEDIA_CONTENT_TYPES = new Set([
  "video/mp4",
  "image/png",
  "image/jpeg",
  "text/vtt",
  "application/json",
]);

const PUBLIC_MEDIA_RESPONSE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
  "Cache-Control": "public, max-age=31536000, immutable",
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUploadRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  app.put("/api/upload/local", async (c) => {
    if (getStorageBackend() !== "local") {
      return c.json({ error: "Local file upload is not enabled" }, 404);
    }

    const key = c.req.query("key");
    const contentType = c.req.query("contentType");
    const expiresAt = Number(c.req.query("expiresAt"));
    const token = c.req.query("token");

    if (!key || !contentType || !token) {
      return c.json({ error: "Missing upload parameters" }, 400);
    }

    const constrainedUpload = parseConstrainedUploadClaims({
      key,
      contentType,
      expiresAt,
      token,
      contentLength: c.req.query("contentLength"),
      sha256: c.req.query("sha256"),
      targetId: c.req.query("targetId"),
    });
    if (constrainedUpload) {
      if (!LOCAL_MEDIA_CONTENT_TYPES.has(contentType)) {
        return c.json({ error: "Unsupported public media content type" }, 400);
      }
      if (!verifyLocalConstrainedUploadToken(constrainedUpload.claims, token)) {
        return c.json({ error: "Upload URL expired or invalid" }, 403);
      }

      const requestContentType = c.req.header("content-type")?.split(";")[0] ?? contentType;
      if (requestContentType !== contentType) {
        return c.json({ error: "Content-Type does not match signed upload" }, 400);
      }
      if (!beginLocalConstrainedUpload(constrainedUpload.claims.targetId)) {
        return c.json({ error: "Upload target is already used or invalid" }, 403);
      }
      try {
        await writeLocalConstrainedUpload(constrainedUpload.claims, await c.req.arrayBuffer());
        completeLocalConstrainedUpload(constrainedUpload.claims.targetId);
        return c.body(null, 204);
      } catch (error) {
        releaseLocalConstrainedUpload(constrainedUpload.claims.targetId);
        if (error instanceof LocalUploadError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return c.json({ error: "Unsupported upload content type" }, 400);
    }

    if (!verifyLocalUploadToken(key, contentType, expiresAt, token)) {
      return c.json({ error: "Upload URL expired or invalid" }, 403);
    }

    const requestContentType = c.req.header("content-type")?.split(";")[0] ?? contentType;
    if (requestContentType !== contentType) {
      return c.json({ error: "Content-Type does not match signed upload" }, 400);
    }

    try {
      await writeLocalUpload(key, contentType, await c.req.arrayBuffer());
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof LocalUploadError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });

  app.options("/api/uploads/local", (c) => c.body(null, 204, {
    ...PUBLIC_MEDIA_RESPONSE_HEADERS,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  }));

  app.on(["GET", "HEAD"], "/api/uploads/local", async (c) => {
    if (getStorageBackend() !== "local") {
      return c.json({ error: "Local file upload is not enabled" }, 404);
    }

    const key = c.req.query("key");
    if (!key) {
      return c.json({ error: "Missing upload key" }, 400);
    }

    try {
      const file = await readLocalUpload(key);
      if (!file) {
        return c.json({ error: "File not found" }, 404);
      }

      const range = parseByteRange(c.req.header("range"), file.byteLength);
      if (range === "invalid") {
        return c.body(null, 416, {
          ...PUBLIC_MEDIA_RESPONSE_HEADERS,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${file.byteLength}`,
        });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? file.byteLength - 1;
      const length = end - start + 1;
      const headers: Record<string, string> = {
        ...PUBLIC_MEDIA_RESPONSE_HEADERS,
        "Accept-Ranges": "bytes",
        "Content-Length": length.toString(),
        "Content-Type": file.contentType,
        ETag: file.etag,
      };
      if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.byteLength}`;
      const body = c.req.method === "HEAD" ? null : file.body.subarray(start, end + 1);
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch (error) {
      if (error instanceof LocalUploadError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/upload/pfp — get presigned URL for profile picture upload
  // -------------------------------------------------------------------------

  app.post("/api/upload/pfp", requireAuth(db), async (c) => {
    if (!isStorageConfigured()) {
      return c.json(
        { error: "File upload not available (object storage not configured)" },
        503,
      );
    }

    const body = await c.req.json<{ contentType?: string }>();
    const contentType = body.contentType;

    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
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

    const result = await generatePresignedUpload(
      key,
      contentType,
      300,
      new URL(c.req.url).origin,
    );

    return c.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
      key: result.key,
    });
  });

  return app;
}

function parseConstrainedUploadClaims(input: {
  key: string;
  contentType: string;
  expiresAt: number;
  token: string;
  contentLength: string | undefined;
  sha256: string | undefined;
  targetId: string | undefined;
}): {
  claims: {
    key: string;
    contentType: string;
    byteLength: number;
    sha256: string;
    targetId: string;
    expiresAt: number;
  };
} | null {
  if (input.contentLength === undefined && input.sha256 === undefined && input.targetId === undefined) {
    return null;
  }
  if (!input.contentLength || !input.sha256 || !input.targetId) {
    return null;
  }
  return {
    claims: {
      key: input.key,
      contentType: input.contentType,
      byteLength: Number(input.contentLength),
      sha256: input.sha256,
      targetId: input.targetId,
      expiresAt: input.expiresAt,
    },
  };
}

function parseByteRange(value: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return "invalid";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}
