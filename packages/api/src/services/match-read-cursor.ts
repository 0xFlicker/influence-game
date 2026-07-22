/**
 * AES-GCM opaque cursor codec for match transcript, owned cognition, and
 * dual-surface match narrative pagination.
 *
 * V2 tokens (`mr2.<base64url>`) seal MessagePack positional tuples inside a
 * single binary envelope (header + IV + ciphertext + tag). V1 JSON envelopes
 * remain decodable for one release window (≤30 min lifetime).
 *
 * Tokens are bound to purpose, subject, game, filter fingerprint, ownership
 * fingerprint (owner surfaces), capture version, pinned read-through boundary,
 * and internal keyset position. Narrative cursors also seal surface capability
 * so owner and producer walks cannot resume each other.
 *
 * Reject oversized / structurally malformed tokens before any database access.
 * Wrong-purpose tokens fail closed (AAD + claim purpose mismatch).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import { sha256StableJson } from "./stable-hash.js";

/** Active issue format version (V2 compact binary envelope). */
export const MATCH_READ_CURSOR_VERSION = 2 as const;

/** Legacy V1 format version (JSON envelope + JSON claims). */
export const MATCH_READ_CURSOR_VERSION_V1 = 1 as const;

/** Active encryption key version. Rotation bumps this and invalidates old tokens. */
export const MATCH_READ_CURSOR_KEY_VERSION = 1 as const;

/** Purpose claim for authorized transcript page/catch-up walks. */
export const MATCH_TRANSCRIPT_CURSOR_PURPOSE = "match_transcript" as const;

/** Purpose claim for owned thinking/strategy timeline walks. */
export const MATCH_COGNITION_CURSOR_PURPOSE = "match_cognition" as const;

/**
 * Purpose claim for dual-surface match narrative pages.
 * Surface (`subject_owner` | `producer`) is sealed into claims and AAD is
 * purpose-only; wrong-surface resume fails bind / claims validation.
 */
export const MATCH_NARRATIVE_CURSOR_PURPOSE = "match_narrative" as const;

/** Domain separator for AES-256 key derivation (V2). */
const KEY_DOMAIN_V2 = "influence.match.read_cursor.aes.v2";

/** Domain separator for AES-256 key derivation (legacy V1). */
const KEY_DOMAIN_V1 = "influence.match.read_cursor.aes.v1";

/** V2 token prefix before base64url envelope. */
export const MATCH_READ_CURSOR_V2_PREFIX = "mr2." as const;

/** Maximum sealed V2 token UTF-8 length accepted before parse/decrypt. */
export const MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V2 = 1536;

/**
 * Maximum sealed legacy V1 token UTF-8 length accepted before parse/decrypt.
 * Retained only for V1 compatibility decoding.
 */
export const MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V1 = 4096;

/**
 * @deprecated Prefer format-specific maxima. Alias for V1 max so oversized
 * legacy checks and older call sites keep compiling during the transition.
 */
export const MATCH_READ_CURSOR_MAX_TOKEN_CHARS = MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V1;

/** Maximum cursor lifetime (30 minutes). */
export const MATCH_READ_CURSOR_MAX_TTL_MS = 30 * 60 * 1000;

/**
 * Producer narrative cursors seal this constant instead of an ownership set.
 * Owner surfaces always use the real ownership fingerprint.
 */
export const MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT = "producer:none" as const;

const AES_ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HEADER_BYTES = 3;

/** Wire purpose codes for the authenticated V2 header. */
const PURPOSE_CODE = {
  [MATCH_TRANSCRIPT_CURSOR_PURPOSE]: 1,
  [MATCH_COGNITION_CURSOR_PURPOSE]: 2,
  [MATCH_NARRATIVE_CURSOR_PURPOSE]: 3,
} as const;

const PURPOSE_FROM_CODE: ReadonlyMap<number, MatchReadCursorPurpose> = new Map([
  [1, MATCH_TRANSCRIPT_CURSOR_PURPOSE],
  [2, MATCH_COGNITION_CURSOR_PURPOSE],
  [3, MATCH_NARRATIVE_CURSOR_PURPOSE],
]);

const MODE_SNAPSHOT = 0;
const MODE_CATCHUP = 1;

const SURFACE_OWNER = 0;
const SURFACE_PRODUCER = 1;

const PRESET_STRATEGIC = 0;
const PRESET_DIALOGUE_ONLY = 1;
const PRESET_FULL_COGNITION = 2;

const DETAIL_COMPACT = 0;
const DETAIL_FULL = 1;

const ARTIFACT_THINKING = 0;
const ARTIFACT_STRATEGY = 1;

export type MatchTranscriptCursorPurpose = typeof MATCH_TRANSCRIPT_CURSOR_PURPOSE;
export type MatchCognitionCursorPurpose = typeof MATCH_COGNITION_CURSOR_PURPOSE;
export type MatchNarrativeCursorPurpose = typeof MATCH_NARRATIVE_CURSOR_PURPOSE;
export type MatchReadCursorPurpose =
  | MatchTranscriptCursorPurpose
  | MatchCognitionCursorPurpose
  | MatchNarrativeCursorPurpose;

export type MatchTranscriptCursorMode = "snapshot" | "catchup";
export type MatchCognitionCursorMode = "snapshot" | "catchup";
export type MatchNarrativeCursorMode = "snapshot";

export type MatchNarrativeSurface = "subject_owner" | "producer";

/**
 * Internal keyset position after which the next page continues.
 * Modern walks use entrySequence; legacy walks use (timestamp, id).
 */
export interface MatchReadKeyset {
  /** Exclusive lower bound for modern entrySequence (null = start). */
  afterEntrySequence: number | null;
  /** Exclusive lower bound for legacy (timestamp, id) walks. */
  afterLegacyTimestamp: number | null;
  afterLegacyId: number | null;
}

/** Pinned read-through boundary for a finite snapshot walk. */
export interface MatchReadThroughBoundary {
  /** Modern: inclusive max product dialogue sequence (durable watermark). */
  throughEntrySequence: number | null;
  /** Legacy: inclusive terminal (timestamp, id) pinned on first page. */
  throughLegacyTimestamp: number | null;
  throughLegacyId: number | null;
}

/**
 * Normalized filters sealed into the transcript cursor so resume walks reapply
 * the same dimensional predicates without trusting client re-supply alone.
 */
export interface MatchTranscriptCursorFilters {
  phase: string | null;
  round: number | null;
  scope: string | null;
  playerId: string | null;
  player: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
}

/**
 * Sealed transcript cursor claims. Never log plaintext claims or ownership fingerprints.
 * `filterFingerprint` is recomputed from sealed filters after V2 decode.
 */
export interface MatchTranscriptCursorClaims {
  version: typeof MATCH_READ_CURSOR_VERSION | typeof MATCH_READ_CURSOR_VERSION_V1;
  purpose: MatchTranscriptCursorPurpose;
  keyVersion: number;
  issuedAtMs: number;
  expiresAtMs: number;
  subjectUserId: string;
  gameId: string;
  filterFingerprint: string;
  ownershipFingerprint: string;
  captureVersion: number;
  mode: MatchTranscriptCursorMode;
  readThrough: MatchReadThroughBoundary;
  keyset: MatchReadKeyset;
  /** Sealed filter values for resume (must match filterFingerprint). */
  filters: MatchTranscriptCursorFilters;
}

/**
 * Cognition timeline keyset: exclusive lower bound for DESC (createdAt, id).
 */
export interface MatchCognitionKeyset {
  afterCreatedAt: string | null;
  afterId: string | null;
}

/**
 * Pinned inclusive newest boundary for a cognition snapshot walk.
 * Rows newer than this boundary are deferred to catch-up.
 */
export interface MatchCognitionReadThroughBoundary {
  throughCreatedAt: string | null;
  throughId: string | null;
}

/**
 * Normalized cognition filters sealed into the cursor.
 */
export interface MatchCognitionCursorFilters {
  artifactType: "thinking" | "strategy" | null;
  actorPlayerId: string | null;
  /** Original player filter token for echo (never ownership list). */
  player: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
}

/**
 * Sealed cognition cursor claims. Never log plaintext claims or ownership fingerprints.
 */
export interface MatchCognitionCursorClaims {
  version: typeof MATCH_READ_CURSOR_VERSION | typeof MATCH_READ_CURSOR_VERSION_V1;
  purpose: MatchCognitionCursorPurpose;
  keyVersion: number;
  issuedAtMs: number;
  expiresAtMs: number;
  subjectUserId: string;
  gameId: string;
  filterFingerprint: string;
  ownershipFingerprint: string;
  captureVersion: number;
  mode: MatchCognitionCursorMode;
  readThrough: MatchCognitionReadThroughBoundary;
  keyset: MatchCognitionKeyset;
  filters: MatchCognitionCursorFilters;
}

/**
 * Dual-lane narrative read-through pins sealed on first page.
 */
export interface MatchNarrativeDualReadThrough {
  transcript: MatchReadThroughBoundary;
  cognition: MatchCognitionReadThroughBoundary;
}

/**
 * Group-level keyset for narrative pages (exclusive lower bound).
 * `afterGroupId` holds a fixed-size SHA-256 Base64URL group digest (V2) or a
 * legacy joined-member-id string (V1).
 */
export interface MatchNarrativeKeyset {
  afterSortKey: number | null;
  afterGroupId: string | null;
}

/**
 * Normalized narrative filters sealed into the cursor (includes preset/detail
 * and compact-v2 pagination fields).
 */
export interface MatchNarrativeCursorFilters {
  preset: "strategic" | "dialogue_only" | "full_cognition";
  detail: "compact" | "full";
  playerId: string | null;
  player: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
  schemaVersion: 1 | 2;
  includeUnpaired: boolean;
}

/**
 * Sealed narrative cursor claims. Surface is required; owner walks also bind
 * ownershipFingerprint while producer walks use a fixed sentinel.
 *
 * `canonicalLastTrustedSequence` pins the trusted canonical event prefix used
 * for decisionId→vote.cast linkage on this walk:
 * - number ≥ 0: fresh/linked walk; continuations ignore later events and go
 *   stale if the trusted prefix shrinks below the pin
 * - null: legacy cursor without a pin (unlinked walk; reissue preserves null)
 */
export interface MatchNarrativeCursorClaims {
  version: typeof MATCH_READ_CURSOR_VERSION | typeof MATCH_READ_CURSOR_VERSION_V1;
  purpose: MatchNarrativeCursorPurpose;
  keyVersion: number;
  issuedAtMs: number;
  expiresAtMs: number;
  subjectUserId: string;
  gameId: string;
  surface: MatchNarrativeSurface;
  filterFingerprint: string;
  ownershipFingerprint: string;
  /** Transcript capture version bound for resume. */
  transcriptCaptureVersion: number;
  /** Cognitive artifact capture version bound for resume. */
  cognitiveCaptureVersion: number;
  mode: MatchNarrativeCursorMode;
  readThrough: MatchNarrativeDualReadThrough;
  keyset: MatchNarrativeKeyset;
  filters: MatchNarrativeCursorFilters;
  /**
   * Internal pin for trusted canonical-event linkage. Not part of public
   * `readThrough` response DTO (avoids recurring token overhead).
   */
  canonicalLastTrustedSequence: number | null;
}

export type MatchReadCursorDecodeResult =
  | { status: "ok"; claims: MatchTranscriptCursorClaims }
  | { status: "invalid" };

export type MatchCognitionCursorDecodeResult =
  | { status: "ok"; claims: MatchCognitionCursorClaims }
  | { status: "invalid" };

export type MatchNarrativeCursorDecodeResult =
  | { status: "ok"; claims: MatchNarrativeCursorClaims }
  | { status: "invalid" };

export interface IssueMatchTranscriptCursorInput {
  subjectUserId: string;
  gameId: string;
  /**
   * Optional precomputed fingerprint; when omitted, recomputed from filters.
   * Not sealed in V2 — always recomputed on decode.
   */
  filterFingerprint?: string;
  ownershipFingerprint: string;
  captureVersion: number;
  mode: MatchTranscriptCursorMode;
  readThrough: MatchReadThroughBoundary;
  keyset: MatchReadKeyset;
  filters: MatchTranscriptCursorFilters;
  /** Optional clock for tests (unix ms). */
  nowMs?: number;
  /** Optional TTL override clamped to MAX. */
  ttlMs?: number;
}

export interface IssueMatchCognitionCursorInput {
  subjectUserId: string;
  gameId: string;
  filterFingerprint?: string;
  ownershipFingerprint: string;
  captureVersion: number;
  mode: MatchCognitionCursorMode;
  readThrough: MatchCognitionReadThroughBoundary;
  keyset: MatchCognitionKeyset;
  filters: MatchCognitionCursorFilters;
  nowMs?: number;
  ttlMs?: number;
}

export interface IssueMatchNarrativeCursorInput {
  subjectUserId: string;
  gameId: string;
  surface: MatchNarrativeSurface;
  filterFingerprint?: string;
  ownershipFingerprint: string;
  transcriptCaptureVersion: number;
  cognitiveCaptureVersion: number;
  mode: MatchNarrativeCursorMode;
  readThrough: MatchNarrativeDualReadThrough;
  keyset: MatchNarrativeKeyset;
  filters: MatchNarrativeCursorFilters;
  /**
   * Trusted canonical event prefix pin. Fresh reads pass lastTrustedSequence;
   * continuations re-seal the decoded pin (including null for legacy walks).
   * Defaults to null when omitted (tests / legacy).
   */
  canonicalLastTrustedSequence?: number | null;
  nowMs?: number;
  ttlMs?: number;
}

export class MatchReadCursorError extends Error {
  readonly code: "missing_secret" | "encode_failed";

  constructor(code: "missing_secret" | "encode_failed", message: string) {
    super(message);
    this.name = "MatchReadCursorError";
    this.code = code;
  }
}

/**
 * Deterministic fixed-size group digest for narrative keyset + equal-sort-key
 * ordering. Sorted member ids, SHA-256, Base64URL (no padding).
 */
export function digestNarrativeGroupMembers(memberIds: readonly string[]): string {
  const sorted = [...memberIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash("sha256");
  hash.update("influence.match.narrative.group.v1");
  hash.update("\0");
  for (const id of sorted) {
    hash.update(id);
    hash.update("\0");
  }
  return hash.digest("base64url");
}

/**
 * Normalize closed transcript filters into a stable fingerprint string.
 * Only known filter keys participate; order is fixed via stable JSON.
 */
export function fingerprintMatchTranscriptFilters(filters: {
  phase: string | null;
  round: number | null;
  scope: string | null;
  /** Canonical resolved player id when the filter resolved; null when absent. */
  playerId: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
}): string {
  return sha256StableJson({
    domain: "influence.match.transcript.filters.v1",
    phase: filters.phase,
    round: filters.round,
    scope: filters.scope,
    playerId: filters.playerId,
    fromTimestampMs: filters.fromTimestampMs,
    toTimestampMs: filters.toTimestampMs,
  });
}

/**
 * Normalize closed cognition filters into a stable fingerprint string.
 */
export function fingerprintMatchCognitionFilters(filters: {
  artifactType: "thinking" | "strategy" | null;
  actorPlayerId: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
}): string {
  return sha256StableJson({
    domain: "influence.match.cognition.filters.v1",
    artifactType: filters.artifactType,
    actorPlayerId: filters.actorPlayerId,
    phase: filters.phase,
    round: filters.round,
    action: filters.action,
  });
}

/**
 * Normalize closed narrative filters (including preset/detail/schema) into a fingerprint.
 */
export function fingerprintMatchNarrativeFilters(filters: {
  preset: "strategic" | "dialogue_only" | "full_cognition";
  detail: "compact" | "full";
  playerId: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
  schemaVersion: 1 | 2;
  includeUnpaired: boolean;
}): string {
  return sha256StableJson({
    domain: "influence.match.narrative.filters.v2",
    preset: filters.preset,
    detail: filters.detail,
    playerId: filters.playerId,
    phase: filters.phase,
    round: filters.round,
    action: filters.action,
    fromTimestampMs: filters.fromTimestampMs,
    toTimestampMs: filters.toTimestampMs,
    schemaVersion: filters.schemaVersion,
    includeUnpaired: filters.includeUnpaired,
  });
}

/**
 * Seal a transcript pagination cursor (V2 only). Requires JWT_SECRET (or injected secret).
 */
export function issueMatchTranscriptCursor(
  input: IssueMatchTranscriptCursorInput,
  secretMaterial: string = requireApiSecret(),
): string {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = clampTtlMs(input.ttlMs);
  const filters = normalizeTranscriptFilters(input.filters);
  const claims: MatchTranscriptCursorClaims = {
    version: MATCH_READ_CURSOR_VERSION,
    purpose: MATCH_TRANSCRIPT_CURSOR_PURPOSE,
    keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    subjectUserId: input.subjectUserId,
    gameId: input.gameId,
    filterFingerprint: fingerprintMatchTranscriptFilters({
      phase: filters.phase,
      round: filters.round,
      scope: filters.scope,
      playerId: filters.playerId,
      fromTimestampMs: filters.fromTimestampMs,
      toTimestampMs: filters.toTimestampMs,
    }),
    ownershipFingerprint: input.ownershipFingerprint,
    captureVersion: input.captureVersion,
    mode: input.mode,
    readThrough: normalizeTranscriptReadThrough(input.readThrough),
    keyset: normalizeTranscriptKeyset(input.keyset),
    filters,
  };

  return sealClaimsV2(claims, MATCH_TRANSCRIPT_CURSOR_PURPOSE, secretMaterial);
}

/**
 * Seal an owned-cognition timeline pagination cursor (V2 only).
 */
export function issueMatchCognitionCursor(
  input: IssueMatchCognitionCursorInput,
  secretMaterial: string = requireApiSecret(),
): string {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = clampTtlMs(input.ttlMs);
  const filters = normalizeCognitionFilters(input.filters);
  const claims: MatchCognitionCursorClaims = {
    version: MATCH_READ_CURSOR_VERSION,
    purpose: MATCH_COGNITION_CURSOR_PURPOSE,
    keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    subjectUserId: input.subjectUserId,
    gameId: input.gameId,
    filterFingerprint: fingerprintMatchCognitionFilters({
      artifactType: filters.artifactType,
      actorPlayerId: filters.actorPlayerId,
      phase: filters.phase,
      round: filters.round,
      action: filters.action,
    }),
    ownershipFingerprint: input.ownershipFingerprint,
    captureVersion: input.captureVersion,
    mode: input.mode,
    readThrough: normalizeCognitionReadThrough(input.readThrough),
    keyset: normalizeCognitionKeyset(input.keyset),
    filters,
  };

  return sealClaimsV2(claims, MATCH_COGNITION_CURSOR_PURPOSE, secretMaterial);
}

/**
 * Seal a dual-surface match narrative pagination cursor (V2 only).
 */
export function issueMatchNarrativeCursor(
  input: IssueMatchNarrativeCursorInput,
  secretMaterial: string = requireApiSecret(),
): string {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = clampTtlMs(input.ttlMs);
  const filters = normalizeNarrativeFilters(input.filters);
  const pin = normalizeCanonicalLastTrustedSequence(
    input.canonicalLastTrustedSequence ?? null,
  );
  const claims: MatchNarrativeCursorClaims = {
    version: MATCH_READ_CURSOR_VERSION,
    purpose: MATCH_NARRATIVE_CURSOR_PURPOSE,
    keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    subjectUserId: input.subjectUserId,
    gameId: input.gameId,
    surface: input.surface,
    filterFingerprint: fingerprintMatchNarrativeFilters({
      preset: filters.preset,
      detail: filters.detail,
      playerId: filters.playerId,
      phase: filters.phase,
      round: filters.round,
      action: filters.action,
      fromTimestampMs: filters.fromTimestampMs,
      toTimestampMs: filters.toTimestampMs,
      schemaVersion: filters.schemaVersion,
      includeUnpaired: filters.includeUnpaired,
    }),
    ownershipFingerprint: input.ownershipFingerprint,
    transcriptCaptureVersion: input.transcriptCaptureVersion,
    cognitiveCaptureVersion: input.cognitiveCaptureVersion,
    mode: input.mode,
    readThrough: normalizeNarrativeDualReadThrough(input.readThrough),
    keyset: normalizeNarrativeKeyset(input.keyset),
    filters,
    canonicalLastTrustedSequence: pin,
  };

  return sealClaimsV2(claims, MATCH_NARRATIVE_CURSOR_PURPOSE, secretMaterial);
}

/**
 * Decode and validate a sealed transcript cursor without database access.
 * Accepts V2 (`mr2.`) and legacy V1 tokens. Returns uniform `invalid` for
 * every local failure mode.
 */
export function decodeMatchTranscriptCursor(
  token: string,
  options: {
    secretMaterial?: string;
    /** Expected purpose; defaults to match transcript. */
    purpose?: MatchTranscriptCursorPurpose;
    /** Active key version; mismatches are invalid (rotation). */
    activeKeyVersion?: number;
    nowMs?: number;
  } = {},
): MatchReadCursorDecodeResult {
  const expectedPurpose = options.purpose ?? MATCH_TRANSCRIPT_CURSOR_PURPOSE;
  const result = decodeSealedClaims(token, {
    secretMaterial: options.secretMaterial,
    purpose: expectedPurpose,
    activeKeyVersion: options.activeKeyVersion,
    nowMs: options.nowMs,
  });
  if (result.status !== "ok") return { status: "invalid" };
  if (!isTranscriptClaims(result.claims)) return { status: "invalid" };
  return { status: "ok", claims: result.claims };
}

/**
 * Decode and validate a sealed cognition cursor without database access.
 */
export function decodeMatchCognitionCursor(
  token: string,
  options: {
    secretMaterial?: string;
    purpose?: MatchCognitionCursorPurpose;
    activeKeyVersion?: number;
    nowMs?: number;
  } = {},
): MatchCognitionCursorDecodeResult {
  const expectedPurpose = options.purpose ?? MATCH_COGNITION_CURSOR_PURPOSE;
  const result = decodeSealedClaims(token, {
    secretMaterial: options.secretMaterial,
    purpose: expectedPurpose,
    activeKeyVersion: options.activeKeyVersion,
    nowMs: options.nowMs,
  });
  if (result.status !== "ok") return { status: "invalid" };
  if (!isCognitionClaims(result.claims)) return { status: "invalid" };
  return { status: "ok", claims: result.claims };
}

/**
 * Decode and validate a sealed narrative cursor without database access.
 */
export function decodeMatchNarrativeCursor(
  token: string,
  options: {
    secretMaterial?: string;
    purpose?: MatchNarrativeCursorPurpose;
    /** When set, claims.surface must match (cross-surface resume fails closed). */
    expectedSurface?: MatchNarrativeSurface;
    activeKeyVersion?: number;
    nowMs?: number;
  } = {},
): MatchNarrativeCursorDecodeResult {
  const expectedPurpose = options.purpose ?? MATCH_NARRATIVE_CURSOR_PURPOSE;
  const result = decodeSealedClaims(token, {
    secretMaterial: options.secretMaterial,
    purpose: expectedPurpose,
    activeKeyVersion: options.activeKeyVersion,
    nowMs: options.nowMs,
  });
  if (result.status !== "ok") return { status: "invalid" };
  if (!isNarrativeClaims(result.claims)) return { status: "invalid" };
  if (
    options.expectedSurface != null
    && result.claims.surface !== options.expectedSurface
  ) {
    return { status: "invalid" };
  }
  return { status: "ok", claims: result.claims };
}

/**
 * Validate that decoded transcript claims still match the live request binding.
 * Call after MatchAccessContext resolution; failures are authorization-stale
 * or query-mismatch and must surface as uniform cursor_invalid_or_stale.
 */
export function bindMatchTranscriptCursor(params: {
  claims: MatchTranscriptCursorClaims;
  subjectUserId: string;
  gameId: string;
  ownershipFingerprint: string;
  filterFingerprint: string;
  captureVersion: number;
}): boolean {
  return bindMatchReadCursorCommon({
    claims: params.claims,
    subjectUserId: params.subjectUserId,
    gameId: params.gameId,
    ownershipFingerprint: params.ownershipFingerprint,
    filterFingerprint: params.filterFingerprint,
    captureVersion: params.captureVersion,
  });
}

/**
 * Validate that decoded cognition claims still match the live request binding.
 */
export function bindMatchCognitionCursor(params: {
  claims: MatchCognitionCursorClaims;
  subjectUserId: string;
  gameId: string;
  ownershipFingerprint: string;
  filterFingerprint: string;
  captureVersion: number;
}): boolean {
  return bindMatchReadCursorCommon({
    claims: params.claims,
    subjectUserId: params.subjectUserId,
    gameId: params.gameId,
    ownershipFingerprint: params.ownershipFingerprint,
    filterFingerprint: params.filterFingerprint,
    captureVersion: params.captureVersion,
  });
}

/**
 * Validate that decoded narrative claims still match the live request binding.
 */
export function bindMatchNarrativeCursor(params: {
  claims: MatchNarrativeCursorClaims;
  subjectUserId: string;
  gameId: string;
  surface: MatchNarrativeSurface;
  ownershipFingerprint: string;
  filterFingerprint: string;
  transcriptCaptureVersion: number;
  cognitiveCaptureVersion: number;
}): boolean {
  const { claims } = params;
  return (
    equalUtf8(claims.subjectUserId, params.subjectUserId)
    && equalUtf8(claims.gameId, params.gameId)
    && claims.surface === params.surface
    && equalUtf8(claims.ownershipFingerprint, params.ownershipFingerprint)
    && equalUtf8(claims.filterFingerprint, params.filterFingerprint)
    && claims.transcriptCaptureVersion === params.transcriptCaptureVersion
    && claims.cognitiveCaptureVersion === params.cognitiveCaptureVersion
  );
}

// ---------------------------------------------------------------------------
// Internals — issue / decode routing
// ---------------------------------------------------------------------------

function clampTtlMs(ttlMs: number | undefined): number {
  return Math.min(
    Math.max(1, ttlMs ?? MATCH_READ_CURSOR_MAX_TTL_MS),
    MATCH_READ_CURSOR_MAX_TTL_MS,
  );
}

function bindMatchReadCursorCommon(params: {
  claims: {
    subjectUserId: string;
    gameId: string;
    ownershipFingerprint: string;
    filterFingerprint: string;
    captureVersion: number;
  };
  subjectUserId: string;
  gameId: string;
  ownershipFingerprint: string;
  filterFingerprint: string;
  captureVersion: number;
}): boolean {
  const { claims } = params;
  return (
    equalUtf8(claims.subjectUserId, params.subjectUserId)
    && equalUtf8(claims.gameId, params.gameId)
    && equalUtf8(claims.ownershipFingerprint, params.ownershipFingerprint)
    && equalUtf8(claims.filterFingerprint, params.filterFingerprint)
    && claims.captureVersion === params.captureVersion
  );
}

function sealClaimsV2(
  claims:
    | MatchTranscriptCursorClaims
    | MatchCognitionCursorClaims
    | MatchNarrativeCursorClaims,
  purpose: MatchReadCursorPurpose,
  secretMaterial: string,
): string {
  try {
    const keyVersion = claims.keyVersion;
    if (
      !Number.isInteger(keyVersion)
      || keyVersion < 1
      || keyVersion > 255
    ) {
      throw new MatchReadCursorError(
        "encode_failed",
        "keyVersion must be an integer in 1..255",
      );
    }
    const purposeCode = PURPOSE_CODE[purpose];
    const header = Buffer.alloc(HEADER_BYTES);
    header[0] = MATCH_READ_CURSOR_VERSION;
    header[1] = keyVersion;
    header[2] = purposeCode;

    const payload = encodeClaimsTuple(claims, purpose);
    const plaintext = Buffer.from(msgpackEncode(payload));

    const key = deriveActiveKeyV2(secretMaterial, keyVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope = Buffer.concat([header, iv, ciphertext, tag]);
    return MATCH_READ_CURSOR_V2_PREFIX + envelope.toString("base64url");
  } catch (error) {
    throw new MatchReadCursorError(
      "encode_failed",
      error instanceof Error ? error.message : "Failed to seal match read cursor",
    );
  }
}

/**
 * Legacy V1 sealer — test fixtures only. Issues pre-V2 JSON envelopes so the
 * compatibility decoder can be exercised with known secrets.
 *
 * @internal
 */
export function issueLegacyMatchReadCursorV1ForTests(
  claims:
    | MatchTranscriptCursorClaims
    | MatchCognitionCursorClaims
    | MatchNarrativeCursorClaims,
  purpose: MatchReadCursorPurpose,
  secretMaterial: string,
): string {
  // V1 claim shape required nonce + purpose/version/kv inside ciphertext.
  const v1Claims: Record<string, unknown> = {
    ...claims,
    version: MATCH_READ_CURSOR_VERSION_V1,
    purpose,
    keyVersion: claims.keyVersion,
    nonce: randomBytes(16).toString("hex"),
  };
  // V1 narrative filters omitted schemaVersion/includeUnpaired.
  if (purpose === MATCH_NARRATIVE_CURSOR_PURPOSE && isRecord(v1Claims.filters)) {
    const { schemaVersion: _sv, includeUnpaired: _iu, ...rest } = v1Claims.filters as {
      schemaVersion?: unknown;
      includeUnpaired?: unknown;
      [key: string]: unknown;
    };
    v1Claims.filters = rest;
    // V1 fingerprint domain (no schema/includeUnpaired).
    v1Claims.filterFingerprint = sha256StableJson({
      domain: "influence.match.narrative.filters.v1",
      preset: rest.preset,
      detail: rest.detail,
      playerId: rest.playerId,
      phase: rest.phase,
      round: rest.round,
      action: rest.action,
      fromTimestampMs: rest.fromTimestampMs,
      toTimestampMs: rest.toTimestampMs,
    });
  }

  try {
    const key = deriveActiveKeyV1(secretMaterial, claims.keyVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    cipher.setAAD(aadBytesV1(MATCH_READ_CURSOR_VERSION_V1, claims.keyVersion, purpose));
    const plaintext = Buffer.from(JSON.stringify(v1Claims), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = {
      v: MATCH_READ_CURSOR_VERSION_V1,
      kv: claims.keyVersion,
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url"),
      ct: ciphertext.toString("base64url"),
    };
    return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  } catch (error) {
    throw new MatchReadCursorError(
      "encode_failed",
      error instanceof Error ? error.message : "Failed to seal legacy match read cursor",
    );
  }
}

function decodeSealedClaims(
  token: string,
  options: {
    secretMaterial?: string;
    purpose: MatchReadCursorPurpose;
    activeKeyVersion?: number;
    nowMs?: number;
  },
): { status: "ok"; claims: unknown } | { status: "invalid" } {
  if (typeof token !== "string" || token.length === 0) {
    return { status: "invalid" };
  }

  if (token.startsWith(MATCH_READ_CURSOR_V2_PREFIX)) {
    if (token.length > MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V2) {
      return { status: "invalid" };
    }
    return decodeSealedClaimsV2(token, options);
  }

  if (token.length > MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V1) {
    return { status: "invalid" };
  }
  return decodeSealedClaimsV1(token, options);
}

function decodeSealedClaimsV2(
  token: string,
  options: {
    secretMaterial?: string;
    purpose: MatchReadCursorPurpose;
    activeKeyVersion?: number;
    nowMs?: number;
  },
): { status: "ok"; claims: unknown } | { status: "invalid" } {
  let secret: string;
  try {
    secret = options.secretMaterial ?? requireApiSecret();
  } catch {
    return { status: "invalid" };
  }

  const expectedPurpose = options.purpose;
  const activeKeyVersion = options.activeKeyVersion ?? MATCH_READ_CURSOR_KEY_VERSION;
  const nowMs = options.nowMs ?? Date.now();

  let envelope: Buffer;
  try {
    envelope = Buffer.from(token.slice(MATCH_READ_CURSOR_V2_PREFIX.length), "base64url");
  } catch {
    return { status: "invalid" };
  }

  const minLen = HEADER_BYTES + IV_BYTES + 1 + AUTH_TAG_BYTES;
  if (envelope.length < minLen) return { status: "invalid" };

  const formatVersion = envelope[0];
  const keyVersion = envelope[1];
  const purposeCode = envelope[2];
  if (formatVersion === undefined || keyVersion === undefined || purposeCode === undefined) {
    return { status: "invalid" };
  }
  if (formatVersion !== MATCH_READ_CURSOR_VERSION) return { status: "invalid" };
  if (keyVersion !== activeKeyVersion) return { status: "invalid" };

  const purposeFromHeader = PURPOSE_FROM_CODE.get(purposeCode);
  if (purposeFromHeader == null || purposeFromHeader !== expectedPurpose) {
    return { status: "invalid" };
  }

  const header = envelope.subarray(0, HEADER_BYTES);
  const iv = envelope.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  const tag = envelope.subarray(envelope.length - AUTH_TAG_BYTES);
  const ciphertext = envelope.subarray(HEADER_BYTES + IV_BYTES, envelope.length - AUTH_TAG_BYTES);
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    return { status: "invalid" };
  }

  let plaintext: Buffer;
  try {
    const key = deriveActiveKeyV2(secret, keyVersion);
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return { status: "invalid" };
  }

  let decoded: unknown;
  try {
    decoded = msgpackDecode(plaintext);
  } catch {
    return { status: "invalid" };
  }

  const claims = claimsFromTuple(decoded, expectedPurpose, keyVersion, nowMs);
  if (claims == null) return { status: "invalid" };
  return { status: "ok", claims };
}

function decodeSealedClaimsV1(
  token: string,
  options: {
    secretMaterial?: string;
    purpose: MatchReadCursorPurpose;
    activeKeyVersion?: number;
    nowMs?: number;
  },
): { status: "ok"; claims: unknown } | { status: "invalid" } {
  let secret: string;
  try {
    secret = options.secretMaterial ?? requireApiSecret();
  } catch {
    return { status: "invalid" };
  }

  const expectedPurpose = options.purpose;
  const activeKeyVersion = options.activeKeyVersion ?? MATCH_READ_CURSOR_KEY_VERSION;
  const nowMs = options.nowMs ?? Date.now();

  let envelope: {
    v: number;
    kv: number;
    iv: string;
    tag: string;
    ct: string;
  };
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    );
    if (!isEnvelopeV1(parsed)) return { status: "invalid" };
    envelope = parsed;
  } catch {
    return { status: "invalid" };
  }

  if (envelope.v !== MATCH_READ_CURSOR_VERSION_V1) return { status: "invalid" };
  if (envelope.kv !== activeKeyVersion) return { status: "invalid" };

  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(envelope.iv, "base64url");
    tag = Buffer.from(envelope.tag, "base64url");
    ciphertext = Buffer.from(envelope.ct, "base64url");
  } catch {
    return { status: "invalid" };
  }
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    return { status: "invalid" };
  }

  let plaintext: string;
  try {
    const key = deriveActiveKeyV1(secret, envelope.kv);
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAAD(aadBytesV1(envelope.v, envelope.kv, expectedPurpose));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return { status: "invalid" };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(plaintext);
  } catch {
    return { status: "invalid" };
  }

  if (!claims || typeof claims !== "object") return { status: "invalid" };
  const record = claims as Record<string, unknown>;
  if (record.version !== MATCH_READ_CURSOR_VERSION_V1) return { status: "invalid" };
  if (record.purpose !== expectedPurpose) return { status: "invalid" };
  if (typeof record.keyVersion !== "number" || record.keyVersion !== activeKeyVersion) {
    return { status: "invalid" };
  }
  if (!validateTimeWindow(record.issuedAtMs, record.expiresAtMs, nowMs)) {
    return { status: "invalid" };
  }

  // Normalize V1 narrative filters to include schemaVersion/includeUnpaired defaults
  // without recomputing the sealed filterFingerprint (V1 domain).
  if (expectedPurpose === MATCH_NARRATIVE_CURSOR_PURPOSE && isRecord(record.filters)) {
    const filters = record.filters;
    if (filters.schemaVersion === undefined) filters.schemaVersion = 2;
    if (filters.includeUnpaired === undefined) filters.includeUnpaired = false;
  }
  // Legacy V1 narrative cursors have no canonical pin — preserve unlinked walks.
  if (
    expectedPurpose === MATCH_NARRATIVE_CURSOR_PURPOSE
    && record.canonicalLastTrustedSequence === undefined
  ) {
    record.canonicalLastTrustedSequence = null;
  }

  // V1 narrative keysets sealed joined member ids; live pages now use digests.
  // Migrate so exclusive continuation stays in the same string space as sort/keyset.
  if (
    expectedPurpose === MATCH_NARRATIVE_CURSOR_PURPOSE
    && isRecord(record.keyset)
    && typeof record.keyset.afterGroupId === "string"
  ) {
    record.keyset.afterGroupId = migrateV1NarrativeGroupKey(record.keyset.afterGroupId);
  }

  return { status: "ok", claims };
}

/**
 * Convert a legacy V1 afterGroupId (joined member ids or single id) into the
 * fixed-size digest used by V2 keyset + equal-sort-key ordering.
 */
function migrateV1NarrativeGroupKey(afterGroupId: string): string {
  if (afterGroupId.includes("|")) {
    return digestNarrativeGroupMembers(afterGroupId.split("|"));
  }
  return digestNarrativeGroupMembers([afterGroupId]);
}

// ---------------------------------------------------------------------------
// MessagePack positional tuples
// ---------------------------------------------------------------------------

type MsgpackValue = null | boolean | number | string | MsgpackValue[];

function encodeClaimsTuple(
  claims:
    | MatchTranscriptCursorClaims
    | MatchCognitionCursorClaims
    | MatchNarrativeCursorClaims,
  purpose: MatchReadCursorPurpose,
): MsgpackValue[] {
  if (purpose === MATCH_TRANSCRIPT_CURSOR_PURPOSE) {
    const c = claims as MatchTranscriptCursorClaims;
    return [
      c.issuedAtMs,
      c.expiresAtMs,
      c.subjectUserId,
      c.gameId,
      c.ownershipFingerprint,
      c.captureVersion,
      c.mode === "catchup" ? MODE_CATCHUP : MODE_SNAPSHOT,
      encodeTranscriptReadThrough(c.readThrough),
      encodeTranscriptKeyset(c.keyset),
      encodeTranscriptFilters(c.filters),
    ];
  }
  if (purpose === MATCH_COGNITION_CURSOR_PURPOSE) {
    const c = claims as MatchCognitionCursorClaims;
    return [
      c.issuedAtMs,
      c.expiresAtMs,
      c.subjectUserId,
      c.gameId,
      c.ownershipFingerprint,
      c.captureVersion,
      c.mode === "catchup" ? MODE_CATCHUP : MODE_SNAPSHOT,
      encodeCognitionReadThrough(c.readThrough),
      encodeCognitionKeyset(c.keyset),
      encodeCognitionFilters(c.filters),
    ];
  }
  const c = claims as MatchNarrativeCursorClaims;
  // Length 12 = legacy unlinked walk (no pin). Length 13 seals the pin so
  // continuations freeze the trusted event prefix used for vote.cast linkage.
  const base: MsgpackValue[] = [
    c.issuedAtMs,
    c.expiresAtMs,
    c.subjectUserId,
    c.gameId,
    c.ownershipFingerprint,
    c.surface === "producer" ? SURFACE_PRODUCER : SURFACE_OWNER,
    c.transcriptCaptureVersion,
    c.cognitiveCaptureVersion,
    MODE_SNAPSHOT,
    [
      encodeTranscriptReadThrough(c.readThrough.transcript),
      encodeCognitionReadThrough(c.readThrough.cognition),
    ],
    encodeNarrativeKeyset(c.keyset),
    encodeNarrativeFilters(c.filters),
  ];
  if (c.canonicalLastTrustedSequence !== null) {
    base.push(c.canonicalLastTrustedSequence);
  }
  return base;
}

function claimsFromTuple(
  value: unknown,
  purpose: MatchReadCursorPurpose,
  keyVersion: number,
  nowMs: number,
):
  | MatchTranscriptCursorClaims
  | MatchCognitionCursorClaims
  | MatchNarrativeCursorClaims
  | null {
  if (!Array.isArray(value)) return null;

  if (purpose === MATCH_TRANSCRIPT_CURSOR_PURPOSE) {
    if (value.length !== 10) return null;
    const issuedAtMs = value[0];
    const expiresAtMs = value[1];
    if (!validateTimeWindow(issuedAtMs, expiresAtMs, nowMs)) return null;
    if (typeof value[2] !== "string" || value[2].length === 0) return null;
    if (typeof value[3] !== "string" || value[3].length === 0) return null;
    if (typeof value[4] !== "string") return null;
    if (typeof value[5] !== "number" || !Number.isInteger(value[5])) return null;
    const mode = decodeMode(value[6]);
    if (mode == null) return null;
    const readThrough = decodeTranscriptReadThrough(value[7]);
    const keyset = decodeTranscriptKeyset(value[8]);
    const filters = decodeTranscriptFilters(value[9]);
    if (!readThrough || !keyset || !filters) return null;
    return {
      version: MATCH_READ_CURSOR_VERSION,
      purpose: MATCH_TRANSCRIPT_CURSOR_PURPOSE,
      keyVersion,
      issuedAtMs,
      expiresAtMs,
      subjectUserId: value[2],
      gameId: value[3],
      ownershipFingerprint: value[4],
      captureVersion: value[5],
      mode,
      readThrough,
      keyset,
      filters,
      filterFingerprint: fingerprintMatchTranscriptFilters({
        phase: filters.phase,
        round: filters.round,
        scope: filters.scope,
        playerId: filters.playerId,
        fromTimestampMs: filters.fromTimestampMs,
        toTimestampMs: filters.toTimestampMs,
      }),
    };
  }

  if (purpose === MATCH_COGNITION_CURSOR_PURPOSE) {
    if (value.length !== 10) return null;
    const issuedAtMs = value[0];
    const expiresAtMs = value[1];
    if (!validateTimeWindow(issuedAtMs, expiresAtMs, nowMs)) return null;
    if (typeof value[2] !== "string" || value[2].length === 0) return null;
    if (typeof value[3] !== "string" || value[3].length === 0) return null;
    if (typeof value[4] !== "string") return null;
    if (typeof value[5] !== "number" || !Number.isInteger(value[5])) return null;
    const mode = decodeMode(value[6]);
    if (mode == null) return null;
    const readThrough = decodeCognitionReadThrough(value[7]);
    const keyset = decodeCognitionKeyset(value[8]);
    const filters = decodeCognitionFilters(value[9]);
    if (!readThrough || !keyset || !filters) return null;
    return {
      version: MATCH_READ_CURSOR_VERSION,
      purpose: MATCH_COGNITION_CURSOR_PURPOSE,
      keyVersion,
      issuedAtMs,
      expiresAtMs,
      subjectUserId: value[2],
      gameId: value[3],
      ownershipFingerprint: value[4],
      captureVersion: value[5],
      mode,
      readThrough,
      keyset,
      filters,
      filterFingerprint: fingerprintMatchCognitionFilters({
        artifactType: filters.artifactType,
        actorPlayerId: filters.actorPlayerId,
        phase: filters.phase,
        round: filters.round,
        action: filters.action,
      }),
    };
  }

  // Narrative: length 12 = legacy (no pin → null); length 13 = pin present.
  if (value.length !== 12 && value.length !== 13) return null;
  const issuedAtMs = value[0];
  const expiresAtMs = value[1];
  if (!validateTimeWindow(issuedAtMs, expiresAtMs, nowMs)) return null;
  if (typeof value[2] !== "string" || value[2].length === 0) return null;
  if (typeof value[3] !== "string" || value[3].length === 0) return null;
  if (typeof value[4] !== "string") return null;
  const surface = decodeSurface(value[5]);
  if (surface == null) return null;
  if (typeof value[6] !== "number" || !Number.isInteger(value[6])) return null;
  if (typeof value[7] !== "number" || !Number.isInteger(value[7])) return null;
  if (value[8] !== MODE_SNAPSHOT) return null;
  if (!Array.isArray(value[9]) || value[9].length !== 2) return null;
  const transcriptRt = decodeTranscriptReadThrough(value[9][0]);
  const cognitionRt = decodeCognitionReadThrough(value[9][1]);
  const keyset = decodeNarrativeKeyset(value[10]);
  const filters = decodeNarrativeFilters(value[11]);
  if (!transcriptRt || !cognitionRt || !keyset || !filters) return null;
  let canonicalLastTrustedSequence: number | null = null;
  if (value.length === 13) {
    const pin = value[12];
    if (typeof pin !== "number" || !Number.isInteger(pin) || pin < 0) return null;
    canonicalLastTrustedSequence = pin;
  }
  return {
    version: MATCH_READ_CURSOR_VERSION,
    purpose: MATCH_NARRATIVE_CURSOR_PURPOSE,
    keyVersion,
    issuedAtMs,
    expiresAtMs,
    subjectUserId: value[2],
    gameId: value[3],
    ownershipFingerprint: value[4],
    surface,
    transcriptCaptureVersion: value[6],
    cognitiveCaptureVersion: value[7],
    mode: "snapshot",
    readThrough: { transcript: transcriptRt, cognition: cognitionRt },
    keyset,
    filters,
    canonicalLastTrustedSequence,
    filterFingerprint: fingerprintMatchNarrativeFilters({
      preset: filters.preset,
      detail: filters.detail,
      playerId: filters.playerId,
      phase: filters.phase,
      round: filters.round,
      action: filters.action,
      fromTimestampMs: filters.fromTimestampMs,
      toTimestampMs: filters.toTimestampMs,
      schemaVersion: filters.schemaVersion,
      includeUnpaired: filters.includeUnpaired,
    }),
  };
}

function encodeTranscriptReadThrough(rt: MatchReadThroughBoundary): MsgpackValue[] {
  return [rt.throughEntrySequence, rt.throughLegacyTimestamp, rt.throughLegacyId];
}

function encodeTranscriptKeyset(ks: MatchReadKeyset): MsgpackValue[] {
  return [ks.afterEntrySequence, ks.afterLegacyTimestamp, ks.afterLegacyId];
}

function encodeTranscriptFilters(f: MatchTranscriptCursorFilters): MsgpackValue[] {
  return [
    f.phase,
    f.round,
    f.scope,
    f.playerId,
    f.player,
    f.fromTimestampMs,
    f.toTimestampMs,
  ];
}

function encodeCognitionReadThrough(rt: MatchCognitionReadThroughBoundary): MsgpackValue[] {
  return [rt.throughCreatedAt, rt.throughId];
}

function encodeCognitionKeyset(ks: MatchCognitionKeyset): MsgpackValue[] {
  return [ks.afterCreatedAt, ks.afterId];
}

function encodeCognitionFilters(f: MatchCognitionCursorFilters): MsgpackValue[] {
  let artifactCode: number | null = null;
  if (f.artifactType === "thinking") artifactCode = ARTIFACT_THINKING;
  else if (f.artifactType === "strategy") artifactCode = ARTIFACT_STRATEGY;
  return [
    artifactCode,
    f.actorPlayerId,
    f.player,
    f.phase,
    f.round,
    f.action,
  ];
}

function normalizeCanonicalLastTrustedSequence(
  value: number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function encodeNarrativeKeyset(ks: MatchNarrativeKeyset): MsgpackValue[] {
  return [ks.afterSortKey, ks.afterGroupId];
}

function encodeNarrativeFilters(f: MatchNarrativeCursorFilters): MsgpackValue[] {
  let presetCode = PRESET_STRATEGIC;
  if (f.preset === "dialogue_only") presetCode = PRESET_DIALOGUE_ONLY;
  else if (f.preset === "full_cognition") presetCode = PRESET_FULL_COGNITION;
  const detailCode = f.detail === "full" ? DETAIL_FULL : DETAIL_COMPACT;
  return [
    presetCode,
    detailCode,
    f.playerId,
    f.player,
    f.phase,
    f.round,
    f.action,
    f.fromTimestampMs,
    f.toTimestampMs,
    f.schemaVersion,
    f.includeUnpaired,
  ];
}

function decodeTranscriptReadThrough(value: unknown): MatchReadThroughBoundary | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!isNullOrInt(value[0]) || !isNullOrInt(value[1]) || !isNullOrInt(value[2])) return null;
  return {
    throughEntrySequence: value[0],
    throughLegacyTimestamp: value[1],
    throughLegacyId: value[2],
  };
}

function decodeTranscriptKeyset(value: unknown): MatchReadKeyset | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!isNullOrInt(value[0]) || !isNullOrInt(value[1]) || !isNullOrInt(value[2])) return null;
  return {
    afterEntrySequence: value[0],
    afterLegacyTimestamp: value[1],
    afterLegacyId: value[2],
  };
}

function decodeTranscriptFilters(value: unknown): MatchTranscriptCursorFilters | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  if (
    !isNullOrString(value[0])
    || !isNullOrInt(value[1])
    || !isNullOrString(value[2])
    || !isNullOrString(value[3])
    || !isNullOrString(value[4])
    || !isNullOrInt(value[5])
    || !isNullOrInt(value[6])
  ) {
    return null;
  }
  return {
    phase: value[0],
    round: value[1],
    scope: value[2],
    playerId: value[3],
    player: value[4],
    fromTimestampMs: value[5],
    toTimestampMs: value[6],
  };
}

function decodeCognitionReadThrough(value: unknown): MatchCognitionReadThroughBoundary | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!isNullOrString(value[0]) || !isNullOrString(value[1])) return null;
  return { throughCreatedAt: value[0], throughId: value[1] };
}

function decodeCognitionKeyset(value: unknown): MatchCognitionKeyset | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!isNullOrString(value[0]) || !isNullOrString(value[1])) return null;
  return { afterCreatedAt: value[0], afterId: value[1] };
}

function decodeCognitionFilters(value: unknown): MatchCognitionCursorFilters | null {
  if (!Array.isArray(value) || value.length !== 6) return null;
  const artifactRaw = value[0];
  let artifactType: "thinking" | "strategy" | null = null;
  if (artifactRaw === null) artifactType = null;
  else if (artifactRaw === ARTIFACT_THINKING) artifactType = "thinking";
  else if (artifactRaw === ARTIFACT_STRATEGY) artifactType = "strategy";
  else return null;
  if (
    !isNullOrString(value[1])
    || !isNullOrString(value[2])
    || !isNullOrString(value[3])
    || !isNullOrInt(value[4])
    || !isNullOrString(value[5])
  ) {
    return null;
  }
  return {
    artifactType,
    actorPlayerId: value[1],
    player: value[2],
    phase: value[3],
    round: value[4],
    action: value[5],
  };
}

function decodeNarrativeKeyset(value: unknown): MatchNarrativeKeyset | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!isNullOrInt(value[0]) || !isNullOrString(value[1])) return null;
  return { afterSortKey: value[0], afterGroupId: value[1] };
}

function decodeNarrativeFilters(value: unknown): MatchNarrativeCursorFilters | null {
  if (!Array.isArray(value) || value.length !== 11) return null;
  const preset = decodePreset(value[0]);
  const detail = decodeDetail(value[1]);
  if (preset == null || detail == null) return null;
  if (
    !isNullOrString(value[2])
    || !isNullOrString(value[3])
    || !isNullOrString(value[4])
    || !isNullOrInt(value[5])
    || !isNullOrString(value[6])
    || !isNullOrInt(value[7])
    || !isNullOrInt(value[8])
  ) {
    return null;
  }
  if (value[9] !== 1 && value[9] !== 2) return null;
  if (typeof value[10] !== "boolean") return null;
  return {
    preset,
    detail,
    playerId: value[2],
    player: value[3],
    phase: value[4],
    round: value[5],
    action: value[6],
    fromTimestampMs: value[7],
    toTimestampMs: value[8],
    schemaVersion: value[9],
    includeUnpaired: value[10],
  };
}

function decodeMode(value: unknown): "snapshot" | "catchup" | null {
  if (value === MODE_SNAPSHOT) return "snapshot";
  if (value === MODE_CATCHUP) return "catchup";
  return null;
}

function decodeSurface(value: unknown): MatchNarrativeSurface | null {
  if (value === SURFACE_OWNER) return "subject_owner";
  if (value === SURFACE_PRODUCER) return "producer";
  return null;
}

function decodePreset(
  value: unknown,
): "strategic" | "dialogue_only" | "full_cognition" | null {
  if (value === PRESET_STRATEGIC) return "strategic";
  if (value === PRESET_DIALOGUE_ONLY) return "dialogue_only";
  if (value === PRESET_FULL_COGNITION) return "full_cognition";
  return null;
}

function decodeDetail(value: unknown): "compact" | "full" | null {
  if (value === DETAIL_COMPACT) return "compact";
  if (value === DETAIL_FULL) return "full";
  return null;
}

// ---------------------------------------------------------------------------
// Normalization + validation helpers
// ---------------------------------------------------------------------------

function normalizeTranscriptFilters(
  filters: MatchTranscriptCursorFilters,
): MatchTranscriptCursorFilters {
  return {
    phase: filters.phase,
    round: filters.round,
    scope: filters.scope,
    playerId: filters.playerId,
    player: filters.player,
    fromTimestampMs: filters.fromTimestampMs,
    toTimestampMs: filters.toTimestampMs,
  };
}

function normalizeCognitionFilters(
  filters: MatchCognitionCursorFilters,
): MatchCognitionCursorFilters {
  return {
    artifactType: filters.artifactType,
    actorPlayerId: filters.actorPlayerId,
    player: filters.player,
    phase: filters.phase,
    round: filters.round,
    action: filters.action,
  };
}

function normalizeNarrativeFilters(
  filters: MatchNarrativeCursorFilters,
): MatchNarrativeCursorFilters {
  return {
    preset: filters.preset,
    detail: filters.detail,
    playerId: filters.playerId,
    player: filters.player,
    phase: filters.phase,
    round: filters.round,
    action: filters.action,
    fromTimestampMs: filters.fromTimestampMs,
    toTimestampMs: filters.toTimestampMs,
    schemaVersion: filters.schemaVersion,
    includeUnpaired: filters.includeUnpaired,
  };
}

function normalizeTranscriptReadThrough(
  rt: MatchReadThroughBoundary,
): MatchReadThroughBoundary {
  return {
    throughEntrySequence: rt.throughEntrySequence,
    throughLegacyTimestamp: rt.throughLegacyTimestamp,
    throughLegacyId: rt.throughLegacyId,
  };
}

function normalizeCognitionReadThrough(
  rt: MatchCognitionReadThroughBoundary,
): MatchCognitionReadThroughBoundary {
  return {
    throughCreatedAt: rt.throughCreatedAt,
    throughId: rt.throughId,
  };
}

function normalizeTranscriptKeyset(ks: MatchReadKeyset): MatchReadKeyset {
  return {
    afterEntrySequence: ks.afterEntrySequence,
    afterLegacyTimestamp: ks.afterLegacyTimestamp,
    afterLegacyId: ks.afterLegacyId,
  };
}

function normalizeCognitionKeyset(ks: MatchCognitionKeyset): MatchCognitionKeyset {
  return {
    afterCreatedAt: ks.afterCreatedAt,
    afterId: ks.afterId,
  };
}

function normalizeNarrativeDualReadThrough(
  rt: MatchNarrativeDualReadThrough,
): MatchNarrativeDualReadThrough {
  return {
    transcript: normalizeTranscriptReadThrough(rt.transcript),
    cognition: normalizeCognitionReadThrough(rt.cognition),
  };
}

function normalizeNarrativeKeyset(ks: MatchNarrativeKeyset): MatchNarrativeKeyset {
  return {
    afterSortKey: ks.afterSortKey,
    afterGroupId: ks.afterGroupId,
  };
}

function validateTimeWindow(
  issuedAtMs: unknown,
  expiresAtMs: unknown,
  nowMs: number,
): issuedAtMs is number {
  if (typeof issuedAtMs !== "number" || !Number.isFinite(issuedAtMs)) return false;
  if (typeof expiresAtMs !== "number" || !Number.isFinite(expiresAtMs)) return false;
  if (expiresAtMs < nowMs) return false;
  if (issuedAtMs > nowMs + 60_000) return false;
  if (expiresAtMs - issuedAtMs > MATCH_READ_CURSOR_MAX_TTL_MS) return false;
  return true;
}

function deriveActiveKeyV2(secretMaterial: string, keyVersion: number): Buffer {
  return createHash("sha256")
    .update(KEY_DOMAIN_V2)
    .update("\0")
    .update(String(keyVersion))
    .update("\0")
    .update(secretMaterial)
    .digest();
}

function deriveActiveKeyV1(secretMaterial: string, keyVersion: number): Buffer {
  return createHash("sha256")
    .update(KEY_DOMAIN_V1)
    .update("\0")
    .update(String(keyVersion))
    .update("\0")
    .update(secretMaterial)
    .digest();
}

function aadBytesV1(version: number, keyVersion: number, purpose: string): Buffer {
  return Buffer.from(`${version}:${keyVersion}:${purpose}`, "utf8");
}

function requireApiSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 8) {
    throw new MatchReadCursorError(
      "missing_secret",
      "JWT_SECRET must be set for match read cursors",
    );
  }
  return secret;
}

function isEnvelopeV1(value: unknown): value is {
  v: number;
  kv: number;
  iv: string;
  tag: string;
  ct: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.v === "number"
    && typeof record.kv === "number"
    && typeof record.iv === "string"
    && typeof record.tag === "string"
    && typeof record.ct === "string"
  );
}

function isTranscriptClaims(value: unknown): value is MatchTranscriptCursorClaims {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== MATCH_READ_CURSOR_VERSION
    && record.version !== MATCH_READ_CURSOR_VERSION_V1
  ) {
    return false;
  }
  if (record.purpose !== MATCH_TRANSCRIPT_CURSOR_PURPOSE) return false;
  if (typeof record.keyVersion !== "number") return false;
  if (typeof record.issuedAtMs !== "number" || !Number.isFinite(record.issuedAtMs)) return false;
  if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) return false;
  if (typeof record.subjectUserId !== "string" || record.subjectUserId.length === 0) return false;
  if (typeof record.gameId !== "string" || record.gameId.length === 0) return false;
  if (typeof record.filterFingerprint !== "string") return false;
  if (typeof record.ownershipFingerprint !== "string") return false;
  if (typeof record.captureVersion !== "number" || !Number.isInteger(record.captureVersion)) {
    return false;
  }
  if (record.mode !== "snapshot" && record.mode !== "catchup") return false;
  if (!isTranscriptReadThrough(record.readThrough)) return false;
  if (!isTranscriptKeyset(record.keyset)) return false;
  if (!isTranscriptFilters(record.filters)) return false;
  return true;
}

function isCognitionClaims(value: unknown): value is MatchCognitionCursorClaims {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== MATCH_READ_CURSOR_VERSION
    && record.version !== MATCH_READ_CURSOR_VERSION_V1
  ) {
    return false;
  }
  if (record.purpose !== MATCH_COGNITION_CURSOR_PURPOSE) return false;
  if (typeof record.keyVersion !== "number") return false;
  if (typeof record.issuedAtMs !== "number" || !Number.isFinite(record.issuedAtMs)) return false;
  if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) return false;
  if (typeof record.subjectUserId !== "string" || record.subjectUserId.length === 0) return false;
  if (typeof record.gameId !== "string" || record.gameId.length === 0) return false;
  if (typeof record.filterFingerprint !== "string") return false;
  if (typeof record.ownershipFingerprint !== "string") return false;
  if (typeof record.captureVersion !== "number" || !Number.isInteger(record.captureVersion)) {
    return false;
  }
  if (record.mode !== "snapshot" && record.mode !== "catchup") return false;
  if (!isCognitionReadThrough(record.readThrough)) return false;
  if (!isCognitionKeyset(record.keyset)) return false;
  if (!isCognitionFilters(record.filters)) return false;
  return true;
}

function isNarrativeClaims(value: unknown): value is MatchNarrativeCursorClaims {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== MATCH_READ_CURSOR_VERSION
    && record.version !== MATCH_READ_CURSOR_VERSION_V1
  ) {
    return false;
  }
  if (record.purpose !== MATCH_NARRATIVE_CURSOR_PURPOSE) return false;
  if (typeof record.keyVersion !== "number") return false;
  if (typeof record.issuedAtMs !== "number" || !Number.isFinite(record.issuedAtMs)) return false;
  if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) return false;
  if (typeof record.subjectUserId !== "string" || record.subjectUserId.length === 0) return false;
  if (typeof record.gameId !== "string" || record.gameId.length === 0) return false;
  if (record.surface !== "subject_owner" && record.surface !== "producer") return false;
  if (typeof record.filterFingerprint !== "string") return false;
  if (typeof record.ownershipFingerprint !== "string") return false;
  if (
    typeof record.transcriptCaptureVersion !== "number"
    || !Number.isInteger(record.transcriptCaptureVersion)
  ) {
    return false;
  }
  if (
    typeof record.cognitiveCaptureVersion !== "number"
    || !Number.isInteger(record.cognitiveCaptureVersion)
  ) {
    return false;
  }
  if (record.mode !== "snapshot") return false;
  if (!isNarrativeDualReadThrough(record.readThrough)) return false;
  if (!isNarrativeKeyset(record.keyset)) return false;
  if (!isNarrativeFilters(record.filters)) return false;
  // Legacy V1/decoded claims may omit the pin; treat as null (unlinked walk).
  if (
    record.canonicalLastTrustedSequence !== undefined
    && record.canonicalLastTrustedSequence !== null
    && (
      typeof record.canonicalLastTrustedSequence !== "number"
      || !Number.isInteger(record.canonicalLastTrustedSequence)
      || record.canonicalLastTrustedSequence < 0
    )
  ) {
    return false;
  }
  return true;
}

function isTranscriptFilters(value: unknown): value is MatchTranscriptCursorFilters {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isNullOrString(record.phase)
    && isNullOrInt(record.round)
    && isNullOrString(record.scope)
    && isNullOrString(record.playerId)
    && isNullOrString(record.player)
    && isNullOrInt(record.fromTimestampMs)
    && isNullOrInt(record.toTimestampMs)
  );
}

function isCognitionFilters(value: unknown): value is MatchCognitionCursorFilters {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const artifactType = record.artifactType;
  const artifactTypeOk = artifactType === null
    || artifactType === "thinking"
    || artifactType === "strategy";
  return (
    artifactTypeOk
    && isNullOrString(record.actorPlayerId)
    && isNullOrString(record.player)
    && isNullOrString(record.phase)
    && isNullOrInt(record.round)
    && isNullOrString(record.action)
  );
}

function isNarrativeFilters(value: unknown): value is MatchNarrativeCursorFilters {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const presetOk = record.preset === "strategic"
    || record.preset === "dialogue_only"
    || record.preset === "full_cognition";
  const detailOk = record.detail === "compact" || record.detail === "full";
  const schemaOk = record.schemaVersion === 1 || record.schemaVersion === 2;
  return (
    presetOk
    && detailOk
    && schemaOk
    && typeof record.includeUnpaired === "boolean"
    && isNullOrString(record.playerId)
    && isNullOrString(record.player)
    && isNullOrString(record.phase)
    && isNullOrInt(record.round)
    && isNullOrString(record.action)
    && isNullOrInt(record.fromTimestampMs)
    && isNullOrInt(record.toTimestampMs)
  );
}

function isNullOrString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTranscriptReadThrough(value: unknown): value is MatchReadThroughBoundary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isNullOrInt(record.throughEntrySequence)
    && isNullOrInt(record.throughLegacyTimestamp)
    && isNullOrInt(record.throughLegacyId)
  );
}

function isCognitionReadThrough(value: unknown): value is MatchCognitionReadThroughBoundary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isNullOrString(record.throughCreatedAt) && isNullOrString(record.throughId);
}

function isTranscriptKeyset(value: unknown): value is MatchReadKeyset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isNullOrInt(record.afterEntrySequence)
    && isNullOrInt(record.afterLegacyTimestamp)
    && isNullOrInt(record.afterLegacyId)
  );
}

function isCognitionKeyset(value: unknown): value is MatchCognitionKeyset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isNullOrString(record.afterCreatedAt) && isNullOrString(record.afterId);
}

function isNarrativeDualReadThrough(value: unknown): value is MatchNarrativeDualReadThrough {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isTranscriptReadThrough(record.transcript)
    && isCognitionReadThrough(record.cognition)
  );
}

function isNarrativeKeyset(value: unknown): value is MatchNarrativeKeyset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isNullOrInt(record.afterSortKey) && isNullOrString(record.afterGroupId);
}

function isNullOrInt(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function equalUtf8(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Test helper: derive the active key material fingerprint (not the key itself). */
export function matchReadCursorKeyMaterialFingerprint(secretMaterial: string): string {
  return createHash("sha256")
    .update("influence.match.read_cursor.key_fp.v1")
    .update("\0")
    .update(deriveActiveKeyV2(secretMaterial, MATCH_READ_CURSOR_KEY_VERSION))
    .digest("hex");
}
