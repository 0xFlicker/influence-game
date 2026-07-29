import { describe, expect, it } from "bun:test";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import {
  applyCuratorResponses,
  approveCuratorManifest,
  assertEvidenceCardApproval,
  buildCuratorManifest,
  completeCuratorCard,
  createManualEvidenceCard,
  freezeEvidenceCard,
  validateEvidenceCard,
} from "./prompt-thread-evidence-card.js";

const caseValue = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "frozen_case",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseId: `sha256:${"0".repeat(64)}`,
  sourceReceiptHash: `sha256:${"1".repeat(64)}`,
  privateData: {
    startingState: {
      canonicalProjection: { round: 4 },
      roster: [
        {
          id: "a",
          displayName: "Alpha",
          userId: "user-a",
          agentProfileId: "profile-a",
          agentRevisionId: "revision-a",
          persona: { name: "Alpha", secret: "PERSONA_A_SENTINEL" },
          agentConfig: { model: "AGENT_CONFIG_A_SENTINEL" },
        },
        {
          id: "b",
          displayName: "Beta",
          userId: "user-b",
          agentProfileId: "profile-b",
          agentRevisionId: "revision-b",
          persona: { name: "Beta", secret: "PERSONA_B_SENTINEL" },
          agentConfig: { model: "AGENT_CONFIG_B_SENTINEL" },
        },
      ],
      config: {},
      continuity: {
        playerContinuityCapsules: [
          { playerId: "a", recentStrategicDecisions: [] },
          { playerId: "b", recentStrategicDecisions: [] },
        ],
      },
      historyCatalog: [
        {
          sourceId: "prelude:one",
          lane: "prelude",
          eligibleActorIds: ["a"],
          dialogueText: "fixed private prelude",
        },
        {
          sourceId: "history:one",
          lane: "history",
          eligibleActorIds: ["a"],
          dialogueText: "private a",
        },
        {
          sourceId: "history:two",
          lane: "history",
          eligibleActorIds: ["b"],
          dialogueText: "private b",
        },
      ],
      lanes: {
        prelude: [{
          sourceId: "prelude:one",
          lane: "prelude",
          eligibleActorIds: ["a"],
          dialogueText: "fixed private prelude",
        }],
      },
    },
    traces: [
      { action: "mingle-intent", actorId: "a" },
      { action: "mingle-intent", actorId: "b" },
      { action: "mingle-turn", actorId: "a" },
      { action: "mingle-turn", actorId: "b" },
      { action: "mingle-turn", actorId: "a" },
      { action: "mingle-turn", actorId: "b" },
    ],
  },
} as FrozenCaseArtifact;

describe("prompt thread evidence cards", () => {
  it("creates a complete provider-free manual card and freezes a separate approval", () => {
    const draft = createManualEvidenceCard(caseValue, [{
      sourceId: "history:one",
      classification: "required",
      applicableTurns: [1, 3],
      rationale: "commitment",
    }]);
    expect(draft.items).toHaveLength(2);
    expect(draft.items[1]?.classification).toBe("unscored");
    const approval = freezeEvidenceCard(caseValue, draft, "producer");
    expect(approval.kind).toBe("evidence_card_approval");
    expect(() => assertEvidenceCardApproval(caseValue, draft, approval)).not.toThrow();
    expect(() => assertEvidenceCardApproval(caseValue, {
      ...draft,
      items: draft.items.map((item) => ({ ...item, rationale: `${item.rationale}!` })),
    }, approval)).toThrow("stale");
  });

  it("rejects stale, foreign, duplicate, and actor-ineligible citations", () => {
    const draft = createManualEvidenceCard(caseValue, [{
      sourceId: "history:one",
      classification: "useful",
      applicableTurns: [1],
      rationale: "signal",
    }]);
    expect(() => validateEvidenceCard(caseValue, {
      ...draft,
      caseHash: "sha256:stale",
    })).toThrow("stale");
    expect(() => completeCuratorCard(caseValue, [{
      sourceId: "foreign",
      classification: "useful",
      applicableTurns: [],
      rationale: "foreign",
    }])).toThrow("unknown");
    expect(() => validateEvidenceCard(caseValue, {
      ...draft,
      items: draft.items.map((item) => item.sourceId === "history:one"
        ? { ...item, applicableTurns: [2] }
        : item),
    })).toThrow("not eligible");
  });

  it("partitions the complete catalog and applies saved responses without redispatch", () => {
    const manifest = buildCuratorManifest(caseValue, {
      model: "frontier-curator",
      maximumCalls: 2,
      maximumSpendUsd: 1,
      maxItemsPerPartition: 1,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(manifest.partitions.map(({ partitionId }) => partitionId))
      .toEqual(["a:001", "b:001"]);
    expect(manifest.partitions.flatMap(({ sourceIds }) => sourceIds))
      .toEqual(["history:one", "history:two"]);
    expect(JSON.stringify(manifest)).not.toContain("variant");
    const approval = approveCuratorManifest(
      manifest,
      "producer",
      new Date("2026-01-01T00:00:01.000Z"),
    );
    const draft = applyCuratorResponses(caseValue, manifest, approval, [
      {
        partitionId: "a:001",
        items: [{
          sourceId: "history:one",
          classification: "required",
          applicableTurns: [1, 3],
          rationale: "a commitment",
        }],
      },
      {
        partitionId: "b:001",
        items: [],
      },
    ]);
    expect(draft.provenance).toBe("curator");
    expect(draft.items.map(({ classification }) => classification))
      .toEqual(["required", "unscored"]);
    expect(() => applyCuratorResponses(caseValue, {
      ...manifest,
      maximumSpendUsd: 2,
    }, approval, [])).toThrow("stale");
  });

  it("keeps prelude protected and serializes only the curator-safe roster identity", () => {
    const manifest = buildCuratorManifest(caseValue, {
      model: "frontier-curator",
      maximumCalls: 2,
      maximumSpendUsd: 1,
      maxItemsPerPartition: 1,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const actorAContext = manifest.partitions.find(({ actorId }) => actorId === "a")
      ?.privateContext;

    expect(actorAContext).toMatchObject({
      roster: [
        { id: "a", displayName: "Alpha" },
        { id: "b", displayName: "Beta" },
      ],
      prelude: [{
        sourceId: "prelude:one",
        lane: "prelude",
        eligibleActorIds: ["a"],
        dialogueText: "fixed private prelude",
      }],
    });
    expect(actorAContext?.roster).toEqual([
      { id: "a", displayName: "Alpha" },
      { id: "b", displayName: "Beta" },
    ]);
    expect(manifest.partitions.find(({ actorId }) => actorId === "b")
      ?.privateContext.prelude).toEqual([]);
    expect(manifest.privateDataClasses).toEqual([
      "canonical_facts",
      "typed_strategic_receipts",
      "canonical_roster_player_ids_and_display_names",
      "game_config",
      "actor_owned_continuity",
      "fixed_prelude",
      "public_dialogue",
      "actor_owned_private_dialogue",
    ]);
    const serialized = JSON.stringify(manifest);
    for (const forbidden of [
      "userId",
      "agentProfileId",
      "agentRevisionId",
      "persona",
      "agentConfig",
      "PERSONA_A_SENTINEL",
      "AGENT_CONFIG_A_SENTINEL",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("refuses a call cap that would truncate the eligible catalog", () => {
    expect(() => buildCuratorManifest(caseValue, {
      model: "frontier-curator",
      maximumCalls: 1,
      maximumSpendUsd: 1,
      maxItemsPerPartition: 1,
    })).toThrow("complete eligible catalog");
  });

  it("merges actor-partition scores for a shared public source", () => {
    const sharedCase = structuredClone(caseValue);
    const startingState = sharedCase.privateData.startingState as {
      historyCatalog: Array<Record<string, unknown>>;
    };
    startingState.historyCatalog.push({
      sourceId: "history:shared",
      eligibleActorIds: ["a", "b"],
      dialogueText: "public signal",
    });
    const manifest = buildCuratorManifest(sharedCase, {
      model: "frontier-curator",
      maximumCalls: 4,
      maximumSpendUsd: 1,
      maxItemsPerPartition: 2,
    });
    const approval = approveCuratorManifest(manifest, "producer");
    const responses = manifest.partitions.map((partition) => ({
      partitionId: partition.partitionId,
      items: partition.sourceIds.flatMap((sourceId) => (
        sourceId === "history:shared"
          ? [{
              sourceId,
              classification: partition.actorId === "a"
                ? "required" as const
                : "useful" as const,
              applicableTurns: partition.actorId === "a" ? [1] : [2],
              rationale: `signal for ${partition.actorId}`,
            }]
          : []
      )),
    }));
    const draft = applyCuratorResponses(
      sharedCase,
      manifest,
      approval,
      responses,
    );
    expect(draft.items.find(({ sourceId }) => sourceId === "history:shared"))
      .toEqual({
        sourceId: "history:shared",
        classification: "required",
        applicableTurns: [1, 2],
        rationale: "signal for a | signal for b",
      });
  });
});
