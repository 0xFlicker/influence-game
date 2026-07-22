import { describe, expect, test } from "bun:test";
import {
  groupNarrativeMembers,
  type NarrativeCognitionMemberInput,
  type NarrativeDialogueMemberInput,
} from "../services/match-narrative-grouping.js";

function dialogue(
  overrides: Partial<NarrativeDialogueMemberInput> & Pick<NarrativeDialogueMemberInput, "rowId" | "text">,
): NarrativeDialogueMemberInput {
  return {
    kind: "dialogue",
    entrySequence: 1,
    timestampMs: 1_000,
    actorPlayerId: "p1",
    actorName: "Vesper",
    phase: "mingle",
    round: 1,
    scope: "mingle",
    dialogueKind: "mingle_speech",
    decisionId: null,
    eventSequence: null,
    ...overrides,
  };
}

function cognition(
  overrides: Partial<NarrativeCognitionMemberInput> &
    Pick<NarrativeCognitionMemberInput, "artifactId" | "kind">,
): NarrativeCognitionMemberInput {
  return {
    createdAtMs: 1_050,
    actorPlayerId: "p1",
    actorName: "Vesper",
    phase: "mingle",
    round: 1,
    action: "mingle-turn",
    decisionId: null,
    eventSequence: null,
    prose:
      overrides.kind === "thinking"
        ? { thinking: "I should probe Finn." }
        : {
            decisionLog: "Test Finn loyalty.",
            strategicLens: "coalition_shape",
            strategyPacketRevision: "r1",
            strategyPacketSummary: { objective: "Hold Mira" },
          },
    ...overrides,
  };
}

describe("groupNarrativeMembers", () => {
  test("exact decisionId groups thinking, strategy, and dialogue", () => {
    const decisionId = "dec-1";
    const result = groupNarrativeMembers({
      members: [
        dialogue({ rowId: 1, text: "Hello room", decisionId, entrySequence: 2 }),
        cognition({ artifactId: "a1", kind: "thinking", decisionId }),
        cognition({ artifactId: "a2", kind: "strategy", decisionId, createdAtMs: 1_040 }),
      ],
      preset: "full_cognition",
      detail: "full",
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.correlation.kind).toBe("decision_id");
    expect(result.groups[0]!.decisionId).toBe(decisionId);
    expect(result.groups[0]!.members.map((m) => m.kind).sort()).toEqual([
      "dialogue",
      "strategy",
      "thinking",
    ]);
    expect(result.correlationSummary.exact).toBe(1);
    expect(result.contentTrust).toBe("untrusted_game_authored");
  });

  test("strategic preset omits thinking members", () => {
    const decisionId = "dec-2";
    const result = groupNarrativeMembers({
      members: [
        dialogue({ rowId: 1, text: "Hi", decisionId }),
        cognition({ artifactId: "t1", kind: "thinking", decisionId }),
        cognition({ artifactId: "s1", kind: "strategy", decisionId }),
      ],
      preset: "strategic",
      detail: "full",
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.members.map((m) => m.kind).sort()).toEqual([
      "dialogue",
      "strategy",
    ]);
  });

  test("dialogue_only drops cognition", () => {
    const result = groupNarrativeMembers({
      members: [
        dialogue({ rowId: 1, text: "Only speech" }),
        cognition({ artifactId: "s1", kind: "strategy" }),
      ],
      preset: "dialogue_only",
      detail: "full",
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.members).toHaveLength(1);
    expect(result.groups[0]!.members[0]!.kind).toBe("dialogue");
  });

  test("inferred unique soft match joins dialogue and strategy", () => {
    const result = groupNarrativeMembers({
      members: [
        dialogue({ rowId: 1, text: "Speech", timestampMs: 5_000, entrySequence: 1 }),
        cognition({
          artifactId: "s1",
          kind: "strategy",
          createdAtMs: 5_100,
        }),
      ],
      preset: "strategic",
      detail: "full",
      inferenceWindowMs: 500,
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.correlation.kind).toBe("inferred");
    expect(result.groups[0]!.correlation.basis).toBe("actor_phase_round_time");
    expect(result.correlationSummary.inferred).toBe(1);
  });

  test("multi-match inference stays uncorrelated", () => {
    const result = groupNarrativeMembers({
      members: [
        dialogue({ rowId: 1, text: "Speech", timestampMs: 5_000 }),
        cognition({ artifactId: "s1", kind: "strategy", createdAtMs: 5_050 }),
        cognition({ artifactId: "s2", kind: "strategy", createdAtMs: 5_080 }),
      ],
      preset: "strategic",
      detail: "full",
      inferenceWindowMs: 500,
      includeUnpaired: true,
    });

    expect(result.groups.every((g) => g.correlation.kind === "uncorrelated")).toBe(true);
    expect(result.correlationSummary.uncorrelated).toBe(3);
  });

  test("never soft-joins across different actor seats", () => {
    const result = groupNarrativeMembers({
      members: [
        dialogue({
          rowId: 1,
          text: "P1 speech",
          actorPlayerId: "p1",
          timestampMs: 5_000,
        }),
        cognition({
          artifactId: "s1",
          kind: "strategy",
          actorPlayerId: "p2",
          actorName: "Other",
          createdAtMs: 5_050,
        }),
      ],
      preset: "strategic",
      detail: "full",
      inferenceWindowMs: 500,
      includeUnpaired: true,
    });

    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((g) => g.correlation.kind === "uncorrelated")).toBe(true);
  });

  test("exact decisionId with mixed actors splits with limitation", () => {
    const decisionId = "dec-mixed";
    const result = groupNarrativeMembers({
      members: [
        dialogue({
          rowId: 1,
          text: "A",
          decisionId,
          actorPlayerId: "p1",
        }),
        cognition({
          artifactId: "s1",
          kind: "strategy",
          decisionId,
          actorPlayerId: "p2",
          actorName: "Other",
        }),
      ],
      preset: "strategic",
      detail: "full",
      includeUnpaired: true,
    });

    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((g) => g.correlation.kind === "uncorrelated")).toBe(true);
    expect(result.limitations.some((l) => l.code === "correlation_actor_mismatch")).toBe(true);
  });

  test("compact truncates long dialogue text", () => {
    const long = "x".repeat(500);
    const result = groupNarrativeMembers({
      members: [dialogue({ rowId: 1, text: long })],
      preset: "dialogue_only",
      detail: "compact",
      compactDialogueMaxChars: 50,
    });

    expect(result.groups[0]!.members[0]!.truncated).toBe(true);
    expect(String(result.groups[0]!.members[0]!.fields.text).endsWith("…")).toBe(true);
    expect(result.limitations.some((l) => l.code === "oversized_member_truncated")).toBe(true);
  });

  test("sparse strategy-only groups are retained when includeUnpaired", () => {
    const result = groupNarrativeMembers({
      members: [cognition({ artifactId: "s1", kind: "strategy", decisionId: "dec-solo" })],
      preset: "strategic",
      detail: "full",
      includeUnpaired: true,
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.members[0]!.kind).toBe("strategy");
    expect(result.groups[0]!.correlation.kind).toBe("decision_id");
    expect(result.correlationSummary.idStampedSingleton).toBe(1);
    expect(result.correlationSummary.exactCrossLane).toBe(0);
  });

  test("strategic default omits unpaired strategy", () => {
    const result = groupNarrativeMembers({
      members: [
        dialogue({ rowId: 1, text: "hi", decisionId: "dec-pair" }),
        cognition({ artifactId: "s1", kind: "strategy", decisionId: "dec-pair" }),
        cognition({ artifactId: "s2", kind: "strategy", decisionId: "dec-solo" }),
      ],
      preset: "strategic",
      detail: "full",
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.decisionId).toBe("dec-pair");
    expect(result.correlationSummary.unpairedOmitted).toBe(1);
    expect(result.correlationSummary.exactCrossLane).toBe(1);
  });

  test("members do not restate contentTrust", () => {
    const result = groupNarrativeMembers({
      members: [dialogue({ rowId: 1, text: "hi" })],
      preset: "strategic",
      detail: "full",
    });

    expect(result.groups[0]!.members[0]!.fields.contentTrust).toBeUndefined();
    expect(result.contentTrust).toBe("untrusted_game_authored");
  });

  test("relatedActionRefs soft-derived from cognition eventSequence", () => {
    const result = groupNarrativeMembers({
      members: [
        cognition({
          artifactId: "s1",
          kind: "strategy",
          eventSequence: 42,
          action: "vote",
          phase: "vote",
          round: 2,
        }),
      ],
      preset: "strategic",
      detail: "full",
    });

    expect(result.groups[0]!.relatedActionRefs).toEqual([
      {
        eventSequence: 42,
        phase: "vote",
        round: 2,
        action: "vote",
      },
    ]);
  });
});
