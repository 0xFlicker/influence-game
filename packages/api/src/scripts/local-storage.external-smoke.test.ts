/** Explicit loopback-only, no DB/provider work. Retains its uniquely named probes. */
import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { loadLocalStorageConfig } from "../lib/local-development-storage";
import { clientFor } from "./local-storage";

test.skipIf(process.env.RUN_LOCAL_STORAGE_SMOKE !== "1")("shared MinIO persists public and private bytes across fresh worktree processes", async () => {
  const config = await loadLocalStorageConfig(); if (!config) throw new Error("Adopt local storage first");
  const peer = process.env.HOUSE_LOCAL_STORAGE_PEER_WORKTREE; if (!peer) throw new Error("Explicit peer worktree required");
  const client = clientFor(config), key = `storage-persistence-proof/${randomUUID()}.png`;
  const body = Buffer.from("persistent-local-storage-synthetic-fixture");
  const sha = createHash("sha256").update(body).digest("hex");
  for (const bucket of [config.publicBucket, config.privateBucket]) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "image/png", IfNoneMatch: "*", Metadata: { sha256: sha } }));
    const anon = await fetch(`${config.endpoint}/${bucket}/${key}`);
    expect(anon.status).toBe(403);
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    expect(Buffer.from(await got.Body!.transformToByteArray())).toEqual(body);
  }
  const root = path.resolve(import.meta.dir, "../../../..");
  const readProbe = async (cwd: string, probeKey: string, expected: string) => {
    const code = `
      const { createUploadRoutes } = await import(${JSON.stringify(path.join(root, "packages/api/src/routes/upload.ts"))});
      const { createHash } = await import("node:crypto");
      const app = createUploadRoutes();
      const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:app.fetch});
      try {
        const url = new URL("/api/uploads/local",server.url);url.searchParams.set("key",${JSON.stringify(probeKey)});
        const r = await fetch(url); const bytes = Buffer.from(await r.arrayBuffer());
        if(r.status!==200 || createHash("sha256").update(bytes).digest("hex")!==${JSON.stringify(expected)}) throw Error("Public read mismatch");
        const head = await fetch(url,{method:"HEAD"}); if(head.status!==200 || Number(head.headers.get("content-length"))!==bytes.length) throw Error("HEAD mismatch");
        const range = await fetch(url,{headers:{range:"bytes=0-2"}}); if(range.status!==206 || !Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(0,3))) throw Error("Range mismatch");
      } finally {server.stop(true);}
    `;
    const child = Bun.spawn([process.execPath, path.join(root, "scripts/with-local-storage.ts"), process.execPath, "--eval", code], { cwd, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited, stderr).toBe(0);
  };
  await readProbe(root, key, sha); await readProbe(peer, key, sha);
  if (process.env.HOUSE_LOCAL_STORAGE_IMPORT_RECEIPT) {
    const receipt = JSON.parse(await readFile(process.env.HOUSE_LOCAL_STORAGE_IMPORT_RECEIPT, "utf8"));
    expect(receipt.state).toBe("verified");
    const historical = receipt.assets.find((row: { bytes: number }) => row.bytes >= 3);
    await readProbe(root, historical.key, historical.sha256); await readProbe(peer, historical.key, historical.sha256);
  }
  client.destroy();
}, 30_000);
