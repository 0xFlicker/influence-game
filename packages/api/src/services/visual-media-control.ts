import { decodeVisualShotReview } from "./visual-shot-review.js";
import type { MediaControl } from "./visual-media-repair.js";

/** Exact command contract shared by the game-scoped and producer media routes. */
export function decodeVisualMediaControl(value: unknown): MediaControl | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  const string = (key: string) => typeof b[key] === "string" && Boolean(b[key].trim()) && b[key].length <= 200;
  if (!string("requestId") || !string("sceneId") || !Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0) return null;
  const fields = ["requestId", "sceneId", "expectedVersion", "action"];
  if (b.action === "review") {
    try { b.review = decodeVisualShotReview(b.review); } catch { return null; }
    fields.push("review");
  } else if (b.action === "verify" || b.action === "harmonize") {
    if (!string("sourceVersionId")) return null;
    fields.push("sourceVersionId");
  } else if (b.action === "continue") {
    if (b.sourceJobId !== undefined && !string("sourceJobId")) return null;
    fields.push("sourceJobId");
  } else if (b.action === "publish") {
    if (!string("versionId") || !Number.isSafeInteger(b.expectedPublication) || Number(b.expectedPublication) < 0) return null;
    if (b.audience !== undefined && b.audience !== "public" && b.audience !== "private") return null;
    fields.push("versionId", "expectedPublication", "audience");
  } else if (b.action === "regenerate") {
    if (b.regenerateForms !== undefined && typeof b.regenerateForms !== "boolean") return null;
    fields.push("regenerateForms");
  } else return null;
  if (Object.keys(b).some(key => !fields.includes(key))) return null;
  return b as MediaControl;
}
