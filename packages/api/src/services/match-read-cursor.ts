/**
 * AES-GCM opaque cursor codec for match transcript (U4) and owned cognition (U5)
 * pagination.
 *
 * Tokens are bound to purpose, subject, game, filter fingerprint, ownership
 * fingerprint, capture version, pinned read-through boundary, and internal
 * keyset position. Active-key-only rotation intentionally invalidates
 * outstanding cursors.
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
import { sha256StableJson } from "./stable-hash.js";

/** Cursor format version embedded in every sealed token. */
export const MATCH_READ_CURSOR_VERSION = 1 as const;

/** Active encryption key version. Rotation bumps this and invalidates old tokens. */
export const MATCH_READ_CURSOR_KEY_VERSION = 1 as const;

/** Purpose claim for authorized transcript page/catch-up walks. */
export const MATCH_TRANSCRIPT_CURSOR_PURPOSE = "match_transcript" as const;

/** Purpose claim for owned thinking/strategy timeline walks. */
export const MATCH_COGNITION_CURSOR_PURPOSE = "match_cognition" as const;

/** Domain separator for AES-256 key derivation from API secret material. */
const KEY_DOMAIN = "influence.match.read_cursor.aes.v1";

/** Maximum sealed token UTF-8 length accepted before parse/decrypt. */
export const MATCH_READ_CURSOR_MAX_TOKEN_CHARS = 4096;

/** Maximum cursor lifetime (30 minutes). */
export const MATCH_READ_CURSOR_MAX_TTL_MS = 30 * 60 * 1000;

const AES_ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type MatchTranscriptCursorPurpose = typeof MATCH_TRANSCRIPT_CURSOR_PURPOSE;
export type MatchCognitionCursorPurpose = typeof MATCH_COGNITION_CURSOR_PURPOSE;
export type MatchReadCursorPurpose =
  | MatchTranscriptCursorPurpose
  | MatchCognitionCursorPurpose;

export type MatchTranscriptCursorMode = "snapshot" | "catchup";
export type MatchCognitionCursorMode = "snapshot" | "catchup";

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
 */
export interface MatchTranscriptCursorClaims {
  version: typeof MATCH_READ_CURSOR_VERSION;
  purpose: MatchTranscriptCursorPurpose;
  keyVersion: number;
  /** Random per-issue nonce (hex). Reuse changes no semantics. */
  nonce: string;
  /** Issued-at unix milliseconds. */
  issuedAtMs: number;
  /** Expiry unix milliseconds (issuedAt + ≤ 30 min). */
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
  version: typeof MATCH_READ_CURSOR_VERSION;
  purpose: MatchCognitionCursorPurpose;
  keyVersion: number;
  nonce: string;
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

export type MatchReadCursorDecodeResult =
  | { status: "ok"; claims: MatchTranscriptCursorClaims }
  | { status: "invalid" };

export type MatchCognitionCursorDecodeResult =
  | { status: "ok"; claims: MatchCognitionCursorClaims }
  | { status: "invalid" };

export interface IssueMatchTranscriptCursorInput {
  subjectUserId: string;
  gameId: string;
  filterFingerprint: string;
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
  /** Inject nonce for deterministic tests. */
  nonce?: string;
}

export interface IssueMatchCognitionCursorInput {
  subjectUserId: string;
  gameId: string;
  filterFingerprint: string;
  ownershipFingerprint: string;
  captureVersion: number;
  mode: MatchCognitionCursorMode;
  readThrough: MatchCognitionReadThroughBoundary;
  keyset: MatchCognitionKeyset;
  filters: MatchCognitionCursorFilters;
  nowMs?: number;
  ttlMs?: number;
  nonce?: string;
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
 * Seal a transcript pagination cursor. Requires JWT_SECRET (or injected secret).
 */
export function issueMatchTranscriptCursor(
  input: IssueMatchTranscriptCursorInput,
  secretMaterial: string = requireApiSecret(),
): string {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = Math.min(
    Math.max(1, input.ttlMs ?? MATCH_READ_CURSOR_MAX_TTL_MS),
    MATCH_READ_CURSOR_MAX_TTL_MS,
  );
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const claims: MatchTranscriptCursorClaims = {
    version: MATCH_READ_CURSOR_VERSION,
    purpose: MATCH_TRANSCRIPT_CURSOR_PURPOSE,
    keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
    nonce,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    subjectUserId: input.subjectUserId,
    gameId: input.gameId,
    filterFingerprint: input.filterFingerprint,
    ownershipFingerprint: input.ownershipFingerprint,
    captureVersion: input.captureVersion,
    mode: input.mode,
    readThrough: {
      throughEntrySequence: input.readThrough.throughEntrySequence,
      throughLegacyTimestamp: input.readThrough.throughLegacyTimestamp,
      throughLegacyId: input.readThrough.throughLegacyId,
    },
    keyset: {
      afterEntrySequence: input.keyset.afterEntrySequence,
      afterLegacyTimestamp: input.keyset.afterLegacyTimestamp,
      afterLegacyId: input.keyset.afterLegacyId,
    },
    filters: {
      phase: input.filters.phase,
      round: input.filters.round,
      scope: input.filters.scope,
      playerId: input.filters.playerId,
      player: input.filters.player,
      fromTimestampMs: input.filters.fromTimestampMs,
      toTimestampMs: input.filters.toTimestampMs,
    },
  };

  return sealClaims(claims, MATCH_TRANSCRIPT_CURSOR_PURPOSE, secretMaterial);
}

/**
 * Seal an owned-cognition timeline pagination cursor.
 */
export function issueMatchCognitionCursor(
  input: IssueMatchCognitionCursorInput,
  secretMaterial: string = requireApiSecret(),
): string {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = Math.min(
    Math.max(1, input.ttlMs ?? MATCH_READ_CURSOR_MAX_TTL_MS),
    MATCH_READ_CURSOR_MAX_TTL_MS,
  );
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const claims: MatchCognitionCursorClaims = {
    version: MATCH_READ_CURSOR_VERSION,
    purpose: MATCH_COGNITION_CURSOR_PURPOSE,
    keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
    nonce,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    subjectUserId: input.subjectUserId,
    gameId: input.gameId,
    filterFingerprint: input.filterFingerprint,
    ownershipFingerprint: input.ownershipFingerprint,
    captureVersion: input.captureVersion,
    mode: input.mode,
    readThrough: {
      throughCreatedAt: input.readThrough.throughCreatedAt,
      throughId: input.readThrough.throughId,
    },
    keyset: {
      afterCreatedAt: input.keyset.afterCreatedAt,
      afterId: input.keyset.afterId,
    },
    filters: {
      artifactType: input.filters.artifactType,
      actorPlayerId: input.filters.actorPlayerId,
      player: input.filters.player,
      phase: input.filters.phase,
      round: input.filters.round,
      action: input.filters.action,
    },
  };

  return sealClaims(claims, MATCH_COGNITION_CURSOR_PURPOSE, secretMaterial);
}

/**
 * Decode and validate a sealed transcript cursor without database access.
 * Returns a uniform `invalid` for every local failure mode.
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

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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

function sealClaims(
  claims: MatchTranscriptCursorClaims | MatchCognitionCursorClaims,
  purpose: MatchReadCursorPurpose,
  secretMaterial: string,
): string {
  try {
    const key = deriveActiveKey(secretMaterial, claims.keyVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    cipher.setAAD(aadBytes(claims.version, claims.keyVersion, purpose));
    const plaintext = Buffer.from(JSON.stringify(claims), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = {
      v: claims.version,
      kv: claims.keyVersion,
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url"),
      ct: ciphertext.toString("base64url"),
    };
    return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  } catch (error) {
    throw new MatchReadCursorError(
      "encode_failed",
      error instanceof Error ? error.message : "Failed to seal match read cursor",
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
  if (token.length > MATCH_READ_CURSOR_MAX_TOKEN_CHARS) {
    return { status: "invalid" };
  }

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
    if (!isEnvelope(parsed)) return { status: "invalid" };
    envelope = parsed;
  } catch {
    return { status: "invalid" };
  }

  if (envelope.v !== MATCH_READ_CURSOR_VERSION) return { status: "invalid" };
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

  const key = deriveActiveKey(secret, envelope.kv);
  let plaintext: string;
  try {
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAAD(aadBytes(envelope.v, envelope.kv, expectedPurpose));
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
  if (record.version !== MATCH_READ_CURSOR_VERSION) return { status: "invalid" };
  if (record.purpose !== expectedPurpose) return { status: "invalid" };
  if (typeof record.keyVersion !== "number" || record.keyVersion !== activeKeyVersion) {
    return { status: "invalid" };
  }
  if (typeof record.issuedAtMs !== "number" || !Number.isFinite(record.issuedAtMs)) {
    return { status: "invalid" };
  }
  if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) {
    return { status: "invalid" };
  }
  if (record.expiresAtMs < nowMs) return { status: "invalid" };
  if (record.issuedAtMs > nowMs + 60_000) return { status: "invalid" };
  if (record.expiresAtMs - record.issuedAtMs > MATCH_READ_CURSOR_MAX_TTL_MS) {
    return { status: "invalid" };
  }

  return { status: "ok", claims };
}

function deriveActiveKey(secretMaterial: string, keyVersion: number): Buffer {
  // Domain-separated SHA-256 → 32-byte AES-256 key. Active-key-only: old kv fails closed.
  return createHash("sha256")
    .update(KEY_DOMAIN)
    .update("\0")
    .update(String(keyVersion))
    .update("\0")
    .update(secretMaterial)
    .digest();
}

function aadBytes(version: number, keyVersion: number, purpose: string): Buffer {
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

function isEnvelope(value: unknown): value is {
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
  if (record.version !== MATCH_READ_CURSOR_VERSION) return false;
  if (record.purpose !== MATCH_TRANSCRIPT_CURSOR_PURPOSE) return false;
  if (typeof record.keyVersion !== "number") return false;
  if (typeof record.nonce !== "string" || record.nonce.length === 0) return false;
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
  if (record.version !== MATCH_READ_CURSOR_VERSION) return false;
  if (record.purpose !== MATCH_COGNITION_CURSOR_PURPOSE) return false;
  if (typeof record.keyVersion !== "number") return false;
  if (typeof record.nonce !== "string" || record.nonce.length === 0) return false;
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

function isNullOrInt(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value));
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
    .update(deriveActiveKey(secretMaterial, MATCH_READ_CURSOR_KEY_VERSION))
    .digest("hex");
}
