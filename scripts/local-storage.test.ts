import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inventoryLocalAssets, copyLocalAssets } from "../packages/api/src/scripts/local-storage";
import { loadLocalStorageConfig, storageEnvironment, type LocalStorageConfig } from "../packages/api/src/lib/local-development-storage";
import { localObjectStorageEnabled, publicObjectAcl } from "../packages/api/src/lib/object-storage-config";
import { generateConstrainedPublicUpload, publicObjectUrlForKey } from "../packages/api/src/lib/storage";

const roots: string[] = [];
const saved = { ...process.env };
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temp() { const root = await mkdtemp(path.join(os.tmpdir(), "house-storage-test-")); roots.push(root); return root; }
const config: LocalStorageConfig = { version: 1, container: "fixture", dataVolume: "fixture", image: "fixture",
  endpoint: "http://127.0.0.1:19000", publicBucket: "fixture-public", privateBucket: "fixture-private", accessKey: "synthetic", secretKey: "synthetic-secret", traceCursorSecret: "synthetic-cursor", apiOrigin: "http://127.0.0.1:3000" };

test("shared config is private, independent of cwd and restricted to loopback", async () => {
  const root = await temp(), file = path.join(root, "config.json");
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  expect(storageEnvironment((await loadLocalStorageConfig(file))!)).toMatchObject({ HOUSE_LOCAL_OBJECT_STORAGE: "1", LINODE_OBJ_BUCKET: "fixture-public" });
  expect(() => storageEnvironment({ ...config, endpoint: "https://s3.us-west-1.amazonaws.com" })).toThrow("loopback");
  expect(() => storageEnvironment({ ...config, privateBucket: config.publicBucket })).toThrow("Invalid");
  const link = path.join(root, "link"); await symlink(file, link);
  await expect(loadLocalStorageConfig(link)).rejects.toThrow("private regular");
});

test("local S3 writes use signed PUTs without ACL and keep old API read URLs", async () => {
  Object.assign(process.env, storageEnvironment(config));
  expect(localObjectStorageEnabled()).toBe(true);
  expect(publicObjectAcl()).toEqual({});
  expect(publicObjectUrlForKey("avatars/old image.png")).toBe("http://127.0.0.1:3000/api/uploads/local?key=avatars%2Fold%20image.png");
  const upload = await generateConstrainedPublicUpload({ key: "avatars/a.png", contentType: "image/png", byteLength: 3, sha256: "sha256:" + "a".repeat(64), targetId: "local-fixture" });
  expect(new URL(upload.uploadUrl).origin).toBe(config.endpoint);
  expect(upload.uploadHeaders["x-amz-acl"]).toBeUndefined();
  expect(upload.uploadHeaders["if-none-match"]).toBe("*");
  process.env.HOUSE_OBJECT_STORAGE_PROVIDER = "aws";
  expect(() => localObjectStorageEnabled()).toThrow("AWS mode");
});

test("inventory rejects conflicting keys and symlinks before copying; deduplicates identical assets", async () => {
  const root = await temp();
  const a = path.join(root, "a"), b = path.join(root, "b"); await mkdir(a); await mkdir(b);
  for (const dir of [a, b]) { await writeFile(path.join(dir, "portrait.png"), "original"); await writeFile(path.join(dir, "portrait.png.content-type"), "image/png"); }
  expect((await inventoryLocalAssets([a, b])).length).toBe(1);
  await writeFile(path.join(b, "portrait.png"), "changed");
  await expect(inventoryLocalAssets([a, b])).rejects.toThrow("Conflicting");
  await symlink(path.join(a, "portrait.png"), path.join(a, "symlink.png"));
  await expect(inventoryLocalAssets([a])).rejects.toThrow("symlink");
});

test("copy resumes without overwrites, verifies bytes and leaves original source files intact", async () => {
  const root = await temp(); await writeFile(path.join(root, "portrait.png"), "original");
  const assets = await inventoryLocalAssets([root]);
  let puts = 0; let stored: Uint8Array | undefined;
  const client = { send: async (command: { constructor: { name: string }; input: { Body?: Uint8Array; IfNoneMatch?: string } }) => {
    if (command.constructor.name === "PutObjectCommand") { expect(command.input.IfNoneMatch).toBe("*"); stored = command.input.Body; puts++; return {}; }
    if (!stored) throw { $metadata: { httpStatusCode: 404 } };
    return { ContentType: "image/png", Body: { transformToByteArray: async () => stored } };
  } } as unknown as Parameters<typeof copyLocalAssets>[0];
  expect(await copyLocalAssets(client, "fixture-public", assets, true)).toMatchObject({ copied: 1, verified: 1 });
  expect(await copyLocalAssets(client, "fixture-public", assets, true)).toMatchObject({ copied: 0, verified: 1 });
  stored = new TextEncoder().encode("different");
  await expect(copyLocalAssets(client, "fixture-public", assets, true)).rejects.toThrow("without overwrite");
  expect(puts).toBe(1); expect(await readFile(assets[0]!.file, "utf8")).toBe("original");
});
