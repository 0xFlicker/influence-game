/**
 * Golden vectors for canonicalDialogueV2 and chained prefix digests.
 * Shared by checkpoint, recovery, and settlement callers — byte identity is sacred.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { Phase, type TranscriptEntry } from "@influence/engine";
import {
  CANONICAL_DIALOGUE_V2_DOMAIN,
  TRANSCRIPT_PREFIX_DIGEST_DOMAIN,
  TRANSCRIPT_PREFIX_DIGEST_EMPTY,
  canonicalDialogueV2Bytes,
  canonicalDialogueV2Json,
  chainPrefixDigest,
  computePrefixDigest,
  extractProductDialogueProjection,
  toCanonicalDialogueV2,
} from "../services/game-transcript-persistence.js";

function dialogue(partial: Partial<TranscriptEntry> & Pick<TranscriptEntry, "entrySequence" | "text">): TranscriptEntry {
  const {
    entrySequence,
    text,
    speakerPlayerId = "atlas",
    audiencePlayerIds = [],
    dialogueKind = "public_speech",
    dialogueContext = { version: 1 as const },
    ...rest
  } = partial;
  return {
    round: 1,
    phase: Phase.LOBBY,
    timestamp: 1_720_000_000_123.7,
    from: "Atlas",
    scope: "public",
    text,
    entrySequence,
    speakerPlayerId,
    audiencePlayerIds,
    dialogueKind,
    dialogueContext,
    ...rest,
  };
}

describe("canonicalDialogueV2 golden vectors", () => {
  test("empty predecessor digest matches U1 genesis constant", () => {
    const expected = `sha256:${createHash("sha256")
      .update("influence.transcript.prefix.v1:empty")
      .digest("hex")}`;
    expect(TRANSCRIPT_PREFIX_DIGEST_EMPTY as string).toBe(expected);
    expect(TRANSCRIPT_PREFIX_DIGEST_DOMAIN).toBe("influence.transcript.prefix.v1");
    expect(CANONICAL_DIALOGUE_V2_DOMAIN).toBe("influence.transcript.canonicalDialogueV2");
  });

  test("fixed field order, null normalization, millisecond truncate, audience sort", () => {
    const entry = dialogue({
      entrySequence: 1,
      text: "hello \"world\"",
      timestamp: 1_720_000_000_123.9,
      speakerPlayerId: null,
      audiencePlayerIds: ["mira", "atlas", "atlas", "echo"],
      dialogueKind: undefined,
      dialogueContext: {
        version: 1,
        roomId: 2,
        sessionAudiencePlayerIds: ["echo", "atlas"], // semantic order preserved
        allianceId: "ally-1",
      },
    });

    const canonical = toCanonicalDialogueV2(entry);
    expect(canonical.timestamp).toBe(1_720_000_000_123);
    expect(canonical.audiencePlayerIds).toEqual(["atlas", "echo", "mira"]);
    expect(canonical.dialogueKind).toBe("public_speech");
    expect(canonical.context).toEqual({
      version: 1,
      roomId: 2,
      allianceId: "ally-1",
      scheduleId: null,
      sessionId: null,
      window: null,
      sessionAudiencePlayerIds: ["echo", "atlas"],
    });

    const json = canonicalDialogueV2Json(canonical);
    // Fixed key order — not alphabetically sorted at the row level.
    expect(json.startsWith('{"sequence":1,"round":1,"phase":')).toBe(true);
    expect(json).toContain('"speakerPlayerId":null');
    expect(json).toContain('"audiencePlayerIds":["atlas","echo","mira"]');
    // Context keys alphabetical with explicit nulls.
    expect(json).toContain(
      '"context":{"allianceId":"ally-1","roomId":2,"scheduleId":null,"sessionAudiencePlayerIds":["echo","atlas"],"sessionId":null,"version":1,"window":null}',
    );

    // Golden byte length + hex digest of the canonical row alone.
    const bytes = canonicalDialogueV2Bytes(canonical);
    expect(bytes.toString("utf8")).toBe(json);
    const rowDigest = createHash("sha256").update(bytes).digest("hex");
    expect(rowDigest).toBe(
      createHash("sha256").update(Buffer.from(json, "utf8")).digest("hex"),
    );
  });

  test("length-prefixed chain from predecessor is domain-separated", () => {
    const entry = dialogue({ entrySequence: 1, text: "one" });
    const bytes = canonicalDialogueV2Bytes(toCanonicalDialogueV2(entry));
    const chained = chainPrefixDigest(TRANSCRIPT_PREFIX_DIGEST_EMPTY, bytes);

    const manual = createHash("sha256");
    manual.update("influence.transcript.prefix.v1");
    manual.update("\n");
    manual.update(TRANSCRIPT_PREFIX_DIGEST_EMPTY);
    manual.update("\n");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length);
    manual.update(len);
    manual.update(bytes);
    expect(chained).toBe(`sha256:${manual.digest("hex")}`);

    // Stable golden for the single-row chain.
    expect(chained).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computePrefixDigest([entry])).toBe(chained);
  });

  test("two-row chain is suffix-extendable from predecessor digest", () => {
    const a = dialogue({ entrySequence: 1, text: "a" });
    const b = dialogue({ entrySequence: 2, text: "b", scope: "mingle", audiencePlayerIds: ["echo"] });
    const full = computePrefixDigest([a, b]);
    const mid = computePrefixDigest([a]);
    const fromMid = computePrefixDigest([b], mid);
    expect(fromMid).toBe(full);
  });

  test("tampered text or audience changes the digest", () => {
    const base = dialogue({ entrySequence: 1, text: "base", audiencePlayerIds: ["atlas"] });
    const tamperedText = dialogue({ entrySequence: 1, text: "BASE", audiencePlayerIds: ["atlas"] });
    const tamperedAudience = dialogue({ entrySequence: 1, text: "base", audiencePlayerIds: ["echo"] });
    expect(computePrefixDigest([base])).not.toBe(computePrefixDigest([tamperedText]));
    expect(computePrefixDigest([base])).not.toBe(computePrefixDigest([tamperedAudience]));
  });

  test("absent cognition does not affect the digest", () => {
    const clean = dialogue({ entrySequence: 1, text: "said" });
    const withCognition: TranscriptEntry = {
      ...clean,
      thinking: "secret thoughts",
      reasoningContext: "provider raw",
    };
    expect(canonicalDialogueV2Json(toCanonicalDialogueV2(clean))).toBe(
      canonicalDialogueV2Json(toCanonicalDialogueV2(withCognition)),
    );
    expect(computePrefixDigest([clean])).toBe(computePrefixDigest([withCognition]));
  });

  test("extractProductDialogueProjection drops diary/thinking and sorts by sequence", () => {
    const entries: TranscriptEntry[] = [
      dialogue({ entrySequence: 2, text: "second" }),
      {
        round: 1,
        phase: Phase.LOBBY,
        timestamp: 1,
        from: "Atlas",
        scope: "diary",
        text: "private diary",
        speakerPlayerId: "atlas",
      },
      dialogue({ entrySequence: 1, text: "first" }),
    ];
    const product = extractProductDialogueProjection(entries);
    expect(product.map((e) => e.entrySequence)).toEqual([1, 2]);
  });
});
