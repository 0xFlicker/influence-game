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
      roster: [{ id: "a" }, { id: "b" }],
      config: {},
      continuity: {
        playerContinuityCapsules: [
          { playerId: "a", recentStrategicDecisions: [] },
          { playerId: "b", recentStrategicDecisions: [] },
        ],
      },
      historyCatalog: [
        {
          sourceId: "history:one",
          eligibleActorIds: ["a"],
          dialogueText: "private a",
        },
        {
          sourceId: "history:two",
          eligibleActorIds: ["b"],
          dialogueText: "private b",
        },
      ],
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

  it("refuses a call cap that would truncate the eligible catalog", () => {
    expect(() => buildCuratorManifest(caseValue, {
      model: "frontier-curator",
      maximumCalls: 1,
      maximumSpendUsd: 1,
      maxItemsPerPartition: 1,
    })).toThrow("complete eligible catalog");
  });
});
