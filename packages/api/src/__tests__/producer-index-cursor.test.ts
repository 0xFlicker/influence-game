import { describe, expect, test } from "bun:test";
import {
  bindProducerIndexCursor,
  decodeProducerIndexCursor,
  issueProducerIndexCursor,
  PRODUCER_INDEX_CURSOR_MAX_TOKEN_CHARS,
} from "../services/producer-index-cursor.js";

const SECRET = "producer-index-cursor-test-secret";
const NOW = Date.parse("2026-08-19T12:00:00.000Z");

describe("producer index cursor", () => {
  test("seals snapshot claims and rejects tampering, wrong kind, and expiry", () => {
    const filters = { artifactType: "thinking" as const, actorPlayerId: "player-1" };
    const token = issueProducerIndexCursor({
      kind: "cognitive_artifact",
      bindingFingerprint: "producer-binding",
      gameId: "game-secret",
      filters,
      databaseSnapshot: "100:100:",
      readThrough: { createdAt: "2026-08-19T11:59:00.000Z", id: "row-z" },
      keyset: { createdAt: "2026-08-19T11:58:00.000Z", id: "row-m" },
      totalCount: 23,
      nowMs: NOW,
      ttlMs: 60_000,
    }, SECRET);

    expect(token).toStartWith("pi1.");
    expect(token).not.toContain("game-secret");
    expect(token).not.toContain("player-1");
    const decoded = decodeProducerIndexCursor(token, {
      expectedKind: "cognitive_artifact",
      secretMaterial: SECRET,
      nowMs: NOW + 1,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    expect(decoded.claims).toMatchObject({
      gameId: "game-secret",
      filters,
      databaseSnapshot: "100:100:",
      totalCount: 23,
    });
    expect(bindProducerIndexCursor({
      claims: decoded.claims,
      kind: "cognitive_artifact",
      bindingFingerprint: "producer-binding",
      gameId: "game-secret",
      filters,
    })).toBe(true);
    expect(bindProducerIndexCursor({
      claims: decoded.claims,
      kind: "cognitive_artifact",
      bindingFingerprint: "producer-binding",
      gameId: "another-game",
      filters,
    })).toBe(false);

    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(decodeProducerIndexCursor(tampered, {
      expectedKind: "cognitive_artifact",
      secretMaterial: SECRET,
      nowMs: NOW + 1,
    })).toEqual({ status: "invalid" });
    for (const suffix of ["=", "!!!", " "]) {
      expect(decodeProducerIndexCursor(`${token}${suffix}`, {
        expectedKind: "cognitive_artifact",
        secretMaterial: SECRET,
        nowMs: NOW + 1,
      })).toEqual({ status: "invalid" });
    }
    expect(decodeProducerIndexCursor(token, {
      expectedKind: "private_trace",
      secretMaterial: SECRET,
      nowMs: NOW + 1,
    })).toEqual({ status: "invalid" });
    expect(decodeProducerIndexCursor(token, {
      expectedKind: "cognitive_artifact",
      secretMaterial: SECRET,
      nowMs: NOW + 60_001,
    })).toEqual({ status: "invalid" });
  });

  test("seals private trace snapshot linkage for bounded continuation reads", () => {
    const traceLinkageSummary = {
      trustedCanonicalPrefixStatus: "complete" as const,
      eligibleAcceptedDecisionCount: 8,
      linkedAcceptedDecisionCount: 6,
      degradedAcceptedDecisionCount: 2,
      intentionallyUnlinkedTraceCount: 3,
      unclassifiedTraceCount: 1,
    };
    const token = issueProducerIndexCursor({
      kind: "private_trace",
      bindingFingerprint: "trace-producer-binding",
      gameId: "trace-game",
      filters: { artifactType: null, actorPlayerId: null },
      databaseSnapshot: "101:103:102",
      readThrough: { createdAt: "2026-08-19T11:59:00.000Z", id: "trace-z" },
      keyset: { createdAt: "2026-08-19T11:58:00.000Z", id: "trace-m" },
      totalCount: 31,
      traceLinkageSummary,
      nowMs: NOW,
    }, SECRET);

    const decoded = decodeProducerIndexCursor(token, {
      expectedKind: "private_trace",
      secretMaterial: SECRET,
      nowMs: NOW + 1,
    });
    expect(decoded.status).toBe("ok");
    if (decoded.status !== "ok") return;
    expect(decoded.claims.traceLinkageSummary).toEqual(traceLinkageSummary);
  });

  test("round-trips a maximum-size accepted database snapshot within the token bound", () => {
    const databaseSnapshot = `1000000000:2000000000:${Array.from(
      { length: 90 },
      (_, index) => 1_100_000_000 + index,
    ).join(",")}`;
    expect(databaseSnapshot.length).toBeLessThanOrEqual(1024);
    const token = issueProducerIndexCursor({
      kind: "cognitive_artifact",
      bindingFingerprint: "producer-binding",
      gameId: "00000000-0000-4000-8000-000000000001",
      filters: { artifactType: "thinking", actorPlayerId: "player-1" },
      databaseSnapshot,
      readThrough: { createdAt: "2026-08-19T11:59:00.000Z", id: "row-z" },
      keyset: { createdAt: "2026-08-19T11:58:00.000Z", id: "row-m" },
      totalCount: 23,
      nowMs: NOW,
    }, SECRET);

    expect(token.length).toBeLessThanOrEqual(PRODUCER_INDEX_CURSOR_MAX_TOKEN_CHARS);
    expect(decodeProducerIndexCursor(token, {
      expectedKind: "cognitive_artifact",
      secretMaterial: SECRET,
      nowMs: NOW + 1,
    })).toMatchObject({ status: "ok", claims: { databaseSnapshot } });
  });
});
