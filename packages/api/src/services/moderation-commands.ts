import sharp from "sharp";
import type { DrizzleDB } from "../db/index.js";
import { ModerationError, moderationAuthority, readModerationReceipt, listModerationRecovery, listModerationQueue, readModerationReview, readModerationEvidence, claimModerationReview, triageModerationReview, previewModerationDecision, decideModerationReview, reopenModerationReview } from "./moderation-intake.js";
import { restoreArchivedAgentProfile } from "./agent-profile-lifecycle.js";

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new ModerationError("invalid_input", "Invalid command fields.", 400);
  return value as Record<string, unknown>;
}
function text(body: Record<string, unknown>, key: string, max = 200) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ModerationError("invalid_input", `Invalid ${key}.`, 400);
  return value;
}
function optionalText(body: Record<string, unknown>, key: string, max = 200) {
  return body[key] === undefined ? undefined : text(body, key, max);
}
function integer(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ModerationError("invalid_input", `Invalid ${key}.`, 400);
  return value;
}
function choice<const T extends string>(body: Record<string, unknown>, key: string, choices: readonly T[]): T {
  const value = text(body, key);
  if (!choices.includes(value as T)) throw new ModerationError("invalid_input", `Invalid ${key}.`, 400);
  return value as T;
}


/** Shared bounded command adapter for HTTP and explicit-scope MCP calls. */
export async function executeModerationRead(db: DrizzleDB, userId: string, value: unknown) {
  const b = object(value, ["operation", "reviewId", "actionId", "hash", "offset", "route", "filter", "action"]);
  const operation = choice(b, "operation", ["capabilities", "queue", "review", "evidence", "preview", "receipt", "recovery"]);
  const fields = { capabilities: [], queue: ["offset", "route", "filter"], recovery: ["offset"], receipt: ["actionId"], review: ["reviewId"], evidence: ["reviewId", "hash"], preview: ["reviewId", "action"] };
  object(value, ["operation", ...fields[operation]]);
  if (operation === "capabilities") return moderationAuthority(db, userId);
  if (operation === "queue") return listModerationQueue(db, userId, { offset: b.offset === undefined ? undefined : integer(b, "offset"), route: b.route === undefined ? undefined : choice(b, "route", ["ordinary", "escalated"]), filter: b.filter === undefined ? undefined : choice(b, "filter", ["all", "available", "mine", "flagged"]) });
  if (operation === "recovery") return listModerationRecovery(db, userId, b.offset === undefined ? 0 : integer(b, "offset"));
  if (operation === "receipt") return readModerationReceipt(db, userId, text(b, "actionId"));
  const reviewId = text(b, "reviewId");
  if (operation === "review") return readModerationReview(db, userId, reviewId);
  if (operation === "preview") return previewModerationDecision(db, userId, { reviewId, action: choice(b, "action", ["accept", "reject"]) });
  const bytes = await readModerationEvidence(db, userId, reviewId, text(b, "hash", 64));
  return { mimeType: "image/png", data: (await sharp(bytes).rotate().png().toBuffer()).toString("base64") };
}

export async function executeModerationWrite(db: DrizzleDB, userId: string, value: unknown) {
  const b = object(value, ["operation", "actionId", "reviewId", "profileId", "route", "action", "token", "version", "reason", "previewFingerprint", "expectedDisposition", "disposition", "undoActionId"]);
  const operation = choice(b, "operation", ["claim", "triage", "decide", "reopen", "restore"]);
  const fields = { restore: ["profileId", "version", "reason"], claim: ["actionId", "reviewId", "route"], reopen: ["actionId", "reviewId", "version", "reason"], triage: ["actionId", "reviewId", "version", "token", "reason", "action"], decide: ["actionId", "reviewId", "version", "token", "reason", "action", "previewFingerprint", "expectedDisposition", "disposition", "undoActionId"] };
  object(value, ["operation", ...fields[operation]]);
  if (operation === "restore") return restoreArchivedAgentProfile(db, userId, { profileId: text(b, "profileId"), version: integer(b, "version"), reason: text(b, "reason", 2000) });
  const actionId = text(b, "actionId");
  if (operation === "claim") return claimModerationReview(db, userId, { actionId, reviewId: optionalText(b, "reviewId"), route: b.route === undefined ? undefined : choice(b, "route", ["ordinary", "escalated"]) });
  const reviewId = text(b, "reviewId"), version = integer(b, "version");
  if (operation === "reopen") return reopenModerationReview(db, userId, { actionId, reviewId, version, reason: text(b, "reason", 2000) });
  if (operation === "triage") return triageModerationReview(db, userId, { actionId, reviewId, version, token: text(b, "token"), reason: optionalText(b, "reason", 2000), action: choice(b, "action", ["extend", "release", "flag", "pass", "return"]) });
  return decideModerationReview(db, userId, { actionId, reviewId, version, token: optionalText(b, "token") ?? "", reason: optionalText(b, "reason", 2000), action: choice(b, "action", ["accept", "reject"]), previewFingerprint: text(b, "previewFingerprint"), expectedDisposition: choice(b, "expectedDisposition", ["allowed", "rejected"]), disposition: choice(b, "disposition", ["allowed", "rejected"]), undoActionId: optionalText(b, "undoActionId") });
}
