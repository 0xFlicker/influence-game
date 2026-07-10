import { createHash } from "node:crypto";
import type { HouseHighlightVisualCardFactKind } from "../postgame-highlights/types";

export const HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION = 1 as const;
export const HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE = "house_highlights_trailer" as const;
export const HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION =
  "house-highlights-trailer-timing-v1" as const;

export type HouseHighlightsTrailerAgentStatus =
  | "winner"
  | "finalist"
  | "eliminated"
  | "unknown";

export interface HouseHighlightsTrailerAgent {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string;
  placement: number | null;
  status: HouseHighlightsTrailerAgentStatus;
}

export interface HouseHighlightsTrailerFact {
  id: string;
  kind: HouseHighlightVisualCardFactKind;
  text: string;
  agentIds: string[];
}

export interface HouseHighlightsTrailerPlayerResult {
  agent: HouseHighlightsTrailerAgent;
  placementLabel: string;
  tags: string[];
}

export interface HouseHighlightsTrailerScenelet {
  id: string;
  title: string;
  visualType: string;
  backgroundImage: string;
  backdropCategory: string;
  primaryAgents: HouseHighlightsTrailerAgent[];
  secondaryAgents: HouseHighlightsTrailerAgent[];
  outcome: string;
  facts: HouseHighlightsTrailerFact[];
}

export interface HouseHighlightsTrailerFinalVoteGroup {
  finalist: HouseHighlightsTrailerAgent;
  votes: number;
  jurors: HouseHighlightsTrailerAgent[];
}

export interface HouseHighlightsTrailerFinalVote {
  finalists: HouseHighlightsTrailerAgent[];
  groups: HouseHighlightsTrailerFinalVoteGroup[];
  voteLabel: string;
  winner: HouseHighlightsTrailerAgent;
}

export type HouseHighlightsTrailerCueSegmentKind =
  | "cast_roster"
  | "scenelet"
  | "final_vote"
  | "winner"
  | "player_result";

export interface HouseHighlightsTrailerCueSegment {
  id: string;
  kind: HouseHighlightsTrailerCueSegmentKind;
  label: string;
  startFrame: number;
  endFrame: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface HouseHighlightsTrailerCueSheet {
  schemaVersion: 1;
  timingContractVersion: typeof HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION;
  frameRate: number;
  totalFrames: number;
  totalDurationSeconds: number;
  segments: HouseHighlightsTrailerCueSegment[];
  markers: {
    finalVoteRevealSeconds: number;
    winnerRevealSeconds: number;
  };
}

export interface HouseHighlightsTrailerManifest {
  schemaVersion: typeof HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION;
  mediaType: typeof HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE;
  timingContractVersion: typeof HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION;
  game: {
    id: string;
    slug: string | null;
    status: "completed";
  };
  frameRate: number;
  width: number;
  height: number;
  cast: HouseHighlightsTrailerAgent[];
  scenelets: HouseHighlightsTrailerScenelet[];
  finalVote: HouseHighlightsTrailerFinalVote;
  playerResults: HouseHighlightsTrailerPlayerResult[];
  cueSheet: HouseHighlightsTrailerCueSheet;
}

export interface HouseHighlightsTrailerManifestValidationResult {
  ok: boolean;
  errors: string[];
}

const AGENT_STATUSES = new Set<HouseHighlightsTrailerAgentStatus>([
  "winner",
  "finalist",
  "eliminated",
  "unknown",
]);
const FACT_KINDS = new Set<HouseHighlightVisualCardFactKind>([
  "vote_action",
  "alliance_membership",
  "elimination",
  "protection",
  "survival",
  "jury_outcome",
  "round_context",
  "outcome",
]);
const CUE_KINDS = new Set<HouseHighlightsTrailerCueSegmentKind>([
  "cast_roster",
  "scenelet",
  "final_vote",
  "winner",
  "player_result",
]);

export function validateHouseHighlightsTrailerManifest(
  value: unknown,
): HouseHighlightsTrailerManifestValidationResult {
  const errors: string[] = [];
  const manifest = recordAt(value, "manifest", errors);
  if (!manifest) return { ok: false, errors };

  if (manifest.schemaVersion !== HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION) {
    errors.push(`schemaVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION}`);
  }
  if (manifest.mediaType !== HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE) {
    errors.push(`mediaType must be ${HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE}`);
  }
  if (manifest.timingContractVersion !== HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION) {
    errors.push(
      `timingContractVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION}`,
    );
  }

  validateGame(manifest.game, errors);
  positiveInteger(manifest.frameRate, "frameRate", errors);
  positiveInteger(manifest.width, "width", errors);
  positiveInteger(manifest.height, "height", errors);
  validateArray(manifest.cast, "cast", errors, validateAgent);
  validateArray(manifest.scenelets, "scenelets", errors, validateScenelet);
  validateFinalVote(manifest.finalVote, errors);
  validateArray(manifest.playerResults, "playerResults", errors, validatePlayerResult);
  validateCueSheet(manifest.cueSheet, manifest.frameRate, errors);

  return { ok: errors.length === 0, errors };
}

export function assertHouseHighlightsTrailerManifest(
  value: unknown,
): asserts value is HouseHighlightsTrailerManifest {
  const result = validateHouseHighlightsTrailerManifest(value);
  if (!result.ok) {
    throw new Error(`Invalid House Highlights trailer manifest: ${result.errors.join("; ")}`);
  }
}

export function parseHouseHighlightsTrailerManifest(
  value: string | unknown,
): HouseHighlightsTrailerManifest {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  assertHouseHighlightsTrailerManifest(parsed);
  return parsed;
}

export function serializeHouseHighlightsTrailerManifest(
  manifest: HouseHighlightsTrailerManifest,
): string {
  return stableJson(manifest);
}

export function hashHouseHighlightsTrailerManifest(
  manifest: HouseHighlightsTrailerManifest,
): string {
  return `sha256:${createHash("sha256")
    .update(serializeHouseHighlightsTrailerManifest(manifest))
    .digest("hex")}`;
}

function validateGame(value: unknown, errors: string[]): void {
  const game = recordAt(value, "game", errors);
  if (!game) return;
  nonEmptyString(game.id, "game.id", errors);
  if (game.slug !== null) nonEmptyString(game.slug, "game.slug", errors);
  if (game.status !== "completed") errors.push("game.status must be completed");
}

function validateAgent(value: unknown, path: string, errors: string[]): void {
  const agent = recordAt(value, path, errors);
  if (!agent) return;
  nonEmptyString(agent.id, `${path}.id`, errors);
  nonEmptyString(agent.name, `${path}.name`, errors);
  nonEmptyString(agent.initials, `${path}.initials`, errors);
  stringValue(agent.avatarUrl, `${path}.avatarUrl`, errors);
  if (agent.placement !== null) positiveInteger(agent.placement, `${path}.placement`, errors);
  if (!AGENT_STATUSES.has(agent.status as HouseHighlightsTrailerAgentStatus)) {
    errors.push(`${path}.status is invalid`);
  }
}

function validateScenelet(value: unknown, path: string, errors: string[]): void {
  const scenelet = recordAt(value, path, errors);
  if (!scenelet) return;
  nonEmptyString(scenelet.id, `${path}.id`, errors);
  nonEmptyString(scenelet.title, `${path}.title`, errors);
  nonEmptyString(scenelet.visualType, `${path}.visualType`, errors);
  nonEmptyString(scenelet.backgroundImage, `${path}.backgroundImage`, errors);
  nonEmptyString(scenelet.backdropCategory, `${path}.backdropCategory`, errors);
  nonEmptyString(scenelet.outcome, `${path}.outcome`, errors);
  validateArray(scenelet.primaryAgents, `${path}.primaryAgents`, errors, validateAgent);
  validateArray(scenelet.secondaryAgents, `${path}.secondaryAgents`, errors, validateAgent);
  validateArray(scenelet.facts, `${path}.facts`, errors, validateFact);
}

function validateFact(value: unknown, path: string, errors: string[]): void {
  const fact = recordAt(value, path, errors);
  if (!fact) return;
  nonEmptyString(fact.id, `${path}.id`, errors);
  nonEmptyString(fact.text, `${path}.text`, errors);
  if (!FACT_KINDS.has(fact.kind as HouseHighlightVisualCardFactKind)) {
    errors.push(`${path}.kind is invalid`);
  }
  stringArray(fact.agentIds, `${path}.agentIds`, errors);
}

function validateFinalVote(value: unknown, errors: string[]): void {
  const finalVote = recordAt(value, "finalVote", errors);
  if (!finalVote) return;
  validateArray(finalVote.finalists, "finalVote.finalists", errors, validateAgent);
  validateArray(finalVote.groups, "finalVote.groups", errors, validateFinalVoteGroup);
  nonEmptyString(finalVote.voteLabel, "finalVote.voteLabel", errors);
  if (!isRecord(finalVote.winner)) {
    errors.push("finalVote.winner must be an agent");
  } else {
    validateAgent(finalVote.winner, "finalVote.winner", errors);
  }
}

function validateFinalVoteGroup(value: unknown, path: string, errors: string[]): void {
  const group = recordAt(value, path, errors);
  if (!group) return;
  validateAgent(group.finalist, `${path}.finalist`, errors);
  nonNegativeInteger(group.votes, `${path}.votes`, errors);
  validateArray(group.jurors, `${path}.jurors`, errors, validateAgent);
}

function validatePlayerResult(value: unknown, path: string, errors: string[]): void {
  const result = recordAt(value, path, errors);
  if (!result) return;
  validateAgent(result.agent, `${path}.agent`, errors);
  nonEmptyString(result.placementLabel, `${path}.placementLabel`, errors);
  stringArray(result.tags, `${path}.tags`, errors);
}

function validateCueSheet(value: unknown, frameRate: unknown, errors: string[]): void {
  const cueSheet = recordAt(value, "cueSheet", errors);
  if (!cueSheet) return;
  if (cueSheet.schemaVersion !== HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION) {
    errors.push(`cueSheet.schemaVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION}`);
  }
  if (cueSheet.timingContractVersion !== HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION) {
    errors.push(
      `cueSheet.timingContractVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION}`,
    );
  }
  positiveInteger(cueSheet.frameRate, "cueSheet.frameRate", errors);
  if (typeof frameRate === "number" && cueSheet.frameRate !== frameRate) {
    errors.push("cueSheet.frameRate must match frameRate");
  }
  nonNegativeInteger(cueSheet.totalFrames, "cueSheet.totalFrames", errors);
  nonNegativeNumber(
    cueSheet.totalDurationSeconds,
    "cueSheet.totalDurationSeconds",
    errors,
  );
  validateArray(cueSheet.segments, "cueSheet.segments", errors, validateCueSegment);

  const markers = recordAt(cueSheet.markers, "cueSheet.markers", errors);
  if (markers) {
    nonNegativeNumber(
      markers.finalVoteRevealSeconds,
      "cueSheet.markers.finalVoteRevealSeconds",
      errors,
    );
    nonNegativeNumber(
      markers.winnerRevealSeconds,
      "cueSheet.markers.winnerRevealSeconds",
      errors,
    );
  }
}

function validateCueSegment(value: unknown, path: string, errors: string[]): void {
  const segment = recordAt(value, path, errors);
  if (!segment) return;
  nonEmptyString(segment.id, `${path}.id`, errors);
  nonEmptyString(segment.label, `${path}.label`, errors);
  if (!CUE_KINDS.has(segment.kind as HouseHighlightsTrailerCueSegmentKind)) {
    errors.push(`${path}.kind is invalid`);
  }
  nonNegativeInteger(segment.startFrame, `${path}.startFrame`, errors);
  nonNegativeInteger(segment.endFrame, `${path}.endFrame`, errors);
  nonNegativeNumber(segment.startSeconds, `${path}.startSeconds`, errors);
  nonNegativeNumber(segment.endSeconds, `${path}.endSeconds`, errors);
  nonNegativeNumber(segment.durationSeconds, `${path}.durationSeconds`, errors);
  if (
    typeof segment.startFrame === "number"
    && typeof segment.endFrame === "number"
    && segment.endFrame <= segment.startFrame
  ) {
    errors.push(`${path}.endFrame must be greater than startFrame`);
  }
}

function validateArray(
  value: unknown,
  path: string,
  errors: string[],
  validateEntry: (entry: unknown, path: string, errors: string[]) => void,
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => validateEntry(entry, `${path}[${index}]`, errors));
}

function stringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function nonEmptyString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function stringValue(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${path} must be a string`);
}

function positiveInteger(value: unknown, path: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 1) {
    errors.push(`${path} must be a positive integer`);
  }
}

function nonNegativeInteger(value: unknown, path: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function nonNegativeNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be a non-negative number`);
  }
}

function recordAt(
  value: unknown,
  path: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => entry === undefined ? "null" : stableJson(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
