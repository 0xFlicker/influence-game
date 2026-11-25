/** Test-only filesystem object service shared by fixture and API subprocesses. */
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPayloadObjectStoreForTests } from "../services/payload-storage.js";
import { isImageContentType } from "../lib/image-content-type.js";

function directory(databaseUrl: string) {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!/^influence_e2e_[a-zA-Z0-9_]+$/.test(name)) throw new Error("Test payload store requires an isolated E2E database");
  return join(tmpdir(), `${name}_payloads`);
}
export async function installE2ePayloadStore(databaseUrl: string) {
  const root = directory(databaseUrl);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = (key: string) => {
    if (!/^payloads\/v1\/(binary|json-gzip|text-gzip)\/[a-f0-9]{64}$/.test(key)) throw new Error("Invalid test object key");
    return join(root, key.replaceAll("/", "_"));
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const key = new URL(request.url).pathname.slice(1);
      if (!/^payloads\/v1\/binary\/[a-f0-9]{64}$/.test(key)) return new Response(null, { status: 404 });
      const contentType = await readFile(file(key) + ".mime", "utf8");
      const body = Bun.file(file(key));
      if (!isImageContentType(contentType) || !await body.exists()) return new Response(null, { status: 404 });
      return new Response(body, { headers: { "Content-Type": contentType } });
    },
  });
  server.unref();
  setPayloadObjectStoreForTests({
    async putIfAbsent(key, bytes, contentType) {
      const temporary = join(root, randomUUID());
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try {
        await link(temporary, file(key));
        if (isImageContentType(contentType)) await writeFile(file(key) + ".mime", contentType, { flag: "wx", mode: 0o600 });
        return true;
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
        return false;
      }
      finally { await rm(temporary); }
    },
    async get(key) { return readFile(file(key)); },
    async imageDelivery(ref, expiresIn) {
      const contentType = await readFile(file(ref.key) + ".mime", "utf8");
      if (!isImageContentType(contentType)) throw new Error("Test image metadata missing");
      return { contentType, url: expiresIn !== undefined ? new URL(ref.key, server.url).href : undefined };
    },
  });
}
export async function removeE2ePayloadStore(databaseUrl: string) { await rm(directory(databaseUrl), { recursive: true, force: true }); }
