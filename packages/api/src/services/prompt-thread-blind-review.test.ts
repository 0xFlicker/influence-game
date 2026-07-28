import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import {
  createPromptThreadWorkerHandshake,
  runPromptThreadWorker,
} from "@influence/engine/prompt-thread-worker";
import {
  buildPromptThreadReportFromRun,
  createPromptThreadBlindArtifacts,
  initializePromptThreadBlindReview,
  promptThreadBlindReviewStatus,
  recordPromptThreadBlindDecision,
  renderPromptThreadBlindPacket,
  unblindPromptThreadReview,
  type BlindConversationBranch,
} from "./prompt-thread-blind-review.js";
import { createPrivateWorkspace } from "./prompt-thread-workspace.js";
import {
  approvePromptThreadPanel,
  createPromptThreadPanelManifest,
  initializePromptThreadPanelRun,
  runPromptThreadPanel,
  type RunPanelDependencies,
} from "./prompt-thread-panel.js";
import type { PromptThreadEvidenceCard } from "./prompt-thread-evidence-card.js";

function branches(): BlindConversationBranch[] {
  return [1, 2, 3].flatMap((repetition) => (
    (["baseline", "candidate"] as const).map((arm) => ({
      repetition,
      arm,
      turns: [1, 2, 3, 4].map((turn) => ({
        turn,
        actor: turn % 2 ? "finn" as const : "lyra" as const,
        message: `${arm === "baseline" ? "red" : "blue"} private message ${repetition}.${turn}`,
        noReply: false,
        gotoRoomId: null,
        gotoPlayerName: null,
        coordinationReceipt: null,
        evidenceReferences: [`history:${turn}`],
      })),
    }))
  ));
}

describe("prompt-thread blind review", () => {
  it("renders three anonymous pairs without variant or economic metadata", () => {
    const { packet, key } = createPromptThreadBlindArtifacts(
      `sha256:${"1".repeat(64)}`,
      branches(),
      { seed: "blind-seed", now: new Date("2026-01-01T00:00:00.000Z") },
    );
    expect(packet.pairs).toHaveLength(3);
    expect(key.packetHash).toBe(hashCanonicalJson(packet));
    const serialized = JSON.stringify(packet);
    for (const keyName of [
      "baseline",
      "candidate",
      "\"arm\"",
      "\"model\"",
      "\"commit\"",
      "\"cache\"",
      "\"cost\"",
      "\"thinking\"",
      "\"reasoningContext\"",
    ]) {
      expect(serialized).not.toContain(keyName);
    }
    const rendered = renderPromptThreadBlindPacket(packet);
    expect(rendered).toContain("### A");
    expect(rendered).toContain("### B");
    expect(rendered).toContain("evidence=history:1");
    expect(rendered).not.toContain("unblinding");
  });

  it("randomizes pair ordering without changing conversation content", () => {
    const first = createPromptThreadBlindArtifacts("sha256:card", branches(), {
      seed: "one",
    });
    let second = createPromptThreadBlindArtifacts("sha256:card", branches(), {
      seed: "two",
    });
    for (let index = 3; JSON.stringify(first.packet.pairs) === JSON.stringify(second.packet.pairs); index += 1) {
      second = createPromptThreadBlindArtifacts("sha256:card", branches(), {
        seed: String(index),
      });
    }
    const messages = (artifact: typeof first.packet) => (
      JSON.stringify(artifact.pairs)
        .match(/(?:red|blue) private message \d\.\d/g)
        ?.sort()
    );
    expect(messages(first.packet)).toEqual(messages(second.packet));
    expect(first.packet.pairs).not.toEqual(second.packet.pairs);
  });

  it("locks one decision per token and refuses unblind until all three exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-blind-"));
    try {
      const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
      const { packet, key } = createPromptThreadBlindArtifacts(
        "sha256:card",
        branches(),
        { seed: "decisions" },
      );
      const tokens = (packet.pairs as Array<{ pairToken: string }>)
        .map(({ pairToken }) => pairToken);
      await recordPromptThreadBlindDecision(workspace, "run-one", packet, {
        pairToken: tokens[0]!,
        choice: "A",
        reviewer: "producer",
        reasons: { strategy: "Clearer plan" },
      });
      expect(await promptThreadBlindReviewStatus(workspace, "run-one", packet))
        .toMatchObject({
          lifecycle: "review_in_progress",
          completedPairTokens: [tokens[0]],
        });
      await expect(recordPromptThreadBlindDecision(workspace, "run-one", packet, {
        pairToken: tokens[0]!,
        choice: "B",
        reviewer: "producer",
      })).rejects.toThrow("already exists");
      await expect(unblindPromptThreadReview(workspace, "run-one", packet, key))
        .rejects.toThrow();
      await recordPromptThreadBlindDecision(workspace, "run-one", packet, {
        pairToken: tokens[1]!,
        choice: "B",
        reviewer: "producer",
      });
      await recordPromptThreadBlindDecision(workspace, "run-one", packet, {
        pairToken: tokens[2]!,
        choice: "no_preference",
        reviewer: "producer",
      });
      expect(await promptThreadBlindReviewStatus(workspace, "run-one", packet))
        .toMatchObject({ lifecycle: "reviewed", outstandingPairTokens: [] });
      const unblinded = await unblindPromptThreadReview(
        workspace,
        "run-one",
        packet,
        key,
      );
      expect(unblinded.revealedDecisions).toHaveLength(3);
      expect(unblinded.revealedDecisions.filter(
        (decision) => decision.preferredArm === null,
      )).toHaveLength(1);
      expect(unblinded.revealedDecisions[0]).toMatchObject({
        reasons: { strategy: "Clearer plan" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds the four-verdict report only after a complete blind lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-report-run-"));
    try {
      const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
      const manifest = await reportManifest();
      const approval = approvePromptThreadPanel(manifest, "producer");
      await initializePromptThreadPanelRun(workspace, manifest, approval);
      const result = await runPromptThreadPanel(
        workspace,
        manifest,
        approval,
        reportCase,
        reportEvidence,
        reportEvidenceApproval,
        reportRunner(manifest),
      );
      expect(result.lifecycle).toBe("completed");
      const { packet, key } = await initializePromptThreadBlindReview(
        workspace,
        manifest,
        reportEvidence,
        { seed: "integrated-report" },
      );
      const tokens = (packet.pairs as Array<{ pairToken: string }>)
        .map(({ pairToken }) => pairToken);
      for (const [index, pairToken] of tokens.entries()) {
        await recordPromptThreadBlindDecision(workspace, manifest.runId, packet, {
          pairToken,
          choice: index < 2 ? "A" : "no_preference",
          reviewer: "producer",
        });
      }
      const unblinded = await unblindPromptThreadReview(
        workspace,
        manifest.runId,
        packet,
        key,
      );
      await expect(buildPromptThreadReportFromRun(
        workspace,
        manifest,
        reportEvidence,
        {
          ...unblinded,
          decisionsArtifact: {
            ...unblinded.decisionsArtifact,
            packetHash: "sha256:foreign",
          },
        },
        reportCase,
      )).rejects.toThrow("this run");
      const { report, markdown } = await buildPromptThreadReportFromRun(
        workspace,
        manifest,
        reportEvidence,
        unblinded,
        reportCase,
      );
      expect(report.verdicts).toMatchObject({
        replayComparability: { status: "pass" },
        historySelection: { status: "not_exercised" },
        cacheAndCost: { status: "mixed" },
      });
      expect(markdown).toContain("Blind preference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const reportCase = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "frozen_case",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseId: `sha256:${"1".repeat(64)}`,
  sourceReceiptHash: `sha256:${"2".repeat(64)}`,
  privateData: {
    startingState: { historyCatalog: [] },
    traces: [
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "lyra" },
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "lyra" },
    ],
  },
} satisfies FrozenCaseArtifact;

const reportEvidence = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "evidence_card_draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseHash: hashCanonicalJson(reportCase),
  provenance: "manual",
  items: [],
} satisfies PromptThreadEvidenceCard;

const reportEvidenceApproval = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "evidence_card_approval",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseHash: hashCanonicalJson(reportCase),
  cardHash: hashCanonicalJson(reportEvidence),
  reviewer: "producer",
} satisfies EvidenceCardApprovalArtifact;

const reportBaseline = {
  arm: "baseline" as const,
  checkoutPath: "/baseline",
  commitSha: "a".repeat(40),
  compilerPolicyDigest: "sha256:baseline",
  harnessDigest: "sha256:harness",
};

const reportCandidate = {
  arm: "candidate" as const,
  checkoutPath: "/candidate",
  commitSha: "b".repeat(40),
  compilerPolicyDigest: "sha256:candidate",
  harnessDigest: "sha256:harness",
};

async function reportManifest() {
  return createPromptThreadPanelManifest({
    caseValue: reportCase,
    sourceFidelity: {
      status: "matched",
      caseId: reportCase.caseId,
      turnCount: 4,
      sourceMutation: false,
    },
    evidenceDraft: reportEvidence,
    evidenceApproval: reportEvidenceApproval,
    baseline: reportBaseline,
    candidate: reportCandidate,
    verdictScope: "cache_quality_only",
    historyEnabled: false,
    modelSnapshot: "gpt-5.4-nano-2026-03-17",
    requestedServiceTier: "flex",
    zdrStatus: "unknown",
    runtimeHash: reportBaseline.harnessDigest,
    actionSchemaHash: "sha256:action",
    maximumSpendUsd: 10,
    estimatedInputTokensPerCall: 4_000,
    maximumOutputTokensPerCall: 1_000,
    actorIds: ["finn", "lyra"],
    now: new Date("2026-01-01T00:00:00.000Z"),
  }, {
    inspectCheckout: async (path) => ({
      commitSha: path === "/baseline"
        ? reportBaseline.commitSha
        : reportCandidate.commitSha,
      dirty: false,
    }),
    inspectWorkerHandshake: async (revision) =>
      createPromptThreadWorkerHandshake({
        harnessDigest: revision.harnessDigest,
        compilerPolicyDigest: revision.compilerPolicyDigest,
        actionSchemaHash: "sha256:action",
      }),
  });
}

function reportRunner(
  manifest: Awaited<ReturnType<typeof reportManifest>>,
): RunPanelDependencies {
  let providerCalls = 0;
  return {
    validateCheckouts: async () => undefined,
    workerHandshake: async (cell) =>
      createPromptThreadWorkerHandshake({
        harnessDigest: cell.arm === "candidate"
          ? reportCandidate.harnessDigest
          : reportBaseline.harnessDigest,
        compilerPolicyDigest: cell.arm === "candidate"
          ? reportCandidate.compilerPolicyDigest
          : reportBaseline.compilerPolicyDigest,
        actionSchemaHash: "sha256:action",
      }),
    runWorker: (input) => runPromptThreadWorker(input, {
      executeCell: async (_caseValue, value) => {
        const request = {
          model: value.model,
          prompt_cache_key: value.promptCacheKey,
          input: "x".repeat(1_024),
          instructions: "stable panel instructions",
        };
        const response = await value.dispatch(request);
        return {
          request,
          response,
          capture: {
            caseId: reportCase.caseId,
            actorOrder: [],
            traces: [],
            turns: [],
            movementRecords: [],
            checkpoints: [],
            selectionExplanations: [{
              turn: value.turn,
              actorId: value.turn % 2 ? "finn" : "lyra",
              promptClass: "ordinary_speech",
              laneSummary: {
                protectedCount: 4,
                hotCount: value.turn - 1,
                authorizedHistoryCount: 0,
                selectedHistoryCount: 0,
              },
              budget: {
                envelopeChars: 10_000,
                historyBudgetChars: 0,
                protectedChars: 3_000,
                hotChars: 1_000,
                historyChars: 0,
              },
              items: [],
            }],
          },
          checkpoint: {
            protocolVersion: PROTOCOL_VERSION,
            schemaHash: PROTOCOL_SCHEMA_HASH,
            kind: "continuation_checkpoint",
            createdAt: "2026-01-01T00:00:00.000Z",
            branchId: "fixture",
            cellId: "fixture",
            turn: value.turn,
            privateState: {
              output: {
                message: `generated turn ${value.turn}`,
                noReply: false,
                gotoRoomId: null,
                gotoPlayerName: null,
                coordinationReceipt: null,
              },
            },
          },
        };
      },
    }),
    providerDispatch: async (request) => {
      const matching = manifest.cells[providerCalls++]!;
      expect(request.prompt_cache_key).toBe(matching.actorLineage);
      return {
        id: `response-${matching.cellId}`,
        status: "completed",
        service_tier: "flex",
        output_text: "{}",
        usage: {
          input_tokens: 2_000,
          input_tokens_details: {
            cached_tokens: matching.firstCall
              ? 0
              : matching.controlReturnTurn
                ? 10
                : 100,
          },
          output_tokens: 100,
          output_tokens_details: { reasoning_tokens: 10 },
          total_tokens: 2_100,
        },
      };
    },
  };
}
