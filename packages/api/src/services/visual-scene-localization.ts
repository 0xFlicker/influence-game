import sharp from "sharp";
import { createHash } from "node:crypto";
import type { VisualImageJournal, VisualImageReceipt } from "./visual-image-provider.js";
import { decodeVisualLocalization, visualLocalizationSchema } from "@influence/engine/visual-localization";
import type { VisualPlayerAnchor } from "@influence/engine/visual-mode";

export interface VisualReferenceImage {
  image: Uint8Array;
  players: readonly { id: string; name: string }[];
}

/** Inspect actual final pixels. Reference order does not imply placement in the scene. */
export async function localizeVisualScene(input: {
  scene: Uint8Array;
  references: readonly VisualReferenceImage[];
  apiKey: string;
  signal?: AbortSignal;
  journal?: VisualImageJournal;
}) {
  const players = input.references.flatMap((reference) => reference.players);
  if (!players.length || new Set(players.map((player) => player.id)).size !== players.length) throw new Error("Unique scene identities are required");
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text:
    "Locate every listed contestant in the FINAL image using the preceding character reference images. References identify appearance only; do not assume their ordering matches scene positions. Return the actual total number of people. For each listed identity return the tight bounding rectangle of their entire visible head (including hair), with x/y at the TOP LEFT and width/height, all normalized to the FINAL image dimensions. Labels must be unique integers 1 through the number of players. Use uncertain when identity cannot be established. Do not guess based on seating or assume requested players are present. These coordinates will anchor speech bubbles above their heads." }];
  for (const reference of input.references) {
    content.push({ type: "input_text", text: `Character reference identities: ${JSON.stringify(reference.players)}` });
    content.push({ type: "input_image", image_url: `data:image/png;base64,${Buffer.from(reference.image).toString("base64")}`, detail: "high" });
  }
  content.push({ type: "input_text", text: "FINAL SCENE: locate heads in this image only." });
  content.push({ type: "input_image", image_url: `data:image/png;base64,${Buffer.from(input.scene).toString("base64")}`, detail: "high" });
  const body = JSON.stringify({ model: "gpt-5.6-luna", store: false, reasoning: { effort: "low" }, max_output_tokens: 5000,
    input: [{ role: "user", content }], text: { format: { type: "json_schema", name: "scene_localization", strict: true, schema: visualLocalizationSchema(players.map((player) => player.id)) } } });
  const reservation = { provider: "openai" as const, model: "gpt-5.6-luna", requestHash: createHash("sha256").update(body).digest("hex") };
  await input.journal?.begin(reservation);
  const startedAt = Date.now();
  const receipt: VisualImageReceipt = { ...reservation, requestId: null, status: null, elapsedMs: 0, usage: null, chargeUncertain: true };
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" }, body,
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
  } catch (error) {
    receipt.elapsedMs = Date.now() - startedAt;
    await input.journal?.finish(receipt);
    throw error;
  }
  receipt.requestId = response.headers.get("x-request-id");
  receipt.status = response.status;
  receipt.chargeUncertain = response.ok || response.status >= 500;
  let result;
  try {
    const raw: unknown = await response.json();
    if (isRecord(raw)) receipt.usage = raw.usage ?? null;
    if (!response.ok) throw new Error(`Scene localization HTTP ${response.status}`);
    if (!isRecord(raw) || raw.status !== "completed" || !Array.isArray(raw.output)) throw new Error("Incomplete scene localization");
    receipt.chargeUncertain = false;
    const text = raw.output.filter(isRecord).filter((item) => item.type === "message")
      .flatMap((item) => Array.isArray(item.content) ? item.content.filter(isRecord) : [])
      .filter((part) => part.type === "output_text");
    if (text.length !== 1 || typeof text[0]?.text !== "string") throw new Error("Missing exact scene localization");
    result = decodeVisualLocalization(text[0].text, players.map((player) => player.id));
  } catch (error) {
    receipt.elapsedMs = Date.now() - startedAt;
    await input.journal?.finish(receipt);
    throw error;
  }
  receipt.elapsedMs = Date.now() - startedAt;
  await input.journal?.finish(receipt, undefined, result);
  return { ...result, usage: receipt.usage, requestId: receipt.requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Create the model-facing numbered copy without changing the clean viewer image. */
export async function annotateVisualScene(image: Uint8Array, anchors: readonly VisualPlayerAnchor[]): Promise<Buffer> {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error("Scene image has no dimensions");
  const radius = Math.max(14, Math.round(width / 100));
  const overlay = anchors.map(({ head, label }) => {
    const x = Math.round((head.x + head.width / 2) * width);
    const headTop = Math.round(head.y * height);
    const y = Math.max(radius + 3, headTop - radius - 12);
    return `<path d="M${x},${y + radius} L${x},${headTop}" stroke="white" stroke-width="4"/><circle cx="${x}" cy="${y}" r="${radius}" fill="black" stroke="white" stroke-width="3"/><text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${radius}" fill="white">${label}</text>`;
  }).join("");
  return sharp(image).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${overlay}</svg>`) }]).png().toBuffer();
}
