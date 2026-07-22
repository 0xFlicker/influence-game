import { beforeEach, describe, expect, test } from "bun:test";
import {
  MATCH_COGNITION_CURSOR_PURPOSE,
  MATCH_NARRATIVE_CURSOR_PURPOSE,
  MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT,
  MATCH_READ_CURSOR_KEY_VERSION,
  MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V1,
  MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V2,
  MATCH_READ_CURSOR_MAX_TTL_MS,
  MATCH_READ_CURSOR_V2_PREFIX,
  MATCH_READ_CURSOR_VERSION,
  MATCH_TRANSCRIPT_CURSOR_PURPOSE,
  bindMatchCognitionCursor,
  bindMatchNarrativeCursor,
  bindMatchTranscriptCursor,
  decodeMatchCognitionCursor,
  decodeMatchNarrativeCursor,
  decodeMatchTranscriptCursor,
  digestNarrativeGroupMembers,
  fingerprintMatchCognitionFilters,
  fingerprintMatchNarrativeFilters,
  fingerprintMatchTranscriptFilters,
  issueLegacyMatchReadCursorV1ForTests,
  issueMatchCognitionCursor,
  issueMatchNarrativeCursor,
  issueMatchTranscriptCursor,
  matchReadCursorKeyMaterialFingerprint,
  type MatchCognitionCursorClaims,
  type MatchNarrativeCursorClaims,
  type MatchNarrativeCursorFilters,
  type MatchTranscriptCursorClaims,
} from "../services/match-read-cursor.js";

const SECRET_A = "test-jwt-secret-match-read-cursor-aaaa";
const SECRET_B = "test-jwt-secret-match-read-cursor-bbbb";
const NOW = 1_720_000_000_000;

const emptyTranscriptFilters = {
  phase: null,
  round: null,
  scope: null,
  playerId: null,
  player: null,
  fromTimestampMs: null,
  toTimestampMs: null,
};

const emptyNarrativeFilters: MatchNarrativeCursorFilters = {
  preset: "strategic",
  detail: "compact",
  playerId: null,
  player: null,
  phase: null,
  round: null,
  action: null,
  fromTimestampMs: null,
  toTimestampMs: null,
  schemaVersion: 2,
  includeUnpaired: false,
};

function issueDefault(overrides: Partial<Parameters<typeof issueMatchTranscriptCursor>[0]> = {}) {
  return issueMatchTranscriptCursor({
    subjectUserId: "user-1",
    gameId: "game-1",
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
    filters: emptyTranscriptFilters,
    nowMs: NOW,
    ...overrides,
  }, SECRET_A);
}

function issueNarrativeDefault(
  overrides: Partial<Parameters<typeof issueMatchNarrativeCursor>[0]> = {},
) {
  return issueMatchNarrativeCursor({
    subjectUserId: "user-1",
    gameId: "game-1",
    surface: "subject_owner",
    ownershipFingerprint: "sha256:ownership-1",
    transcriptCaptureVersion: 1,
    cognitiveCaptureVersion: 1,
    mode: "snapshot",
    readThrough: {
      transcript: {
        throughEntrySequence: 10,
        throughLegacyTimestamp: null,
        throughLegacyId: null,
      },
      cognition: {
        throughCreatedAt: "2026-07-21T12:00:00.000Z",
        throughId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
    },
    keyset: {
      afterSortKey: 3,
      afterGroupId: digestNarrativeGroupMembers(["d:1", "c:abc"]),
    },
    filters: emptyNarrativeFilters,
    nowMs: NOW,
    ...overrides,
  }, SECRET_A);
}

describe("match-read-cursor AES-GCM codec (V2)", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET_A;
  });

  test("issues mr2. tokens and round-trips sealed transcript claims", () => {
    const token = issueDefault();
    expect(token.startsWith(MATCH_READ_CURSOR_V2_PREFIX)).toBe(true);
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
    expect(claims.version).toBe(MATCH_READ_CURSOR_VERSION);
    expect(claims.purpose).toBe(MATCH_TRANSCRIPT_CURSOR_PURPOSE);
    expect(claims.keyVersion).toBe(MATCH_READ_CURSOR_KEY_VERSION);
    expect(claims.subjectUserId).toBe("user-1");
    expect(claims.gameId).toBe("game-1");
    expect(claims.readThrough.throughEntrySequence).toBe(10);
    expect(claims.keyset.afterEntrySequence).toBe(3);
    expect(claims.mode).toBe("snapshot");
    expect(claims.expiresAtMs - claims.issuedAtMs).toBeLessThanOrEqual(MATCH_READ_CURSOR_MAX_TTL_MS);
    expect(claims.filterFingerprint).toBe(fingerprintMatchTranscriptFilters({
      phase: null,
      round: null,
      scope: null,
      playerId: null,
      fromTimestampMs: null,
      toTimestampMs: null,
    }));
  });

  test("random IV yields distinct tokens with identical claims", () => {
    const a = issueDefault();
    const b = issueDefault();
    expect(a).not.toBe(b);
    const da = decodeMatchTranscriptCursor(a, { secretMaterial: SECRET_A, nowMs: NOW });
    const db = decodeMatchTranscriptCursor(b, { secretMaterial: SECRET_A, nowMs: NOW });
    expect(da.status).toBe("ok");
    expect(db.status).toBe("ok");
    if (da.status !== "ok" || db.status !== "ok") return;
    expect(da.claims.keyset).toEqual(db.claims.keyset);
    expect(da.claims.filterFingerprint).toBe(db.claims.filterFingerprint);
  });

  test("expired cursor fails closed", () => {
    const token = issueDefault({ ttlMs: 60_000 });
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW + 120_000,
    });
    expect(decoded).toEqual({ status: "invalid" });
  });

  test("future issue time fails closed", () => {
    const token = issueDefault({ nowMs: NOW + 120_000 });
    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
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

  test("tampered ciphertext fails closed", () => {
    const token = issueDefault();
    const body = token.slice(MATCH_READ_CURSOR_V2_PREFIX.length);
    const buf = Buffer.from(body, "base64url");
    const mid = Math.floor(buf.length / 2);
    const previous = buf.at(mid);
    if (previous === undefined) throw new Error("empty token buffer");
    buf[mid] = previous ^ 0xff;
    const tampered = MATCH_READ_CURSOR_V2_PREFIX + buf.toString("base64url");
    expect(decodeMatchTranscriptCursor(tampered, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });
  });

  test("wrong purpose fails closed via AAD / header", () => {
    const token = issueDefault();
    expect(decodeMatchCognitionCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });
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

    const oversizedV2 = MATCH_READ_CURSOR_V2_PREFIX + "a".repeat(
      MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V2,
    );
    expect(oversizedV2.length).toBeGreaterThan(MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V2);
    expect(decodeMatchTranscriptCursor(oversizedV2, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });

    // Legacy V1 path still allows up to 4096; 4097 fails.
    const oversizedV1 = "a".repeat(MATCH_READ_CURSOR_MAX_TOKEN_CHARS_V1 + 1);
    expect(decodeMatchTranscriptCursor(oversizedV1, {
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

  test("cognition purpose is isolated from transcript purpose", () => {
    const cognitionToken = issueMatchCognitionCursor({
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      captureVersion: 1,
      mode: "snapshot",
      readThrough: {
        throughCreatedAt: "2026-07-21T12:00:00.000Z",
        throughId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      keyset: {
        afterCreatedAt: "2026-07-21T11:00:00.000Z",
        afterId: "11111111-2222-3333-4444-555555555555",
      },
      filters: {
        artifactType: "thinking",
        actorPlayerId: null,
        player: null,
        phase: null,
        round: null,
        action: null,
      },
      nowMs: NOW,
    }, SECRET_A);

    expect(cognitionToken.startsWith(MATCH_READ_CURSOR_V2_PREFIX)).toBe(true);

    const asTranscript = decodeMatchTranscriptCursor(cognitionToken, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    });
    expect(asTranscript).toEqual({ status: "invalid" });

    const asCognition = decodeMatchCognitionCursor(cognitionToken, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    });
    expect(asCognition.status).toBe("ok");
    if (asCognition.status !== "ok") return;
    const claims: MatchCognitionCursorClaims = asCognition.claims;
    expect(claims.purpose).toBe(MATCH_COGNITION_CURSOR_PURPOSE);
    expect(claims.filters.artifactType).toBe("thinking");
    expect(claims.keyset.afterCreatedAt).toBe("2026-07-21T11:00:00.000Z");
    expect(claims.filterFingerprint).toBe(fingerprintMatchCognitionFilters({
      artifactType: "thinking",
      actorPlayerId: null,
      phase: null,
      round: null,
      action: null,
    }));

    expect(bindMatchCognitionCursor({
      claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(true);
    expect(bindMatchCognitionCursor({
      claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:different",
      filterFingerprint: claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(false);
  });

  test("narrative surface is sealed and cross-surface decode fails", () => {
    const ownerToken = issueNarrativeDefault({ surface: "subject_owner" });

    const ownerOk = decodeMatchNarrativeCursor(ownerToken, {
      secretMaterial: SECRET_A,
      expectedSurface: "subject_owner",
      nowMs: NOW,
    });
    expect(ownerOk.status).toBe("ok");
    if (ownerOk.status !== "ok") return;
    expect(ownerOk.claims.purpose).toBe(MATCH_NARRATIVE_CURSOR_PURPOSE);
    expect(ownerOk.claims.surface).toBe("subject_owner");
    expect(ownerOk.claims.filters.schemaVersion).toBe(2);
    expect(ownerOk.claims.filters.includeUnpaired).toBe(false);

    expect(decodeMatchNarrativeCursor(ownerToken, {
      secretMaterial: SECRET_A,
      expectedSurface: "producer",
      nowMs: NOW,
    })).toEqual({ status: "invalid" });

    expect(decodeMatchTranscriptCursor(ownerToken, {
      secretMaterial: SECRET_A,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });

    const filterFingerprint = fingerprintMatchNarrativeFilters({
      preset: "strategic",
      detail: "compact",
      playerId: null,
      phase: null,
      round: null,
      action: null,
      fromTimestampMs: null,
      toTimestampMs: null,
      schemaVersion: 2,
      includeUnpaired: false,
    });
    expect(ownerOk.claims.filterFingerprint).toBe(filterFingerprint);

    expect(bindMatchNarrativeCursor({
      claims: ownerOk.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      surface: "subject_owner",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint,
      transcriptCaptureVersion: 1,
      cognitiveCaptureVersion: 1,
    })).toBe(true);

    expect(bindMatchNarrativeCursor({
      claims: ownerOk.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      surface: "producer",
      ownershipFingerprint: MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT,
      filterFingerprint,
      transcriptCaptureVersion: 1,
      cognitiveCaptureVersion: 1,
    })).toBe(false);
  });

  test("producer narrative cursor round-trips and seals schemaVersion/includeUnpaired", () => {
    const token = issueNarrativeDefault({
      surface: "producer",
      ownershipFingerprint: MATCH_NARRATIVE_PRODUCER_OWNERSHIP_FINGERPRINT,
      filters: {
        ...emptyNarrativeFilters,
        schemaVersion: 2,
        includeUnpaired: true,
        phase: "VOTE",
        round: 2,
      },
    });
    const decoded = decodeMatchNarrativeCursor(token, {
      secretMaterial: SECRET_A,
      expectedSurface: "producer",
      nowMs: NOW,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    const claims: MatchNarrativeCursorClaims = decoded.claims;
    expect(claims.surface).toBe("producer");
    expect(claims.filters.includeUnpaired).toBe(true);
    expect(claims.filters.schemaVersion).toBe(2);
    expect(claims.filters.phase).toBe("VOTE");
    expect(claims.filters.round).toBe(2);
    expect(claims.filterFingerprint).toBe(fingerprintMatchNarrativeFilters({
      preset: "strategic",
      detail: "compact",
      playerId: null,
      phase: "VOTE",
      round: 2,
      action: null,
      fromTimestampMs: null,
      toTimestampMs: null,
      schemaVersion: 2,
      includeUnpaired: true,
    }));
  });

  test("group digest is deterministic, order-independent, and fixed-size", () => {
    const a = digestNarrativeGroupMembers(["c:b", "d:a"]);
    const b = digestNarrativeGroupMembers(["d:a", "c:b"]);
    const c = digestNarrativeGroupMembers(["d:a", "c:c"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // SHA-256 base64url is 43 chars (no padding).
    expect(a.length).toBe(43);
    expect(a).not.toContain("|");
  });

  test("size budgets: representative and max-filter cursors stay compact", () => {
    const narrativeRep = issueNarrativeDefault();
    expect(narrativeRep.length).toBeLessThanOrEqual(800);

    const maxFilters: MatchNarrativeCursorFilters = {
      preset: "full_cognition",
      detail: "full",
      playerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      player: "VeryLongPlayerDisplayName_ForFilterEcho_XXXXXXXX",
      phase: "POST_VOTE_MINGLE",
      round: 12,
      action: "empower.revote.cast",
      fromTimestampMs: 1_720_000_000_000,
      toTimestampMs: 1_720_000_900_000,
      schemaVersion: 2,
      includeUnpaired: true,
    };
    const narrativeMax = issueNarrativeDefault({
      filters: maxFilters,
      keyset: {
        afterSortKey: 1_720_000_500_000,
        afterGroupId: digestNarrativeGroupMembers([
          "d:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          "c:11111111-2222-3333-4444-555555555555",
          "c:99999999-8888-7777-6666-555555555555",
        ]),
      },
      ownershipFingerprint: "sha256:" + "ab".repeat(32),
      subjectUserId: "user_" + "x".repeat(40),
      gameId: "game_" + "y".repeat(40),
    });
    expect(narrativeMax.length).toBeLessThanOrEqual(1_200);

    const transcript = issueDefault({
      filters: {
        phase: "POST_VOTE_MINGLE",
        round: 12,
        scope: "public",
        playerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        player: "VeryLongPlayerDisplayName_ForFilterEcho_XXXXXXXX",
        fromTimestampMs: 1_720_000_000_000,
        toTimestampMs: 1_720_000_900_000,
      },
      ownershipFingerprint: "sha256:" + "cd".repeat(32),
      subjectUserId: "user_" + "x".repeat(40),
      gameId: "game_" + "y".repeat(40),
    });
    expect(transcript.length).toBeLessThanOrEqual(900);

    const cognition = issueMatchCognitionCursor({
      subjectUserId: "user_" + "x".repeat(40),
      gameId: "game_" + "y".repeat(40),
      ownershipFingerprint: "sha256:" + "ef".repeat(32),
      captureVersion: 1,
      mode: "catchup",
      readThrough: {
        throughCreatedAt: "2026-07-21T12:00:00.000Z",
        throughId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      keyset: {
        afterCreatedAt: "2026-07-21T11:00:00.000Z",
        afterId: "11111111-2222-3333-4444-555555555555",
      },
      filters: {
        artifactType: "strategy",
        actorPlayerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        player: "VeryLongPlayerDisplayName_ForFilterEcho_XXXXXXXX",
        phase: "POST_VOTE_MINGLE",
        round: 12,
        action: "empower.revote.cast",
      },
      nowMs: NOW,
    }, SECRET_A);
    expect(cognition.length).toBeLessThanOrEqual(900);
  });
});

describe("match-read-cursor V1 compatibility decoder", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET_A;
  });

  test("legacy V1 transcript fixture still decodes and binds", () => {
    const v2Shape: MatchTranscriptCursorClaims = {
      version: MATCH_READ_CURSOR_VERSION,
      purpose: MATCH_TRANSCRIPT_CURSOR_PURPOSE,
      keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
      issuedAtMs: NOW,
      expiresAtMs: NOW + MATCH_READ_CURSOR_MAX_TTL_MS,
      subjectUserId: "user-1",
      gameId: "game-1",
      filterFingerprint: fingerprintMatchTranscriptFilters({
        phase: "MINGLE_I",
        round: 1,
        scope: null,
        playerId: "p1",
        fromTimestampMs: null,
        toTimestampMs: null,
      }),
      ownershipFingerprint: "sha256:ownership-1",
      captureVersion: 1,
      mode: "snapshot",
      readThrough: {
        throughEntrySequence: 42,
        throughLegacyTimestamp: null,
        throughLegacyId: null,
      },
      keyset: {
        afterEntrySequence: 10,
        afterLegacyTimestamp: null,
        afterLegacyId: null,
      },
      filters: {
        phase: "MINGLE_I",
        round: 1,
        scope: null,
        playerId: "p1",
        player: "Alice",
        fromTimestampMs: null,
        toTimestampMs: null,
      },
    };

    const token = issueLegacyMatchReadCursorV1ForTests(
      v2Shape,
      MATCH_TRANSCRIPT_CURSOR_PURPOSE,
      SECRET_A,
    );
    expect(token.startsWith(MATCH_READ_CURSOR_V2_PREFIX)).toBe(false);

    const decoded = decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_A,
      nowMs: NOW + 1_000,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    expect(decoded.claims.version).toBe(1);
    expect(decoded.claims.gameId).toBe("game-1");
    expect(decoded.claims.keyset.afterEntrySequence).toBe(10);
    expect(decoded.claims.filters.player).toBe("Alice");
    expect(bindMatchTranscriptCursor({
      claims: decoded.claims,
      subjectUserId: "user-1",
      gameId: "game-1",
      ownershipFingerprint: "sha256:ownership-1",
      filterFingerprint: decoded.claims.filterFingerprint,
      captureVersion: 1,
    })).toBe(true);
  });

  test("legacy V1 narrative fixture migrates joined keyset to digest and restores filter defaults", () => {
    const claims: MatchNarrativeCursorClaims = {
      version: MATCH_READ_CURSOR_VERSION,
      purpose: MATCH_NARRATIVE_CURSOR_PURPOSE,
      keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
      issuedAtMs: NOW,
      expiresAtMs: NOW + MATCH_READ_CURSOR_MAX_TTL_MS,
      subjectUserId: "user-1",
      gameId: "game-1",
      surface: "subject_owner",
      filterFingerprint: "placeholder",
      ownershipFingerprint: "sha256:ownership-1",
      transcriptCaptureVersion: 1,
      cognitiveCaptureVersion: 1,
      mode: "snapshot",
      readThrough: {
        transcript: {
          throughEntrySequence: 10,
          throughLegacyTimestamp: null,
          throughLegacyId: null,
        },
        cognition: {
          throughCreatedAt: "2026-07-21T12:00:00.000Z",
          throughId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
      },
      keyset: { afterSortKey: 5, afterGroupId: "d:1|c:2" },
      filters: {
        preset: "strategic",
        detail: "compact",
        playerId: null,
        player: null,
        phase: null,
        round: null,
        action: null,
        fromTimestampMs: null,
        toTimestampMs: null,
        schemaVersion: 2,
        includeUnpaired: false,
      },
    };

    const token = issueLegacyMatchReadCursorV1ForTests(
      claims,
      MATCH_NARRATIVE_CURSOR_PURPOSE,
      SECRET_A,
    );

    const decoded = decodeMatchNarrativeCursor(token, {
      secretMaterial: SECRET_A,
      expectedSurface: "subject_owner",
      nowMs: NOW + 1_000,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    expect(decoded.claims.version).toBe(1);
    // Joined member ids migrate into the digest space used by live keyset/sort.
    expect(decoded.claims.keyset.afterGroupId).toBe(
      digestNarrativeGroupMembers(["d:1", "c:2"]),
    );
    expect(decoded.claims.keyset.afterGroupId).not.toContain("|");
    // Compatibility defaults applied for fields V1 did not seal.
    expect(decoded.claims.filters.schemaVersion).toBe(2);
    expect(decoded.claims.filters.includeUnpaired).toBe(false);
    // V1 sealed fingerprint (old domain) is preserved, not recomputed to v2.
    expect(decoded.claims.filterFingerprint).not.toBe("placeholder");
    expect(decoded.claims.filterFingerprint.startsWith("sha256:")).toBe(true);
  });

  test("V1 wrong secret fails closed", () => {
    const claims: MatchTranscriptCursorClaims = {
      version: MATCH_READ_CURSOR_VERSION,
      purpose: MATCH_TRANSCRIPT_CURSOR_PURPOSE,
      keyVersion: MATCH_READ_CURSOR_KEY_VERSION,
      issuedAtMs: NOW,
      expiresAtMs: NOW + MATCH_READ_CURSOR_MAX_TTL_MS,
      subjectUserId: "user-1",
      gameId: "game-1",
      filterFingerprint: "sha256:x",
      ownershipFingerprint: "sha256:ownership-1",
      captureVersion: 1,
      mode: "snapshot",
      readThrough: {
        throughEntrySequence: 1,
        throughLegacyTimestamp: null,
        throughLegacyId: null,
      },
      keyset: {
        afterEntrySequence: null,
        afterLegacyTimestamp: null,
        afterLegacyId: null,
      },
      filters: emptyTranscriptFilters,
    };
    const token = issueLegacyMatchReadCursorV1ForTests(
      claims,
      MATCH_TRANSCRIPT_CURSOR_PURPOSE,
      SECRET_A,
    );
    expect(decodeMatchTranscriptCursor(token, {
      secretMaterial: SECRET_B,
      nowMs: NOW,
    })).toEqual({ status: "invalid" });
  });
});
