/**
 * Opaque AES-GCM cursors for bounded producer/private index walks.
 *
 * Cursors pin a PostgreSQL insertion-visibility snapshot plus a finite
 * `(createdAt, id)` boundary, then bind both to one index kind, game,
 * authorization fingerprint, and normalized filter set. Page size is
 * deliberately not sealed so callers may change it between pages without
 * changing the row set.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { sha256StableJson } from "./stable-hash.js";

export const PRODUCER_INDEX_CURSOR_VERSION = 1 as const;
export const PRODUCER_INDEX_CURSOR_KEY_VERSION = 1 as const;
export const PRODUCER_INDEX_CURSOR_PREFIX = "pi1." as const;
export const PRODUCER_INDEX_CURSOR_MAX_TOKEN_CHARS = 4096;
export const PRODUCER_INDEX_CURSOR_MAX_TTL_MS = 30 * 60 * 1000;

const KEY_DOMAIN = "influence.producer.index_cursor.aes.v1";
const AES_ALGORITHM = "aes-256-gcm" as const;
const HEADER_BYTES = 3;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type ProducerIndexCursorKind = "cognitive_artifact" | "private_trace";

const KIND_CODE: Record<ProducerIndexCursorKind, number> = {
  cognitive_artifact: 1,
  private_trace: 2,
};

const KIND_FROM_CODE = new Map<number, ProducerIndexCursorKind>([
  [1, "cognitive_artifact"],
  [2, "private_trace"],
]);

export interface ProducerIndexCursorFilters {
  artifactType: "reasoning" | "thinking" | "strategy" | null;
  actorPlayerId: string | null;
}

export interface ProducerIndexCursorPosition {
  createdAt: string | null;
  id: string | null;
}

export interface ProducerIndexTraceLinkageSummary {
  trustedCanonicalPrefixStatus: "empty" | "complete" | "invalid";
  eligibleAcceptedDecisionCount: number;
  linkedAcceptedDecisionCount: number;
  degradedAcceptedDecisionCount: number;
  intentionallyUnlinkedTraceCount: number;
  unclassifiedTraceCount: number;
}

export interface ProducerIndexCursorClaims {
  version: typeof PRODUCER_INDEX_CURSOR_VERSION;
  keyVersion: typeof PRODUCER_INDEX_CURSOR_KEY_VERSION;
  kind: ProducerIndexCursorKind;
  issuedAtMs: number;
  expiresAtMs: number;
  bindingFingerprint: string;
  gameId: string;
  filterFingerprint: string;
  filters: ProducerIndexCursorFilters;
  databaseSnapshot: string;
  readThrough: ProducerIndexCursorPosition;
  keyset: ProducerIndexCursorPosition;
  totalCount: number;
  traceLinkageSummary: ProducerIndexTraceLinkageSummary | null;
}

export interface IssueProducerIndexCursorInput {
  kind: ProducerIndexCursorKind;
  bindingFingerprint: string;
  gameId: string;
  filters: ProducerIndexCursorFilters;
  databaseSnapshot: string;
  readThrough: ProducerIndexCursorPosition;
  keyset: ProducerIndexCursorPosition;
  totalCount: number;
  traceLinkageSummary?: ProducerIndexTraceLinkageSummary;
  nowMs?: number;
  ttlMs?: number;
}

export type ProducerIndexCursorDecodeResult =
  | { status: "ok"; claims: ProducerIndexCursorClaims }
  | { status: "invalid" };

export class ProducerIndexCursorError extends Error {
  readonly code: "missing_secret" | "encode_failed";

  constructor(code: "missing_secret" | "encode_failed", message: string) {
    super(message);
    this.name = "ProducerIndexCursorError";
    this.code = code;
  }
}

export function fingerprintProducerIndexFilters(
  kind: ProducerIndexCursorKind,
  filters: ProducerIndexCursorFilters,
): string {
  return sha256StableJson({
    domain: "influence.producer.index_cursor.filters.v1",
    kind,
    artifactType: filters.artifactType,
    actorPlayerId: filters.actorPlayerId,
  });
}

export function issueProducerIndexCursor(
  input: IssueProducerIndexCursorInput,
  secretMaterial: string = requireApiSecret(),
): string {
  try {
    const nowMs = input.nowMs ?? Date.now();
    const ttlMs = clampTtlMs(input.ttlMs);
    const filters = normalizeFilters(input.filters);
    const claims: ProducerIndexCursorClaims = {
      version: PRODUCER_INDEX_CURSOR_VERSION,
      keyVersion: PRODUCER_INDEX_CURSOR_KEY_VERSION,
      kind: input.kind,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      bindingFingerprint: requiredText(input.bindingFingerprint, "bindingFingerprint"),
      gameId: requiredText(input.gameId, "gameId"),
      filterFingerprint: fingerprintProducerIndexFilters(input.kind, filters),
      filters,
      databaseSnapshot: normalizeDatabaseSnapshot(input.databaseSnapshot),
      readThrough: normalizePosition(input.readThrough),
      keyset: normalizePosition(input.keyset),
      totalCount: nonNegativeInteger(input.totalCount, "totalCount"),
      traceLinkageSummary: normalizeTraceLinkageSummary(input.kind, input.traceLinkageSummary),
    };

    const header = Buffer.from([
      PRODUCER_INDEX_CURSOR_VERSION,
      PRODUCER_INDEX_CURSOR_KEY_VERSION,
      KIND_CODE[input.kind],
    ]);
    const key = deriveKey(secretMaterial, PRODUCER_INDEX_CURSOR_KEY_VERSION);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    cipher.setAAD(header);
    const plaintext = Buffer.from(JSON.stringify(claims), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const token = PRODUCER_INDEX_CURSOR_PREFIX
      + Buffer.concat([header, iv, ciphertext, tag]).toString("base64url");
    if (token.length > PRODUCER_INDEX_CURSOR_MAX_TOKEN_CHARS) {
      throw new ProducerIndexCursorError(
        "encode_failed",
        "Producer index cursor exceeds the transport limit",
      );
    }
    return token;
  } catch (error) {
    if (error instanceof ProducerIndexCursorError) throw error;
    throw new ProducerIndexCursorError(
      "encode_failed",
      error instanceof Error ? error.message : "Failed to seal producer index cursor",
    );
  }
}

export function decodeProducerIndexCursor(
  token: string,
  options: {
    expectedKind: ProducerIndexCursorKind;
    secretMaterial?: string;
    activeKeyVersion?: number;
    nowMs?: number;
  },
): ProducerIndexCursorDecodeResult {
  if (
    typeof token !== "string"
    || !token.startsWith(PRODUCER_INDEX_CURSOR_PREFIX)
    || token.length > PRODUCER_INDEX_CURSOR_MAX_TOKEN_CHARS
  ) {
    return { status: "invalid" };
  }

  try {
    const secret = options.secretMaterial ?? requireApiSecret();
    const encodedEnvelope = token.slice(PRODUCER_INDEX_CURSOR_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encodedEnvelope)) {
      return { status: "invalid" };
    }
    const envelope = Buffer.from(encodedEnvelope, "base64url");
    if (envelope.toString("base64url") !== encodedEnvelope) {
      return { status: "invalid" };
    }
    if (envelope.length < HEADER_BYTES + IV_BYTES + AUTH_TAG_BYTES + 2) {
      return { status: "invalid" };
    }

    const header = envelope.subarray(0, HEADER_BYTES);
    const version = header[0];
    const keyVersion = header[1];
    const kind = KIND_FROM_CODE.get(header[2]!);
    if (
      version !== PRODUCER_INDEX_CURSOR_VERSION
      || keyVersion !== (options.activeKeyVersion ?? PRODUCER_INDEX_CURSOR_KEY_VERSION)
      || kind !== options.expectedKind
    ) {
      return { status: "invalid" };
    }

    const ivStart = HEADER_BYTES;
    const ciphertextStart = ivStart + IV_BYTES;
    const tagStart = envelope.length - AUTH_TAG_BYTES;
    const iv = envelope.subarray(ivStart, ciphertextStart);
    const ciphertext = envelope.subarray(ciphertextStart, tagStart);
    const tag = envelope.subarray(tagStart);
    const decipher = createDecipheriv(AES_ALGORITHM, deriveKey(secret, keyVersion), iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
    if (!isClaims(parsed, options.expectedKind, options.nowMs ?? Date.now())) {
      return { status: "invalid" };
    }
    return { status: "ok", claims: parsed };
  } catch {
    return { status: "invalid" };
  }
}

export function bindProducerIndexCursor(params: {
  claims: ProducerIndexCursorClaims;
  kind: ProducerIndexCursorKind;
  bindingFingerprint: string;
  gameId: string;
  filters: ProducerIndexCursorFilters;
}): boolean {
  return params.claims.kind === params.kind
    && equalUtf8(params.claims.bindingFingerprint, params.bindingFingerprint)
    && equalUtf8(params.claims.gameId, params.gameId)
    && equalUtf8(
      params.claims.filterFingerprint,
      fingerprintProducerIndexFilters(params.kind, normalizeFilters(params.filters)),
    );
}

function isClaims(
  value: unknown,
  expectedKind: ProducerIndexCursorKind,
  nowMs: number,
): value is ProducerIndexCursorClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  if (claims.version !== PRODUCER_INDEX_CURSOR_VERSION) return false;
  if (claims.keyVersion !== PRODUCER_INDEX_CURSOR_KEY_VERSION) return false;
  if (claims.kind !== expectedKind) return false;
  if (!validTimeWindow(claims.issuedAtMs, claims.expiresAtMs, nowMs)) return false;
  if (typeof claims.bindingFingerprint !== "string" || claims.bindingFingerprint.length === 0) return false;
  if (typeof claims.gameId !== "string" || claims.gameId.length === 0) return false;
  if (typeof claims.filterFingerprint !== "string" || claims.filterFingerprint.length === 0) return false;
  if (!isFilters(claims.filters)) return false;
  if (!isDatabaseSnapshot(claims.databaseSnapshot)) return false;
  if (!isPosition(claims.readThrough) || !isPosition(claims.keyset)) return false;
  if (!Number.isSafeInteger(claims.totalCount) || (claims.totalCount as number) < 0) return false;
  if (expectedKind === "private_trace") {
    if (!isTraceLinkageSummary(claims.traceLinkageSummary)) return false;
  } else if (claims.traceLinkageSummary !== null) {
    return false;
  }
  const expectedFingerprint = fingerprintProducerIndexFilters(expectedKind, claims.filters);
  return equalUtf8(claims.filterFingerprint, expectedFingerprint);
}

function isFilters(value: unknown): value is ProducerIndexCursorFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const filters = value as Record<string, unknown>;
  return (
    filters.artifactType === null
    || filters.artifactType === "reasoning"
    || filters.artifactType === "thinking"
    || filters.artifactType === "strategy"
  ) && (filters.actorPlayerId === null || typeof filters.actorPlayerId === "string");
}

function normalizeFilters(filters: ProducerIndexCursorFilters): ProducerIndexCursorFilters {
  if (!isFilters(filters)) {
    throw new ProducerIndexCursorError("encode_failed", "Invalid producer index cursor filters");
  }
  return {
    artifactType: filters.artifactType,
    actorPlayerId: filters.actorPlayerId,
  };
}

function isDatabaseSnapshot(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 1024
    && /^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(value);
}

function normalizeDatabaseSnapshot(value: string): string {
  if (!isDatabaseSnapshot(value)) {
    throw new ProducerIndexCursorError("encode_failed", "Invalid producer index database snapshot");
  }
  return value;
}

function isPosition(value: unknown): value is ProducerIndexCursorPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  const createdAtValid = position.createdAt === null || typeof position.createdAt === "string";
  const idValid = position.id === null || typeof position.id === "string";
  return createdAtValid && idValid && ((position.createdAt === null) === (position.id === null));
}

function normalizePosition(position: ProducerIndexCursorPosition): ProducerIndexCursorPosition {
  if (!isPosition(position)) {
    throw new ProducerIndexCursorError("encode_failed", "Invalid producer index cursor position");
  }
  return { createdAt: position.createdAt, id: position.id };
}

function normalizeTraceLinkageSummary(
  kind: ProducerIndexCursorKind,
  summary: ProducerIndexTraceLinkageSummary | undefined,
): ProducerIndexTraceLinkageSummary | null {
  if (kind === "cognitive_artifact") return null;
  if (!isTraceLinkageSummary(summary)) {
    throw new ProducerIndexCursorError(
      "encode_failed",
      "Private trace cursors require a linkage summary",
    );
  }
  return { ...summary };
}

function isTraceLinkageSummary(value: unknown): value is ProducerIndexTraceLinkageSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  if (
    summary.trustedCanonicalPrefixStatus !== "empty"
    && summary.trustedCanonicalPrefixStatus !== "complete"
    && summary.trustedCanonicalPrefixStatus !== "invalid"
  ) {
    return false;
  }
  return [
    summary.eligibleAcceptedDecisionCount,
    summary.linkedAcceptedDecisionCount,
    summary.degradedAcceptedDecisionCount,
    summary.intentionallyUnlinkedTraceCount,
    summary.unclassifiedTraceCount,
  ].every((count) => Number.isSafeInteger(count) && (count as number) >= 0);
}

function validTimeWindow(issuedAtMs: unknown, expiresAtMs: unknown, nowMs: number): boolean {
  if (typeof issuedAtMs !== "number" || !Number.isFinite(issuedAtMs)) return false;
  if (typeof expiresAtMs !== "number" || !Number.isFinite(expiresAtMs)) return false;
  if (expiresAtMs < nowMs) return false;
  if (issuedAtMs > nowMs + 60_000) return false;
  return expiresAtMs - issuedAtMs <= PRODUCER_INDEX_CURSOR_MAX_TTL_MS;
}

function clampTtlMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return PRODUCER_INDEX_CURSOR_MAX_TTL_MS;
  return Math.max(1, Math.min(Math.floor(value), PRODUCER_INDEX_CURSOR_MAX_TTL_MS));
}

function deriveKey(secretMaterial: string, keyVersion: number): Buffer {
  return createHash("sha256")
    .update(KEY_DOMAIN)
    .update("\0")
    .update(String(keyVersion))
    .update("\0")
    .update(secretMaterial)
    .digest();
}

function requireApiSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 8) {
    throw new ProducerIndexCursorError(
      "missing_secret",
      "JWT_SECRET must be set for producer index cursors",
    );
  }
  return secret;
}

function requiredText(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProducerIndexCursorError("encode_failed", `${name} must be non-empty`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProducerIndexCursorError("encode_failed", `${name} must be a non-negative integer`);
  }
  return value;
}

function equalUtf8(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
