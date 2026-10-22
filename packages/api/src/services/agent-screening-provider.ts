import { classifyProviderError } from "@influence/engine";
import { COLLUSION_SCREENING_INSTRUCTIONS, COLLUSION_SCREENING_SCHEMA, SCREENING_INSTRUCTIONS, SCREENING_LUNA_MODEL, SCREENING_MODERATION_MODEL, SCREENING_SCHEMA, screeningText, validateScreeningRecommendation } from "./agent-screening-policy.js";

export type ScreeningStage = "moderation" | "luna" | "luna_collusion";
export interface ScreeningImage { hash: string; dataUrl: string }
export interface ScreeningResponse { status: number; body: string }
export interface ScreeningProvider {
  invoke(stage: ScreeningStage, request: Record<string, unknown>, signal: AbortSignal): Promise<ScreeningResponse>;
}
/** No SDK/transport retries: every dispatch belongs to a durable attempt. */
export function createAgentScreeningProvider(apiKey: string): ScreeningProvider {
  return { async invoke(stage, request, signal) {
    const response = await fetch(`https://api.openai.com/v1/${stage === "moderation" ? "moderations" : "responses"}`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request), signal,
    });
    return { status: response.status, body: await response.text() };
  } };
}
export class ScreeningFailure extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}
export function buildScreeningRequest(stage: ScreeningStage, snapshot: Record<string, unknown>, image: ScreeningImage | null, safety?: unknown): Record<string, unknown> {
  const text = JSON.stringify(screeningText(snapshot));
  if (stage === "moderation") return {
    model: SCREENING_MODERATION_MODEL,
    input: [{ type: "text", text }, ...(image ? [{ type: "image_url", image_url: { url: image.dataUrl } }] : [])],
  };
  return {
    model: SCREENING_LUNA_MODEL, store: false, reasoning: { effort: "low" }, max_output_tokens: 6000,
    instructions: stage === "luna_collusion" ? COLLUSION_SCREENING_INSTRUCTIONS : SCREENING_INSTRUCTIONS,
    input: [{ role: "user", content: [
      { type: "input_text", text: JSON.stringify({ profile: screeningText(snapshot), safetySignals: safety }) },
      ...(image && stage !== "luna_collusion" ? [
        { type: "input_text", text: `Retained image SHA-256: ${image.hash}` },
        { type: "input_image", image_url: image.dataUrl, detail: "auto" },
      ] : []),
    ] }],
    text: { format: { type: "json_schema", name: "house_agent_screening", strict: true, schema: stage === "luna_collusion" ? COLLUSION_SCREENING_SCHEMA : SCREENING_SCHEMA } },
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScreeningFailure("malformed_output", true);
  return value as Record<string, unknown>;
}
/** Only structured provider safety signals identify refusal; never infer it from prose or HTTP status alone. */
export function screeningResponseMetadata(response: ScreeningResponse) {
  let body: Record<string, unknown> = {};
  try { const value: unknown = JSON.parse(response.body); if (value && typeof value === "object" && !Array.isArray(value)) body = value as Record<string, unknown>; } catch { /* Non-JSON errors still retain their HTTP status. */ }
  const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
  const providerCode = typeof error?.code === "string" ? error.code : null;
  let refusal: string | null = null;
  if ((response.status >= 400 && response.status < 500 || response.status >= 200 && response.status < 300)
    && providerCode && ["content_policy_violation", "image_content_policy_violation", "content_filter"].includes(providerCode)) refusal = providerCode;
  if (response.status >= 200 && response.status < 300) {
    const details = body.incomplete_details as { reason?: unknown } | null;
    if (details?.reason === "content_filter") refusal = "content_filter";
    if (Array.isArray(body.output) && body.output.some(item => item?.type === "message" && Array.isArray(item.content)
      && item.content.some((part: { type?: unknown } | null) => part?.type === "refusal"))) refusal = "refusal";
  }
  return { httpStatus: response.status, providerCode, refusal };
}
export function decodeScreeningResponse(stage: ScreeningStage, response: ScreeningResponse, snapshot: Record<string, unknown>, hashes: string[]) {
  if (screeningResponseMetadata(response).refusal) throw new ScreeningFailure("refusal");
  if (response.status < 200 || response.status >= 300) {
    const outcome = classifyProviderError({ status: response.status, message: "Screening provider rejected request" });
    throw new ScreeningFailure(outcome.kind, outcome.retryable);
  }
  let value: Record<string, unknown>;
  try { value = record(JSON.parse(response.body)); }
  catch { throw new ScreeningFailure("malformed_output", true); }
  if (stage === "moderation") {
    if (typeof value.model !== "string" || !Array.isArray(value.results) || value.results.length !== 1) throw new ScreeningFailure("malformed_output", true);
    for (const result of value.results) {
      const row = record(result);
      if (typeof row.flagged !== "boolean") throw new ScreeningFailure("malformed_output", true);
      const categories = record(row.categories), scores = record(row.category_scores);
      const required = ["hate", "harassment", "sexual", "violence", "self-harm"];
      if (required.some(key => typeof categories[key] !== "boolean" || typeof scores[key] !== "number")
        || Object.values(categories).some(v => typeof v !== "boolean")
        || Object.values(scores).some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) throw new ScreeningFailure("malformed_output", true);
    }
    return value;
  }
  if (value.status !== "completed" || !Array.isArray(value.output)) throw new ScreeningFailure("incomplete_output", true);
  const messages = value.output.map(record).filter(item => item.type === "message");
  const content = messages.flatMap(item => Array.isArray(item.content) ? item.content.map(record) : []);
  if (content.some(item => item.type === "refusal")) throw new ScreeningFailure("refusal");
  const texts = content.filter(item => item.type === "output_text");
  if (texts.length !== 1 || typeof texts[0]!.text !== "string") throw new ScreeningFailure("malformed_output", true);
  try {
    const result = validateScreeningRecommendation(JSON.parse(texts[0]!.text), snapshot, stage === "luna_collusion" ? [] : hashes);
    if (stage === "luna_collusion" && result.findings.some(finding => finding.category !== "outside_game_collusion" || finding.source !== "text")) throw new Error("invalid_collusion_finding");
    return result;
  }
  catch { throw new ScreeningFailure("malformed_output", true); }
}
