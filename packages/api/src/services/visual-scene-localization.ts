import { visualFailureEvidence } from "./visual-diagnostics.js";
import { VisualIdentityFailure } from "@influence/engine/visual-localization";
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { VisualImageJournal, VisualImageReceipt } from "./visual-image-provider.js";
import { decodeVisualLocalization, visualLocalizationSchema, decodeVisualIdentities, visualIdentitySchema, decodeVisualComposition, visualCompositionSchema } from "@influence/engine/visual-localization";
import type { VisualPlayerAnchor } from "@influence/engine/visual-mode";

export const VISUAL_LOCALIZATION_VERSION = "composition-sol-v4";

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
  candidateAnchors?: readonly VisualPlayerAnchor[];
  compositionOnly?: boolean;
}) {
  const players = input.references.flatMap((reference) => reference.players);
  if ((!players.length && !input.compositionOnly) || new Set(players.map((player) => player.id)).size !== players.length) throw new Error("Unique scene identities are required");
  const dimensions = await sharp(input.scene).metadata();
  if (!dimensions.width || !dimensions.height) throw new Error("Scene dimensions are missing");
  const inspection = input.compositionOnly ? Buffer.from(input.scene) : input.candidateAnchors ? await annotateVisualScene(input.scene, input.candidateAnchors) : await localizationGrid(input.scene, dimensions.width, dimensions.height);
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.compositionOnly
    ? "Verify the FINAL scene contains exactly ONE of every supplied character identity, with no missing, duplicated or extra people. Count actual people in the final scene, not reference images. Compare distinct face, skin, hair and appearance independently. Do not assume reference ordering or requested participants prove presence. Return uncertain for any ambiguous or duplicated identity. Do not estimate coordinates or assign numbered positions."
    : input.candidateAnchors
    ? "Match each named character reference to the correct NUMBERED person in the FINAL scene. Compare face, skin, hair length and hair color. Clothing can vary in a generated scene: do not let a copied jacket override facial identity. Reference order is NOT seating order. Identify every person independently and use uncertain instead of guessing. Return the actual person count and one unique label for each player ID. Do not return coordinates."
    : "Locate every listed contestant in the FINAL image using the preceding character reference images. References identify appearance only; do not assume their ordering matches scene positions. Return the actual total number of people. For each listed identity return the tight bounding rectangle of their entire visible head (including hair), with x/y at the TOP LEFT and width/height, all normalized to the FINAL image dimensions. Every physical head must have a distinct non-overlapping rectangle; never reuse a rectangle for two identities. Labels must be unique integers 1 through the number of players. Use uncertain when identity cannot be established. Do not guess based on seating or assume requested players are present. These coordinates will anchor speech bubbles above their heads." }];
  for (const reference of input.references) {
    content.push({ type: "input_text", text: `Character reference identities: ${JSON.stringify(reference.players)}` });
    content.push({ type: "input_image", image_url: `data:image/png;base64,${Buffer.from(reference.image).toString("base64")}`, detail: "high" });
  }
  content.push({ type: "input_text", text: input.compositionOnly ? "FINAL SCENE: verify identities and actual composition only." : input.candidateAnchors ? "FINAL NUMBERED SCENE: Which numbered person is each reference character? Read the reference player IDs carefully. Labels identify positions only, never reference order." : `FINAL SCENE: ${dimensions.width} pixels wide by ${dimensions.height} pixels tall. Locate heads in this image only. The cyan coordinate grid is a measurement aid, not part of the scene. Its horizontal labels are x and vertical labels are y, both normalized 0 to 1. Read the grid to determine actual top-left head coordinates; do not assume a square image or include empty space above the hair. Exclude long hair below the chin from the head rectangle.` });
  content.push({ type: "input_image", image_url: `data:image/png;base64,${inspection.toString("base64")}`, detail: "high" });
  const body = JSON.stringify({ model: "gpt-5.6-sol", store: false, reasoning: { effort: "medium" }, max_output_tokens: 5000,
    input: [{ role: "user", content }], text: { format: { type: "json_schema", name: "scene_localization", strict: true, schema: (input.compositionOnly ? visualCompositionSchema : input.candidateAnchors ? visualIdentitySchema : visualLocalizationSchema)(players.map((player) => player.id)) } } });
  const reservation = { provider: "openai" as const, model: "gpt-5.6-sol", requestHash: createHash("sha256").update(body).digest("hex") };
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
    receipt.failure = visualFailureEvidence(error, "transport");
    await input.journal?.finish(receipt);
    throw error;
  }
  receipt.requestId = response.headers.get("x-request-id");
  receipt.status = response.status;
  receipt.chargeUncertain = response.ok || response.status >= 500;
  let result;
  let responseBody = "";
  try {
    responseBody = await response.text();
    const raw: unknown = JSON.parse(responseBody);
    if (isRecord(raw)) receipt.usage = raw.usage ?? null;
    if (!response.ok) throw new Error(`Scene localization HTTP ${response.status}`);
    if (!isRecord(raw) || raw.status !== "completed" || !Array.isArray(raw.output)) throw new Error("Incomplete scene localization");
    receipt.chargeUncertain = false;
    const text = raw.output.filter(isRecord).filter((item) => item.type === "message")
      .flatMap((item) => Array.isArray(item.content) ? item.content.filter(isRecord) : [])
      .filter((part) => part.type === "output_text");
    if (text.length !== 1 || typeof text[0]?.text !== "string") throw new Error("Missing exact scene localization");
    result = input.compositionOnly ? decodeVisualComposition(text[0].text, players.map((player) => player.id)) : input.candidateAnchors ? decodeVisualIdentities(text[0].text, players.map((player) => player.id), input.candidateAnchors) : decodeVisualLocalization(text[0].text, players.map((player) => player.id));
  } catch (error) {
    const failure = error instanceof VisualIdentityFailure && error.playerIds.length
      ? new VisualIdentityFailure(`${error.message}: ${error.playerIds.map(id => players.find(player => player.id === id)!.name).join(", ")}`, error.playerIds) : error;
    receipt.failure = visualFailureEvidence(failure, !response.ok ? "http" : failure instanceof VisualIdentityFailure ? "identity" : "response", responseBody);
    receipt.elapsedMs = Date.now() - startedAt;
    await input.journal?.finish(receipt);
    throw failure;
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

async function localizationGrid(scene: Uint8Array, width: number, height: number): Promise<Buffer> {
  const marks: string[] = [];
  for (let index = 1; index < 10; index += 1) {
    const x = width * index / 10, y = height * index / 10, label = (index / 10).toFixed(1);
    marks.push(`<path d="M${x},0 V${height} M0,${y} H${width}" fill="none" stroke="#00ffff" stroke-opacity="0.38" stroke-width="1"/>`);
    marks.push(`<text x="${x + 3}" y="18">x${label}</text><text x="3" y="${y - 3}">y${label}</text><text x="${width - 40}" y="${y - 3}">y${label}</text>`);
  }
  return sharp(scene).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="#00ffff" font-family="sans-serif" font-size="16" stroke="black" stroke-width="0.5" paint-order="stroke">${marks.join("")}</g></svg>`) }]).png().toBuffer();
}
