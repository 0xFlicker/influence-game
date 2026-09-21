import { createHash } from "node:crypto";
import sharp from "sharp";
import type { VisualLocalization } from "@influence/engine/visual-localization";

export type VisualImageProvider = "openai" | "xai";
export interface VisualImageRequest {
  prompt: string;
  width: number;
  height: number;
  references: readonly Uint8Array[];
}
export interface VisualImageReceipt {
  provider: VisualImageProvider;
  model: string;
  requestHash: string;
  requestId: string | null;
  status: number | null;
  elapsedMs: number;
  usage: unknown;
  chargeUncertain: boolean;
}
export interface VisualImageJournal {
  /** Must durably reserve the attempt or reject it before any network dispatch. */
  begin(input: { provider: VisualImageProvider; model: string; requestHash: string }): Promise<void>;
  /** Must durably retain receipt and successful bytes before returning. */
  finish(receipt: VisualImageReceipt, image?: Uint8Array, localization?: VisualLocalization): Promise<void>;
}

export class VisualImageFailure extends Error {
  constructor(message: string, readonly availabilityFailure: boolean) {
    super(message);
    this.name = "VisualImageFailure";
  }
}

/** One attempt per provider. The caller owns durable retries and uncertain-attempt recovery. */
export async function generateVisualImage(request: VisualImageRequest, journal: VisualImageJournal, signal?: AbortSignal) {
  if (!request.prompt.trim() || request.references.length > 5
    || ![request.width, request.height].every((v) => Number.isInteger(v) && v >= 256 && v <= 4096)) {
    throw new VisualImageFailure("Invalid visual image request", false);
  }
  for (const provider of ["openai", "xai"] as const) {
    try {
      return await attempt(provider, request, journal, signal);
    } catch (error) {
      if (provider !== "openai" || !(error instanceof VisualImageFailure) || !error.availabilityFailure || signal?.aborted) throw error;
    }
  }
  throw new VisualImageFailure("Image providers unavailable", true);
}

async function attempt(provider: VisualImageProvider, request: VisualImageRequest, journal: VisualImageJournal, signal?: AbortSignal) {
  const key = process.env[provider === "openai" ? "OPENAI_API_KEY" : "XAI_API_KEY"];
  if (!key) throw new VisualImageFailure(`Missing ${provider} image credential`, false);
  const model = provider === "openai" ? "gpt-image-2" : "grok-imagine-image-2.0";
  const requestHash = createHash("sha256").update(JSON.stringify({ ...request, model,
    references: request.references.map((image) => createHash("sha256").update(image).digest("hex")),
  })).digest("hex");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  const route = request.references.length ? "edits" : "generations";
  let body: string | FormData;
  if (provider === "openai" && request.references.length) {
    body = new FormData();
    for (const [name, value] of Object.entries({ model, prompt: request.prompt, n: "1", quality: "medium", size: `${request.width}x${request.height}` })) body.append(name, value);
    for (const [index, bytes] of request.references.entries()) body.append("image[]", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `reference-${index}.png`);
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(provider === "openai" ? {
      model, prompt: request.prompt, n: 1, quality: "medium", size: `${request.width}x${request.height}`,
    } : {
      model, prompt: request.prompt, n: 1, quality: "medium", resolution: "2k", response_format: "b64_json",
      aspect_ratio: request.width === request.height ? "1:1" : request.width > request.height ? "16:9" : "2:3",
      ...(request.references.length ? { images: request.references.map((bytes) => ({ type: "image_url", url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` })) } : {}),
    });
  }
  await journal.begin({ provider, model, requestHash });
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`https://api.${provider === "openai" ? "openai.com" : "x.ai"}/v1/images/${route}`, {
      method: "POST", headers, body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    });
  } catch {
    await journal.finish({ provider, model, requestHash, requestId: null, status: null, elapsedMs: Date.now() - start, usage: null, chargeUncertain: true });
    throw new VisualImageFailure(`${provider} image request did not return a response`, true);
  }
  const receipt: VisualImageReceipt = { provider, model, requestHash, requestId: response.headers.get("x-request-id"), status: response.status,
    elapsedMs: Date.now() - start, usage: null, chargeUncertain: response.ok || response.status >= 500 };
  let raw: Record<string, unknown>;
  try {
    const decoded: unknown = await response.json();
    if (!isRecord(decoded)) throw new Error("Invalid provider response");
    raw = decoded;
  } catch {
    await journal.finish(receipt);
    throw new VisualImageFailure(`${provider} image response was not valid JSON (HTTP ${response.status})`, availabilityFailure(response.status));
  }
  receipt.usage = raw.usage ?? null;
  if (!response.ok) {
    await journal.finish(receipt);
    throw new VisualImageFailure(`${provider} image HTTP ${response.status}`, availabilityFailure(response.status));
  }
  const data = Array.isArray(raw.data) ? raw.data.filter(isRecord) : [];
  if (data.length !== 1 || typeof data[0]?.b64_json !== "string") {
    await journal.finish(receipt);
    throw new VisualImageFailure(`${provider} did not return exactly one image`, false);
  }
  let image: Buffer;
  try {
    // Contain preserves all people even when fallback aspect ratios differ. Localization sees these final pixels.
    image = await sharp(Buffer.from(data[0].b64_json, "base64"))
      .resize(request.width, request.height, { fit: "contain", background: "#161616" }).png().toBuffer();
  } catch {
    await journal.finish(receipt);
    throw new VisualImageFailure(`${provider} returned an unreadable image`, false);
  }
  receipt.chargeUncertain = false;
  await journal.finish(receipt, image);
  return { image, receipt };
}
function availabilityFailure(status: number): boolean { return status === 429 || status >= 500 && status <= 599; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
