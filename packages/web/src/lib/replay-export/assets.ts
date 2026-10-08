import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { spawn } from "node:child_process";

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export interface CachedAsset {
  path: string;
  sha256: string;
  mediaType: "image" | "audio" | "video";
  width?: number;
  height?: number;
  durationMs?: number;
  sampleRate?: number;
}
export interface Probe {
  streams: {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    sample_rate?: string;
  }[];
  format: { duration?: string };
}
export function runProcess(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let output = "",
      error = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      error = (error + chunk).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? accept(output)
        : reject(new Error(`${command} exited ${code}: ${error}`)),
    );
  });
}
export async function probe(
  path: string,
  signal?: AbortSignal,
): Promise<Probe> {
  return JSON.parse(
    await runProcess(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      signal,
    ),
  );
}
export function bundlePath(root: string, path: string) {
  const resolved = resolve(root, path),
    inside = relative(root, resolved);
  if (
    !inside ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    inside.startsWith(sep)
  )
    throw new Error("Asset must be inside the bundle");
  return resolved;
}
/** Redirects never inherit the API credential on another origin. */
export async function fetchReplay(
  url: URL,
  api: URL,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  for (let redirect = 0; redirect < 6; redirect++) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Unsupported asset URL");
    const response = await fetch(url, {
      headers:
        token && url.origin === api.origin
          ? { Authorization: `Bearer ${token}` }
          : {},
      redirect: "manual",
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Asset redirect has no location");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Replay read failed (${response.status}) at ${url.origin}${url.pathname}`,
      );
    return response;
  }
  throw new Error("Too many asset redirects");
}

export class ReplayAssets {
  readonly table: Record<string, CachedAsset> = {};
  private sources = new Map<string, string>();
  constructor(
    private root: string,
    private publicRoot: string,
    private api: URL,
    private signal: AbortSignal,
    private token?: string,
  ) {}
  async cache(source: string, local = false): Promise<string> {
    const found = this.sources.get(source);
    if (found) return found;
    let bytes: Uint8Array;
    if (local || (source.startsWith("/") && !source.startsWith("/api/")))
      bytes = await readFile(
        local ? source : bundlePath(this.publicRoot, source.slice(1)),
      );
    else {
      const response = await fetchReplay(
        new URL(source, this.api),
        this.api,
        this.token,
        AbortSignal.any([this.signal, AbortSignal.timeout(60000)]),
      );
      if (!/^(image|audio|video)\//.test(response.headers.get("content-type") ?? ""))
        throw new Error("Selected replay asset is not image/audio/video content");
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (!response.body) throw new Error("Asset has no body");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          length += chunk.length;
          if (length > 128 * 1024 * 1024)
            throw new Error("Replay asset exceeds 128 MiB");
          chunks.push(chunk);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      bytes = Buffer.concat(chunks);
    }
    const hash = sha256(bytes),
      path = `assets/${hash}`;
    await mkdir(resolve(this.root, "assets"), { recursive: true });
    const absolute = bundlePath(this.root, path);
    await writeFile(absolute, bytes);
    const info = await probe(
      absolute,
      AbortSignal.any([this.signal, AbortSignal.timeout(30000)]),
    );
    const image = info.streams.find((s) => s.codec_type === "video");
    const audio = info.streams.find((s) => s.codec_type === "audio");
    const durationMs = Number(info.format.duration) * 1000;
    const movingImage = image && Number.isFinite(durationMs) && durationMs > 0;
    const asset: CachedAsset = image
      ? {
          path,
          sha256: hash,
          mediaType: movingImage ? "video" : "image",
          ...(movingImage ? { durationMs } : {}),
          width: image.width,
          height: image.height,
        }
      : {
          path,
          sha256: hash,
          mediaType: "audio",
          durationMs,
          sampleRate: Number(audio?.sample_rate),
        };
    if (
      image
        ? !image.width || !image.height
        : !audio || !Number.isFinite(asset.durationMs) || asset.durationMs! <= 0
    )
      throw new Error(`Undecodable asset ${hash}`);
    this.table[path] = asset;
    this.sources.set(source, path);
    return path;
  }
  /** Walk typed presentation data, caching URL fields and URL-valued media maps only. */
  async freeze<T>(value: T): Promise<T> {
    const walk = async (
      item: unknown,
      key = "",
      parent = "",
    ): Promise<unknown> => {
      if (
        typeof item === "string" &&
        (/url$|^src$/i.test(key) ||
          /wolfForms|portraits|fullBodyReferences/.test(parent)) &&
        /^(https?:\/\/|\/)/.test(item)
      )
        return this.cache(item);
      if (Array.isArray(item)) {
        const result: unknown[] = [];
        for (const child of item) result.push(await walk(child, key, parent));
        return result;
      }
      if (item && typeof item === "object") {
        const entries: [string, unknown][] = [];
        for (const [name, child] of Object.entries(item))
          entries.push([name, await walk(child, name, key)]);
        return Object.fromEntries(entries);
      }
      return item;
    };
    return (await walk(value)) as T;
  }
}

/** Freeze the stage's built-in art too; rerenders must not read a changed public tree. */
export async function snapshotStageArt(
  publicRoot: string,
  root: string,
): Promise<Record<string, string>> {
  const { readdir, copyFile } = await import("node:fs/promises");
  const files: Record<string, string> = {};
  async function copy(path: string) {
    const source = bundlePath(publicRoot, path);
    const info = await (await import("node:fs/promises")).stat(source);
    if (info.isDirectory()) {
      for (const name of await readdir(source)) await copy(`${path}/${name}`);
      return;
    }
    const destination = bundlePath(root, `static/${path}`);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(source, destination);
    files[`static/${path}`] = sha256(await readFile(destination));
  }
  for (const path of [
    "avatars/personas",
    "visual",
    "logo.png",
    "house-highlights",
  ])
    await copy(path);
  return files;
}
