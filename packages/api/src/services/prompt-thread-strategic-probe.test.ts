import { describe, expect, it } from "bun:test";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import {
  createPromptThreadWorkerHandshake,
  type PromptThreadIntentProbeWorkerResult,
} from "@influence/engine/prompt-thread-worker";
import {
  createManualEvidenceCard,
  freezeEvidenceCard,
} from "./prompt-thread-evidence-card.js";
import {
  comparePromptThreadStrategicProbes,
  type PromptThreadStrategicProbeRevision,
} from "./prompt-thread-strategic-probe.js";

const caseValue = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "frozen_case",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseId: `sha256:${"0".repeat(64)}`,
  sourceReceiptHash: `sha256:${"1".repeat(64)}`,
  privateData: {
    startingState: {
      historyCatalog: [
        {
          sourceId: "history:required",
          sequence: 10,
          eligibleActorIds: ["finn"],
        },
        {
          sourceId: "history:distractor",
          sequence: 11,
          eligibleActorIds: ["finn"],
        },
        {
          sourceId: "history:lyra",
          sequence: 12,
          eligibleActorIds: ["lyra"],
        },
      ],
    },
    traces: [
      { action: "mingle-intent", actorId: "finn" },
      { action: "mingle-intent", actorId: "lyra" },
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "lyra" },
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "lyra" },
    ],
  },
} satisfies FrozenCaseArtifact;

const evidence = createManualEvidenceCard(caseValue, [
  {
    sourceId: "history:required",
    classification: "required",
    applicableTurns: [1],
    rationale: "Finn needs the commitment",
  },
  {
    sourceId: "history:distractor",
    classification: "known_distractor",
    applicableTurns: [1],
    rationale: "Stale chatter",
  },
  {
    sourceId: "history:lyra",
    classification: "useful",
    applicableTurns: [2],
    rationale: "Lyra can use the prior signal",
  },
], new Date("2026-01-01T00:00:00.000Z"));
const approval = freezeEvidenceCard(
  caseValue,
  evidence,
  "producer",
  new Date("2026-01-01T00:00:01.000Z"),
) satisfies EvidenceCardApprovalArtifact;

const baseline: PromptThreadStrategicProbeRevision = {
  arm: "baseline",
  checkoutPath: "/baseline",
  commitSha: "base-sha",
  compilerPolicyDigest: "policy-base",
  harnessDigest: "harness",
};
const candidate: PromptThreadStrategicProbeRevision = {
  arm: "candidate",
  checkoutPath: "/candidate",
  commitSha: "candidate-sha",
  compilerPolicyDigest: "policy-candidate",
  harnessDigest: "harness",
};

function workerResult(
  revision: PromptThreadStrategicProbeRevision,
  selectedByActor: Record<string, string[]>,
): PromptThreadIntentProbeWorkerResult {
  const items = {
    finn: ["10", "11"],
    lyra: ["12"],
  };
  return {
    status: "completed",
    caseHash: hashCanonicalJson(caseValue),
    handshake: createPromptThreadWorkerHandshake({
      harnessDigest: revision.harnessDigest,
      compilerPolicyDigest: revision.compilerPolicyDigest,
      actionSchemaHash: "action-schema",
    }),
    probe: {
      version: 1,
      caseId: caseValue.caseId,
      providerCalls: 0,
      probes: ["finn", "lyra"].map((actorId) => ({
        action: "mingle-intent" as const,
        actorId,
        promptClass: "strategic_decision",
        laneSummary: {
          protectedCount: 4,
          hotCount: 0,
          authorizedHistoryCount: items[actorId as keyof typeof items].length,
          selectedHistoryCount: selectedByActor[actorId]?.length ?? 0,
        },
        budget: {
          envelopeChars: 16_000,
          historyBudgetChars: revision.arm === "candidate" ? 1_200 : 0,
          protectedChars: 17_000,
          hotChars: 2,
          historyChars: revision.arm === "candidate" ? 400 : 6,
        },
        items: items[actorId as keyof typeof items].map((sequence) => ({
          sourceId: `worker-local:${sequence}`,
          entrySequence: Number(sequence),
          terminalReason: selectedByActor[actorId]?.includes(sequence)
            ? "selected_history" as const
            : revision.arm === "baseline"
              ? "history_disabled" as const
              : "budget_excluded" as const,
        })),
      })),
    },
  };
}

describe("prompt-thread strategic probes", () => {
  it("reports an improved real-case selection when required/useful history is added without distractors", async () => {
    const result = await comparePromptThreadStrategicProbes({
      caseValue,
      evidenceDraft: evidence,
      evidenceApproval: approval,
      baseline,
      candidate,
      actionSchemaHash: "action-schema",
    }, {
      inspectCheckout: async (path) => ({
        commitSha: path === "/baseline" ? "base-sha" : "candidate-sha",
        dirty: false,
      }),
      computeHarnessDigest: async () => "harness",
      runProbe: async (revision) => (
        revision.arm === "baseline"
          ? workerResult(revision, {})
          : workerResult(revision, { finn: ["10"], lyra: ["12"] })
      ),
    });

    expect(result.providerCalls).toBe(0);
    expect(result.verdict).toBe("improved");
    expect(result.baseline).toMatchObject({
      requiredSelected: 0,
      usefulSelected: 0,
      distractorSelected: 0,
    });
    expect(result.candidate).toMatchObject({
      requiredSelected: 1,
      usefulSelected: 1,
      distractorSelected: 0,
    });
    expect(result.probes).toHaveLength(4);
    expect(result.probes
      .filter(({ arm }) => arm === "candidate")
      .flatMap(({ evidence: probeEvidence }) => (
        probeEvidence.map(({ sourceId }) => sourceId)
      ))).toEqual([
      "history:required",
      "history:distractor",
      "history:lyra",
    ]);
  });

  it("fails closed for invalid strategic probe worker results", async () => {
    const common = {
      caseValue,
      evidenceDraft: evidence,
      evidenceApproval: approval,
      baseline,
      candidate,
      actionSchemaHash: "action-schema",
    };
    const invalidResults: Array<{
      label: string;
      create: (
        revision: PromptThreadStrategicProbeRevision,
      ) => PromptThreadIntentProbeWorkerResult;
    }> = [
      {
        label: "handshake",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            handshake: {
              ...result.handshake,
              harnessDigest: "wrong-harness",
            },
          };
        },
      },
      {
        label: "case hash",
        create: (revision) => ({
          ...workerResult(revision, {}),
          caseHash: `sha256:${"8".repeat(64)}`,
        }),
      },
      {
        label: "probe case",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            probe: {
              ...result.probe,
              caseId: `sha256:${"7".repeat(64)}`,
            },
          };
        },
      },
      {
        label: "provider calls",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            probe: {
              ...result.probe,
              providerCalls: 1,
            },
          } as unknown as PromptThreadIntentProbeWorkerResult;
        },
      },
      {
        label: "probe shape",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            probe: {
              ...result.probe,
              probes: result.probe.probes.slice(0, 1),
            },
          };
        },
      },
      {
        label: "probe order",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            probe: {
              ...result.probe,
              probes: result.probe.probes.toReversed(),
            },
          };
        },
      },
      {
        label: "probe action",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            probe: {
              ...result.probe,
              probes: result.probe.probes.map((probe, index) => (
                index === 0 ? { ...probe, action: "mingle-turn" } : probe
              )),
            },
          } as unknown as PromptThreadIntentProbeWorkerResult;
        },
      },
      {
        label: "probe class",
        create: (revision) => {
          const result = workerResult(revision, {});
          return {
            ...result,
            probe: {
              ...result.probe,
              probes: result.probe.probes.map((probe, index) => (
                index === 0
                  ? { ...probe, promptClass: "ordinary_speech" }
                  : probe
              )),
            },
          } as unknown as PromptThreadIntentProbeWorkerResult;
        },
      },
    ];

    for (const invalid of invalidResults) {
      await expect(comparePromptThreadStrategicProbes(common, {
        inspectCheckout: async (path) => ({
          commitSha: path === "/baseline" ? "base-sha" : "candidate-sha",
          dirty: false,
        }),
        computeHarnessDigest: async () => "harness",
        runProbe: async (revision) => invalid.create(revision),
      }), invalid.label).rejects.toThrow();
    }
  });

  it("refuses dirty, SHA-drifted, harness-drifted, and identical-policy comparisons", async () => {
    const common = {
      caseValue,
      evidenceDraft: evidence,
      evidenceApproval: approval,
      baseline,
      candidate,
      actionSchemaHash: "action-schema",
    };
    const runProbe = async (revision: PromptThreadStrategicProbeRevision) => (
      workerResult(revision, {})
    );
    await expect(comparePromptThreadStrategicProbes(common, {
      inspectCheckout: async () => ({ commitSha: "wrong", dirty: true }),
      computeHarnessDigest: async () => "harness",
      runProbe,
    })).rejects.toThrow("dirty or SHA-mismatched");
    await expect(comparePromptThreadStrategicProbes(common, {
      inspectCheckout: async (path) => ({
        commitSha: path === "/baseline" ? "base-sha" : "candidate-sha",
        dirty: false,
      }),
      computeHarnessDigest: async () => "different",
      runProbe,
    })).rejects.toThrow("harness");
    await expect(comparePromptThreadStrategicProbes({
      ...common,
      candidate: {
        ...candidate,
        compilerPolicyDigest: baseline.compilerPolicyDigest,
      },
    }, {
      inspectCheckout: async (path) => ({
        commitSha: path === "/baseline" ? "base-sha" : "candidate-sha",
        dirty: false,
      }),
      computeHarnessDigest: async () => "harness",
      runProbe,
    })).rejects.toThrow("policy delta");
  });

  it("does not call an unscored or all-disabled comparison improved", async () => {
    const unscored = createManualEvidenceCard(caseValue, []);
    const unscoredApproval = freezeEvidenceCard(caseValue, unscored, "producer");
    const result = await comparePromptThreadStrategicProbes({
      caseValue,
      evidenceDraft: unscored,
      evidenceApproval: unscoredApproval,
      baseline,
      candidate,
      actionSchemaHash: "action-schema",
    }, {
      inspectCheckout: async (path) => ({
        commitSha: path === "/baseline" ? "base-sha" : "candidate-sha",
        dirty: false,
      }),
      computeHarnessDigest: async () => "harness",
      runProbe: async (revision) => workerResult(revision, {}),
    });
    expect(result.verdict).toBe("inconclusive");
  });

  it("treats distractor-only evidence as scored", async () => {
    const distractorOnly = createManualEvidenceCard(caseValue, [
      {
        sourceId: "history:distractor",
        classification: "known_distractor",
        applicableTurns: [1],
        rationale: "Stale chatter",
      },
    ]);
    const distractorApproval = freezeEvidenceCard(
      caseValue,
      distractorOnly,
      "producer",
    );
    const result = await comparePromptThreadStrategicProbes({
      caseValue,
      evidenceDraft: distractorOnly,
      evidenceApproval: distractorApproval,
      baseline,
      candidate,
      actionSchemaHash: "action-schema",
    }, {
      inspectCheckout: async (path) => ({
        commitSha: path === "/baseline" ? "base-sha" : "candidate-sha",
        dirty: false,
      }),
      computeHarnessDigest: async () => "harness",
      runProbe: async (revision) => (
        revision.arm === "baseline"
          ? workerResult(revision, { finn: ["11"] })
          : workerResult(revision, {})
      ),
    });

    expect(result.verdict).toBe("improved");
    expect(result.baseline.distractorSelected).toBe(1);
    expect(result.candidate.distractorSelected).toBe(0);
  });
});
