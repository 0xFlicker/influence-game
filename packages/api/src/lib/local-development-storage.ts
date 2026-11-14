import { homedir } from "node:os";
import path from "node:path";
import { lstat, readFile } from "node:fs/promises";

export interface LocalStorageConfig {
  version: 1;
  container: string;
  dataVolume: string;
  image: string;
  endpoint: string;
  publicBucket: string;
  privateBucket: string;
  accessKey: string;
  secretKey: string;
  traceCursorSecret: string;
  apiOrigin: string;
}

export function localStorageConfigPath(): string {
  return process.env.HOUSE_LOCAL_STORAGE_CONFIG ?? path.join(homedir(), ".local/share/thehouse/storage/config.json");
}

export function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || value !== url.origin || url.username || url.password) throw new Error("Exact loopback HTTP origin required");
  return value;
}

export function storageEnvironment(config: LocalStorageConfig): Record<string, string> {
  if (config.version !== 1 || !config.accessKey || !config.secretKey || !config.traceCursorSecret
    || config.publicBucket === config.privateBucket
    || ![config.publicBucket, config.privateBucket].every(value => /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value))) {
    throw new Error("Invalid shared local storage configuration");
  }
  const endpoint = loopbackOrigin(config.endpoint);
  return {
    HOUSE_LOCAL_OBJECT_STORAGE: "1", HOUSE_OBJECT_STORAGE_PROVIDER: "linode", INFLUENCE_STORAGE_BACKEND: "s3",
    HOUSE_LOCAL_API_ORIGIN: loopbackOrigin(config.apiOrigin),
    LINODE_OBJ_ENDPOINT: endpoint, LINODE_OBJ_ACCESS_KEY: config.accessKey, LINODE_OBJ_SECRET_KEY: config.secretKey,
    LINODE_OBJ_BUCKET: config.publicBucket,
    LINODE_PRIVATE_CONTENT_ENDPOINT: endpoint, LINODE_PRIVATE_CONTENT_ACCESS_KEY: config.accessKey,
    LINODE_PRIVATE_CONTENT_SECRET_KEY: config.secretKey, LINODE_PRIVATE_CONTENT_BUCKET: config.privateBucket,
    INFLUENCE_TRACE_MCP_CURSOR_SECRET: config.traceCursorSecret,
  };
}

export async function loadLocalStorageConfig(file = localStorageConfigPath()): Promise<LocalStorageConfig | null> {
  let stat;
  try { stat = await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error("Shared local storage config must be a private regular file (0600)");
  const config = JSON.parse(await readFile(file, "utf8")) as LocalStorageConfig;
  storageEnvironment(config);
  return config;
}
