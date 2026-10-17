/** Test-only filesystem object service shared by fixture and API subprocesses. */
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPayloadObjectStoreForTests } from "../services/payload-storage.js";

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
  setPayloadObjectStoreForTests({
    async putIfAbsent(key, bytes) {
      const temporary = join(root, randomUUID());
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try { await link(temporary, file(key)); }
      catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error; }
      finally { await rm(temporary); }
    },
    async get(key) { return readFile(file(key)); },
  });
}
export async function removeE2ePayloadStore(databaseUrl: string) { await rm(directory(databaseUrl), { recursive: true, force: true }); }
