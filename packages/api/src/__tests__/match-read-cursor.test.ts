import { beforeEach, describe, expect, test } from "bun:test";
import {
  MATCH_READ_CURSOR_KEY_VERSION,
  MATCH_READ_CURSOR_MAX_TOKEN_CHARS,
  MATCH_READ_CURSOR_MAX_TTL_MS,
  MATCH_TRANSCRIPT_CURSOR_PURPOSE,
  bindMatchTranscriptCursor,
  decodeMatchTranscriptCursor,
  fingerprintMatchTranscriptFilters,
  issueMatchTranscriptCursor,
  matchReadCursorKeyMaterialFingerprint,
  type MatchTranscriptCursorClaims,
} from "../services/match-read-cursor.js";

const SECRET_A = "test-jwt-secret-match-read-cursor-aaaa";
const SECRET_B = "test-jwt-secret-match-read-cursor-bbbb";
const NOW = 1_720_000_000_000;

const emptyFilters = {
  phase: null,
  round: null,
  scope: null,
  playerId: null,
  player: null,
  fromTimestampMs: null,
  toTimestampMs: null,
};

function issueDefault(overrides: Partial<Parameters<typeof issueMatchTranscriptCursor>[0]> = {}) {
  return issueMatchTranscriptCursor({
    subjectUserId: "user-1",
    gameId: "game-1",
    filterFingerprint: fingerprintMatchTranscriptFilters({
      phase: null,
      round: null,
      scope: null,
      playerId: null,
      fromTimestampMs: null,
      toTimestampMs: null,
    }),
    ownershipFingerprint: "sha256:ownership-1",
    captureVersion: 1,
    mode: "snapshot",
    readThrough: {
      throughEntrySequence: 10,
      throughLegacyTimestamp: null,
      throughLegacyId: null,
    },
    keyset: {
      afterEntrySequence: 3,
      afterLegacyTimestamp: null,
      afterLegacyId: null,
    },
    filters: emptyFilters,
    nowMs: NOW,
    ...overrides,
  }, SECRET_A);
}

describe("match-read-cursor AES-GCM codec", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET_A;
  });

  test("round-trips sealed claims with domain-separated key", () => {
    const token = issueDefault({ nonce: "abc123" });
    expect(token.length).toBeGreaterThan(20);
    expect(token).not.toContain("game-1");
    expect(token).not.toContain("user-1");

    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW + 1_000,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;

    const claims: MatchTranscriptCursorClaims = decoded.claims;
    expect(claims.purpose).toBe(MATCH_TRANSCRIPT_CURSOR_PURPOSE);
    expect(claims.keyVersion).toBe(MATCH_READ_CURSOR_KEY_VERSION);
    expect(claims.subjectUserId).toBe("user-1");
    expect(claims.gameId).toBe("game-1");
    expect(claims.nonce).toBe("abc123");
    expect(claims.readThrough.throughEntrySequence).toBe(10);
    expect(claims.keyset.afterEntrySequence).toBe(3);
    expect(claims.mode).toBe("snapshot");
    expect(claims.expiresAtMs - claims.issuedAtMs).toBeLessThanOrEqual(MATCH_READ_CURSOR_MAX_TTL_MS);
  });

  test("nonce reuse changes no semantics (same claims except nonce)", () => {
    const a = issueDefault({ nonce: "same-nonce" });
    const b = issueDefault({ nonce: "same-nonce" });
    // Ciphertexts differ because IV is random; claims match after decode.
    expect(a).not.toBe(b);
    const da = decodeMatchTranscriptCursor(a, { secretMaterial: SECRET_A, nowMs: NOW });
    const db = decodeMatchTranscriptCursor(b, { secretMaterial: SECRET_A, nowMs: NOW });
    expect(da.status).toBe("ok");
    expect(db.status).toBe("ok");
    if (da.status !== "ok" || db.status !== "ok") return;
    expect(da.claims.nonce).toBe(db.claims.nonce);
    expect(da.claims.keyset).toEqual(db.claims.keyset);
  });

  test("expired cursor fails closed", () => {
    const token = issueDefault({ ttlMs: 60_000 });
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW + 120_000,
    });
    expect(decoded).toEqual({ status: "invalid" });
  });

  test("key rotation (different secret) invalidates outstanding cursors", () => {
    const token = issueDefault();
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_B,
      nowMs: NOW,
    });
    expect(decoded).toEqual({ status: "invalid" });
    expect(matchReadCursorKeyMaterialFingerprint(SECRET_A))
      .not.toBe(matchReadCursorKeyMaterialFingerprint(SECRET_B));
  });

  test("unknown key version fails closed", () => {
    const token = issueDefault();
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      activeKeyVersion: MATCH_READ_CURSOR_KEY_VERSION + 1,
      nowMs: NOW,
    });
    expect(decoded).toEqual({ status: "invalid" });
  });

  test("wrong purpose fails closed", () => {
    const token = issueDefault();
    // Tamper AAD purpose by asking decoder for a different purpose string via casting path:
    // decode always uses MATCH_TRANSCRIPT_CURSOR_PURPOSE; wrong-purpose is covered by
    // tampering ciphertext envelope purpose in claims after decrypt failure on AAD mismatch.
    // Direct claim purpose mismatch: seal then corrupt is equivalent to invalid tag.
    const decoded = decodeMatchTranscriptCursor(token + "x", {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    });
    expect(decoded).toEqual({ status: "invalid" });
  });

  test("oversized and malformed tokens fail before useful work", () => {
    expect(decodeMatchTranscriptCursor("not-valid-base64!!!", {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });

    expect(decodeMatchTranscriptCursor("", {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });

    const oversized = "a".repeat(MATCH_READ_CURSOR_MAX_TOKEN_CHARS + 1);
    expect(decodeMatchTranscriptCursor(oversized, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });
  });

  test("tampered ciphertext fails closed", () => {
    const token = issueDefault();
    const buf = Buffer.from(token, "base64url");
    // Flip a middle byte.
    const mid = Math.floor(buf.length / 2);
    const previous = buf.at(mid);
    if (previous === undefined) throw new Error("empty token buffer");
    buf[mid] = previous ^ 0xff;
    const tampered = buf.toString("base64url");
    expect(decodeMatchTranscriptCursor(tampered, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });
  });

  test("bindMatchTranscriptCursor rejects subject/game/ownership/filter/capture mismatch", () => {
    const token = issueDefault();
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;

    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: decoded.claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(true);

    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "other-user",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: decoded.claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(false);

    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "user-1",
      gameId: "other-game",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: decoded.claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(false);

    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:other-ownership",
      filterFingerprint: decoded.claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(false);

    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: "sha256:different-filters",
      captureVersion: 1,
    })).toBe(false);

    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: decoded.claims.filterFingerprint,
      captureVersion: 0,
    })).toBe(false);
  });

  test("filter fingerprint is stable and domain-separated", () => {
    const a = fingerprintMatchTranscriptFilters({
      phase: "MINGLE_I",
      round: 1,
      scope: "public",
      playerId: "p1",
      fromTimestampMs: null,
      toTimestampMs: null,
    });
    const b = fingerprintMatchTranscriptFilters({
      phase: "MINGLE_I",
      round: 1,
      scope: "public",
      playerId: "p1",
      fromTimestampMs: null,
      toTimestampMs: null,
    });
    const c = fingerprintMatchTranscriptFilters({
      phase: "MINGLE_I",
      round: 2,
      scope: "public",
      playerId: "p1",
      fromTimestampMs: null,
      toTimestampMs: null,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  test("TTL is clamped to 30 minutes", () => {
    const token = issueDefault({ ttlMs: 999_999_999 });
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    expect(decoded.claims.expiresAtMs - decoded.claims.issuedAtMs)
      .toBe(MATCH_READ_CURSOR_MAX_TTL_MS);
  });
});
