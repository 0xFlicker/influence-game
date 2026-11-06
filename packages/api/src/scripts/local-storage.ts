/** Adopt existing MinIO and copy local public files without replacing any object. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { S3Client, CreateBucketCommand, HeadBucketCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { loadLocalStorageConfig, localStorageConfigPath, loopbackOrigin, storageEnvironment, type LocalStorageConfig } from "../lib/local-development-storage";

const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const missing = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
export function clientFor(config: LocalStorageConfig): S3Client {
  storageEnvironment(config);
  return new S3Client({ endpoint: config.endpoint, region: "us-iad", forcePathStyle: true,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey } });
}

export interface LocalAsset { key: string; file: string; sha256: string; bytes: number; contentType: string }
export async function inventoryLocalAssets(roots: string[]): Promise<LocalAsset[]> {
  const assets = new Map<string, LocalAsset>();
  for (const input of roots) {
    const root = await realpath(input);
    if ((await lstat(input)).isSymbolicLink()) throw new Error("Source roots must not be symlinks");
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Source symlink rejected");
        if (entry.isDirectory()) { await walk(file); continue; }
        if (!entry.isFile()) throw new Error("Non-regular source rejected");
        if (/\.(content-type|sha256|etag)$/.test(file)) continue;
        const key = path.relative(root, file).split(path.sep).join("/");
        if (key.includes("\\") || key.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid local asset key");
        const body = await readFile(file);
        let contentType: string;
        try { contentType = (await readFile(`${file}.content-type`, "utf8")).trim(); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          contentType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".json": "application/json", ".vtt": "text/vtt" } as Record<string, string>)[path.extname(key)] ?? "application/octet-stream";
        }
        if (!contentType || /[\r\n]/.test(contentType)) throw new Error("Invalid content type");
        const row = { key, file, sha256: hash(body), bytes: body.length, contentType };
        try {
          if ((await readFile(`${file}.sha256`, "utf8")).trim().replace(/^sha256:/, "") !== row.sha256) throw new Error("Source sidecar hash differs");
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const previous = assets.get(key);
        if (previous && (previous.sha256 !== row.sha256 || previous.contentType !== row.contentType)) throw new Error("Conflicting local asset keys; preserve both sources and review before import");
        assets.set(key, row);
      }
    }
    await walk(root);
  }
  return [...assets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function copyLocalAssets(client: S3Client, bucket: string, assets: LocalAsset[], copy: boolean): Promise<{ verified: number; copied: number; bytes: number }> {
  let copied = 0, bytes = 0;
  for (const asset of assets) {
    const source = await readFile(asset.file);
    if (hash(source) !== asset.sha256 || source.length !== asset.bytes) throw new Error("Source changed after inventory");
    let object;
    try { object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: asset.key })); }
    catch (error) { if (!missing(error)) throw error; }
    if (!object) {
      if (!copy) throw new Error("Destination asset missing");
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: asset.key, Body: source, ContentType: asset.contentType,
        Metadata: { sha256: asset.sha256 }, IfNoneMatch: "*" }));
      copied++;
      object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: asset.key }));
    }
    const body = await object.Body?.transformToByteArray();
    if (!body || hash(body) !== asset.sha256 || body.length !== asset.bytes || object.ContentType !== asset.contentType) {
      throw new Error("Destination differs; existing object preserved without overwrite");
    }
    if (hash(await readFile(asset.file)) !== asset.sha256) throw new Error("Source changed during copy");
    bytes += asset.bytes;
  }
  return { verified: assets.length, copied, bytes };
}

async function adopt(container: string, legacyEnv: string, publicBucket: string, output: string): Promise<void> {
  if (await loadLocalStorageConfig(output)) throw new Error("Shared configuration already exists; use status, import or verify");
  const child = Bun.spawn(["docker", "inspect", container], { stdout: "pipe", stderr: "pipe" });
  const data = await new Response(child.stdout).text();
  if (await child.exited) throw new Error("Cannot inspect existing MinIO container");
  const item = JSON.parse(data)[0];
  const mount = item.Mounts.find((row: { Destination: string; Type: string }) => row.Destination === "/data" && row.Type === "volume");
  if (!mount || !item.State.Running) throw new Error("Adoption requires a running MinIO with an existing Docker data volume");
  const env = Object.fromEntries(item.Config.Env.map((line: string) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  const old: Record<string, string> = {};
  for (const line of (await readFile(legacyEnv, "utf8")).split("\n")) {
    const match = /^(?:export )?([A-Z_]+)=(.*)$/.exec(line);
    if (match) old[match[1]!] = match[2]!.replace(/^['"](.*)['"]$/, "$1");
  }
  if (old.LINODE_PRIVATE_CONTENT_ACCESS_KEY !== env.MINIO_ROOT_USER || old.LINODE_PRIVATE_CONTENT_SECRET_KEY !== env.MINIO_ROOT_PASSWORD) {
    throw new Error("Existing private configuration does not match the selected container");
  }
  const endpoint = loopbackOrigin(old.LINODE_PRIVATE_CONTENT_ENDPOINT!);
  if (!item.NetworkSettings.Ports["9000/tcp"]?.some((port: { HostPort: string }) => port.HostPort === new URL(endpoint).port)) throw new Error("Container does not own the configured endpoint port");
  const config: LocalStorageConfig = { version: 1, container, dataVolume: mount.Name, image: item.Image, endpoint,
    publicBucket, privateBucket: old.LINODE_PRIVATE_CONTENT_BUCKET!, accessKey: old.LINODE_PRIVATE_CONTENT_ACCESS_KEY!,
    secretKey: old.LINODE_PRIVATE_CONTENT_SECRET_KEY!, traceCursorSecret: old.INFLUENCE_TRACE_MCP_CURSOR_SECRET!, apiOrigin: "http://127.0.0.1:3000" };
  const client = clientFor(config);
  await client.send(new HeadBucketCommand({ Bucket: config.privateBucket }));
  try { await client.send(new HeadBucketCommand({ Bucket: config.publicBucket })); }
  catch (error) { if (!missing(error)) throw error; await client.send(new CreateBucketCommand({ Bucket: config.publicBucket })); }
  // No credentials, policy, CORS, existing object, mount or container changes.
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.info(JSON.stringify({ adopted: true, config: output, container, dataVolume: mount.Name, publicBucket, privateBucket: config.privateBucket }));
  client.destroy();
}

async function startExisting(config: LocalStorageConfig): Promise<void> {
  const inspect = Bun.spawn(["docker", "inspect", config.container], { stdout: "pipe", stderr: "pipe" });
  const data = await new Response(inspect.stdout).text();
  if (await inspect.exited) throw new Error("Recorded MinIO container is missing; preserve its recorded volume and review recreation before proceeding");
  const item = JSON.parse(data)[0];
  if (item.Image !== config.image || !item.Mounts.some((row: { Destination: string; Name: string }) => row.Destination === "/data" && row.Name === config.dataVolume)) throw new Error("Recorded MinIO image or volume differs");
  if (!item.State.Running) {
    const child = Bun.spawn(["docker", "start", config.container], { stdout: "ignore", stderr: "pipe" });
    if (await child.exited) throw new Error("Could not start recorded MinIO container");
  }
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${config.endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* wait for the exact service */ }
    await Bun.sleep(1000);
  }
  throw new Error("Recorded MinIO did not become ready");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: {
    container: { type: "string" }, "legacy-env": { type: "string" }, "public-bucket": { type: "string", default: "house-public-local" },
    source: { type: "string", multiple: true }, receipt: { type: "string" }, config: { type: "string", default: localStorageConfigPath() },
  } });
  const command = positionals[0];
  if (positionals.length !== 1) throw new Error("Choose adopt, status, inventory, import or verify");
  if (command === "adopt") {
    if (!values.container || !values["legacy-env"]) throw new Error("Adoption requires explicit --container and --legacy-env");
    await adopt(values.container, values["legacy-env"], values["public-bucket"]!, values.config!);
  } else if (command === "inventory") {
    if (!values.source?.length) throw new Error("Supply explicit --source directories");
    const assets = await inventoryLocalAssets(values.source);
    console.info(JSON.stringify({ objects: assets.length, bytes: assets.reduce((sum, row) => sum + row.bytes, 0) }));
  } else if (["start", "status", "import", "verify"].includes(command!)) {
    const config = await loadLocalStorageConfig(values.config);
    if (!config) throw new Error("Shared storage is not configured; adopt the existing service first");
    if (command === "start") await startExisting(config);
    const client = clientFor(config);
    for (const bucket of [config.publicBucket, config.privateBucket]) await client.send(new HeadBucketCommand({ Bucket: bucket }));
    if (command === "status" || command === "start") console.info(JSON.stringify({ ready: true, endpoint: config.endpoint, publicBucket: config.publicBucket, privateBucket: config.privateBucket, dataVolume: config.dataVolume }));
    else {
      if (!values.source?.length || !values.receipt) throw new Error("Supply explicit --source directories and a new --receipt path");
      const assets = await inventoryLocalAssets(values.source);
      // Reserve the private receipt before making any write. Failed imports retain it.
      await writeFile(values.receipt, JSON.stringify({ state: "started", command, assets }) + "\n", { mode: 0o600, flag: "wx" });
      const result = await copyLocalAssets(client, config.publicBucket, assets, command === "import");
      await writeFile(values.receipt, JSON.stringify({ state: "verified", command, assets, result }) + "\n", { mode: 0o600 });
      console.info(JSON.stringify(result));
    }
    client.destroy();
  } else throw new Error("Choose adopt, status, inventory, import or verify");
}
