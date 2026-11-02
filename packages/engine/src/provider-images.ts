import { createHash } from "node:crypto";

/** Stable identity, never an expiring bearer URL. Binary bytes live in private storage. */
export interface ProviderImageReference {
  sha256: string;
  byteLength: number;
  mediaType: string;
}

export interface ProviderImageStorage {
  store(bytes: Uint8Array, mediaType: string): Promise<ProviderImageReference>;
  sign(reference: ProviderImageReference): Promise<string>;
}

export function providerImageUri(ref: ProviderImageReference): string {
  if (!/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 1
    || !/^image\/(png|jpeg|webp|gif)$/.test(ref.mediaType)) throw new Error("Invalid provider image reference");
  return `influence-image:${ref.sha256}:${ref.byteLength}:${ref.mediaType}`;
}

export function parseProviderImageUri(uri: string): ProviderImageReference | undefined {
  const match = /^influence-image:([a-f0-9]{64}):(\d+):(image\/(?:png|jpeg|webp|gif))$/.exec(uri);
  if (!match) return undefined;
  const ref = { sha256: match[1]!, byteLength: Number(match[2]), mediaType: match[3]! };
  providerImageUri(ref);
  return ref;
}

/** Storage failures must stop dispatch/retries, never masquerade as provider failures. */
export class ProviderImageStorageError extends Error {
  constructor(cause: unknown) { super("Provider image storage failed", { cause }); }
}

/** One attempt's attachment set. Repeated prepared/raw copies share verified binary storage. */
export class ProviderImageAttachments {
  private readonly stored = new Map<string, Promise<string>>();
  private readonly signed = new Map<string, Promise<string>>();
  private readonly urls = new Map<string, string>();
  constructor(private readonly storage: ProviderImageStorage) {}

  private async store(data: string, mediaType: string): Promise<string> {
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.toString("base64") !== data) throw new ProviderImageStorageError(new Error("Invalid base64 image"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const key = `${hash}:${mediaType}`;
    let pending = this.stored.get(key);
    if (!pending) {
      pending = this.storage.store(bytes, mediaType).then(ref => {
        if (ref.sha256 !== hash || ref.byteLength !== bytes.length || ref.mediaType !== mediaType) throw new Error("Provider image integrity mismatch");
        return providerImageUri(ref);
      }).catch(error => { throw new ProviderImageStorageError(error); });
      this.stored.set(key, pending);
    }
    return pending;
  }

  async evidence<T>(value: T): Promise<T> {
    const visit = async (input: unknown): Promise<unknown> => {
      if (typeof input === "string") {
        if (this.urls.has(input)) return this.urls.get(input);
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+=*)$/.exec(input);
        return match ? this.store(match[2]!, match[1]!) : input;
      }
      if (Array.isArray(input)) return Promise.all(input.map(visit));
      if (!input || typeof input !== "object") return input;
      const object = input as Record<string, unknown>;
      // Anthropic's native image source has no data-URL prefix.
      if (object.type === "base64" && typeof object.media_type === "string" && object.media_type.startsWith("image/") && typeof object.data === "string") {
        if (parseProviderImageUri(object.data)) return object;
        return { ...object, data: await this.store(object.data, object.media_type) };
      }
      return Object.fromEntries(await Promise.all(Object.entries(object).map(async ([key, field]) => [key, await visit(field)])));
    };
    return await visit(value) as T;
  }

  private async url(uri: string): Promise<string> {
    const ref = parseProviderImageUri(uri);
    if (!ref) return uri;
    let pending = this.signed.get(uri);
    if (!pending) {
      pending = this.storage.sign(ref).then(url => {
        if (new URL(url).protocol !== "https:") throw new Error("Provider images require reachable HTTPS storage");
        this.urls.set(url, uri);
        return url;
      }).catch(error => { throw new ProviderImageStorageError(error); });
      this.signed.set(uri, pending);
    }
    return pending;
  }

  /** Resolve only native image fields; never turn arbitrary model prose into a capability. */
  async request(value: unknown): Promise<unknown> {
    const normalized = await this.evidence(value);
    const visit = async (input: unknown): Promise<unknown> => {
      if (Array.isArray(input)) return Promise.all(input.map(visit));
      if (!input || typeof input !== "object") return input;
      const object = input as Record<string, unknown>;
      if (object.type === "image" && object.source && typeof object.source === "object") {
        const source = object.source as Record<string, unknown>;
        const uri = source.type === "base64" ? source.data : source.url;
        if (typeof uri === "string" && parseProviderImageUri(uri)) return { ...object, source: { type: "url", url: await this.url(uri) } };
      }
      const result = Object.fromEntries(await Promise.all(Object.entries(object).map(async ([key, field]) => [key, await visit(field)])));
      if (object.type === "input_image" || object.type === "image_url") {
        if (typeof object.image_url === "string") result.image_url = await this.url(object.image_url);
        else if (object.image_url && typeof object.image_url === "object") {
          const image = object.image_url as Record<string, unknown>;
          if (typeof image.url === "string") result.image_url = { ...image, url: await this.url(image.url) };
        }
        if (typeof object.url === "string") result.url = await this.url(object.url);
      }
      return result;
    };
    return visit(normalized);
  }
}
