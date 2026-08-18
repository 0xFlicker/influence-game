import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  hashCanonicalJson,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
  type JsonObject,
} from "@influence/prompt-lab-protocol";
import { GameState, Phase } from "@influence/engine";
import {
  computePromptThreadWorkerActionSchemaHash,
  computePromptThreadWorkerHarnessDigest,
  computePromptThreadWorkerPolicyDigest,
  createPromptThreadWorkerHandshake,
  runPromptThreadWorker,
} from "@influence/engine/prompt-thread-worker";
import {
  PROMPT_THREAD_FIDELITY_LANES,
  PROMPT_THREAD_TRANSPORT_ONLY_EXCLUSIONS,
} from "@influence/engine/prompt-thread-lab";
import {
  createPrivateWorkspace,
  readArtifact,
  readPrivateJson,
  withRunMutationLock,
} from "./prompt-thread-workspace.js";
import {
  approvePromptThreadPanel,
  createPromptThreadPanelManifest,
  createTrustedCheckoutPanelDependencies,
  initializePromptThreadPanelRun,
  planPromptThreadPanel,
  runPromptThreadPanel,
  structuralPanelStatus,
  type PanelPreflightInput,
  type PromptThreadPanelManifest,
  type RunPanelDependencies,
} from "./prompt-thread-panel.js";
import type { PromptThreadEvidenceCard } from "./prompt-thread-evidence-card.js";
import { PROMPT_THREAD_PANEL_MODEL } from "./prompt-thread-provider-broker.js";
import { PromptThreadProviderBroker } from "./prompt-thread-provider-broker.js";

const caseValue = {
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

const realWorkerRoster = [
  { id: "a", name: "A", personality: "strategic" },
  { id: "b", name: "B", personality: "social" },
  { id: "c", name: "C", personality: "observer" },
  { id: "d", name: "D", personality: "honest" },
  { id: "e", name: "E", personality: "broker" },
] as const;

function realWorkerContinuity(playerId: string, playerName: string) {
  return {
    version: 2,
    playerId,
    playerName,
    compactStrategy: {
      lifecycle: "opening",
      baseline: null,
      deltas: [],
      priorEpoch: null,
      revision: 0,
    },
    notes: [],
    relationships: { allies: [], threats: [] },
    powerActionMemory: [],
    roundHistory: [],
  };
}

function realWorkerIntent(actorId: string, other: string, round: number) {
  return {
    manifestId: `intent-${actorId}`,
    actorId,
    action: "mingle-intent",
    byteLength: 1,
    sha256: hashCanonicalJson(actorId),
    body: {
      version: 2,
      actor: { id: actorId, name: actorId.toUpperCase(), role: "player" },
      action: "mingle-intent",
      phase: Phase.MINGLE_I,
      round,
      model: { name: "fixture-model" },
      requestedReasoningEffort: "low",
      reasoningPolicy: "action-policy",
      prompt: { messages: [] },
      request: { transportOnly: "source-request-id" },
      output: {
        seekPlayers: [other],
        avoidPlayers: [],
        preferredRoomSize: "pair",
        purpose: `Compare notes with ${other}`,
        provisionalTarget: null,
        noTargetReason: "Still gathering evidence",
        openingAsk: `Ask ${other} what changed`,
        strategicLens: "broad_read",
        strategicLensRationale: "Use the room to compare reads.",
        strategyDelta: `Keep ${other} close for this vote.`,
        thinking: "fixture intent",
      },
    },
  };
}

function realWorkerSpeech(
  id: string,
  actorId: string,
  message: string,
  round: number,
) {
  return {
    manifestId: id,
    actorId,
    action: "mingle-turn",
    byteLength: 1,
    sha256: hashCanonicalJson(id),
    body: {
      version: 2,
      actor: { id: actorId, name: actorId.toUpperCase(), role: "player" },
      action: "mingle-turn",
      phase: Phase.MINGLE_I,
      round,
      model: { name: "fixture-model" },
      requestedReasoningEffort: "low",
      reasoningPolicy: "action-policy",
      prompt: { messages: [] },
      request: { transportOnly: "source-request-id" },
      output: generatedSpeechOutput(message),
    },
  };
}

function realWorkerCase(): FrozenCaseArtifact {
  const state = new GameState(
    realWorkerRoster.map(({ id, name }) => ({ id, name })),
    { gameId: "prompt-thread-process-fixture", now: () => 1_700_000_000_000 },
  );
  state.startRound();
  const round = state.round;
  const privateData = {
    version: 1,
    materializerVersion: "test/v1",
    baselineClaim: "trace_observable_message_equivalent",
    selection: {
      gameId: "prompt-thread-process-fixture",
      boundarySequence: state.getCanonicalEvents().length,
      phase: Phase.MINGLE_I,
      round,
      actorIds: ["a", "b"],
      targetManifestIds: ["turn-a-1", "turn-b-1", "turn-a-2", "turn-b-2"],
      intentManifestIds: ["intent-a", "intent-b"],
    },
    startingState: {
      canonicalEvents: state.getCanonicalEvents(),
      canonicalProjection: state.getDomainProjection(),
      config: {},
      roster: realWorkerRoster.map((player) => ({
        id: player.id,
        persona: {
          name: player.name,
          personality: player.personality,
        },
        agentConfig: {
          model: "fixture-model",
          catalogId: "fixture-catalog",
          reasoningPolicy: "action-policy",
          providerProfileId: "openai",
        },
      })),
      continuity: {
        playerContinuityCapsules: [
          realWorkerContinuity("a", "A"),
          realWorkerContinuity("b", "B"),
        ],
      },
      transcriptReplay: [],
      historyCatalog: [],
      roomSchedule: [
        { roomId: 2, round, beat: 1, playerIds: ["a", "b"], playerCount: 2 },
        { roomId: 2, round, beat: 2, playerIds: ["a", "b"], playerCount: 2 },
      ],
      roomCounts: [
        {
          beat: 1,
          rooms: [
            { roomId: 1, playerCount: 1 },
            { roomId: 2, playerCount: 2 },
            { roomId: 3, playerCount: 2 },
          ],
        },
        {
          beat: 2,
          rooms: [
            { roomId: 1, playerCount: 1 },
            { roomId: 2, playerCount: 2 },
            { roomId: 3, playerCount: 2 },
          ],
        },
      ],
    },
    traces: [
      realWorkerIntent("a", "B", round),
      realWorkerIntent("b", "A", round),
      realWorkerSpeech("turn-a-1", "a", "A opens", round),
      realWorkerSpeech("turn-b-1", "b", "B answers", round),
      realWorkerSpeech("turn-a-2", "a", "A returns", round),
      realWorkerSpeech("turn-b-2", "b", "B closes", round),
    ],
    fidelityContract: {
      canonicalizerId: CANONICALIZER_ID,
      canonicalizerVersion: CANONICALIZER_VERSION,
      bytePreservingMessageContent: true,
      transportOnlyExclusions: ["request.transportOnly"],
    },
  } as unknown as JsonObject;
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "frozen_case",
    createdAt: "2026-01-01T00:00:00.000Z",
    caseId: hashCanonicalJson(privateData),
    sourceReceiptHash: hashCanonicalJson("process-source"),
    privateData,
  };
}

const evidenceDraft = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "evidence_card_draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseHash: hashCanonicalJson(caseValue),
  provenance: "manual",
  items: [],
} satisfies PromptThreadEvidenceCard;

const evidenceApproval = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "evidence_card_approval",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseHash: hashCanonicalJson(caseValue),
  cardHash: hashCanonicalJson(evidenceDraft),
  reviewer: "producer",
} satisfies EvidenceCardApprovalArtifact;

const baseline = {
  arm: "baseline" as const,
  checkoutPath: "/baseline",
  commitSha: "a".repeat(40),
  compilerPolicyDigest: "sha256:baseline",
  harnessDigest: "sha256:harness",
};
const candidate = {
  arm: "candidate" as const,
  checkoutPath: "/candidate",
  commitSha: "b".repeat(40),
  compilerPolicyDigest: "sha256:candidate",
  harnessDigest: "sha256:harness",
};

function preflightInput(
  overrides: Partial<PanelPreflightInput> = {},
): PanelPreflightInput {
  return {
    caseValue,
    sourceFidelity: {
      version: 1,
      status: "matched",
      caseId: caseValue.caseId,
      turnCount: 4,
      canonicalizerId: CANONICALIZER_ID,
      canonicalizerVersion: CANONICALIZER_VERSION,
      comparedLanes: [...PROMPT_THREAD_FIDELITY_LANES],
      transportOnlyExclusions: [
        ...PROMPT_THREAD_TRANSPORT_ONLY_EXCLUSIONS,
      ],
      sourceMutation: false,
    },
    evidenceDraft,
    evidenceApproval,
    baseline,
    candidate,
    verdictScope: "cache_quality_only",
    historyEnabled: false,
    modelSnapshot: PROMPT_THREAD_PANEL_MODEL,
    requestedServiceTier: "flex",
    zdrStatus: "unknown",
    runtimeHash: baseline.harnessDigest,
    actionSchemaHash: "sha256:action",
    maximumSpendUsd: 10,
    estimatedInputTokensPerCall: 4_000,
    maximumOutputTokensPerCall: 1_000,
    actorIds: ["finn", "lyra"],
    now: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const inspectCheckout = async (path: string) => ({
  commitSha: path === "/baseline" ? baseline.commitSha : candidate.commitSha,
  dirty: false,
});
const inspectWorkerHandshake = async (
  revision: typeof baseline | typeof candidate,
) => createPromptThreadWorkerHandshake({
  harnessDigest: revision.harnessDigest,
  compilerPolicyDigest: revision.compilerPolicyDigest,
  actionSchemaHash: "sha256:action",
});
const computeWorkerHarnessDigest = async () => baseline.harnessDigest;

async function manifest(): Promise<PromptThreadPanelManifest> {
  return createPromptThreadPanelManifest(preflightInput(), {
    inspectCheckout,
    computeWorkerHarnessDigest,
    inspectWorkerHandshake,
  });
}

function runner(
  providerDispatch: RunPanelDependencies["providerDispatch"],
  stopAfterCell?: () => boolean,
): RunPanelDependencies {
  return {
    validateCheckouts: async () => undefined,
    workerHandshake: async (cell) => createPromptThreadWorkerHandshake({
      harnessDigest: baseline.harnessDigest,
      compilerPolicyDigest: cell.arm === "candidate"
        ? candidate.compilerPolicyDigest
        : baseline.compilerPolicyDigest,
      actionSchemaHash: "sha256:action",
    }),
    runWorker: (input) => runPromptThreadWorker(input, {
      executeCell: async (_caseValue, value) => {
        const request = {
          model: value.model,
          prompt_cache_key: value.promptCacheKey,
          input: "x".repeat(1_024),
          instructions: "stable panel instructions",
          max_output_tokens: 1_000,
        };
        const response = await value.dispatch(request);
        return {
          request,
          response,
          capture: {
            caseId: caseValue.caseId,
            actorOrder: [],
            traces: [],
            turns: [],
            movementRecords: [],
            checkpoints: [],
            selectionExplanations: [],
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
    providerDispatch,
    ...(stopAfterCell && { stopAfterCell }),
  };
}

describe("prompt thread panel", () => {
  it("plans 24 contiguous primary calls followed by four controls", () => {
    const cells = planPromptThreadPanel("cache_quality_only", false);
    expect(cells).toHaveLength(28);
    expect(cells.slice(-4).every((cell) => cell.arm === "control")).toBe(true);
    expect(cells.slice(-2).every((cell) => cell.controlReturnTurn)).toBe(true);
    expect(cells.slice(0, 4).map((cell) => cell.branchId))
      .toEqual(["baseline-1", "baseline-1", "baseline-1", "baseline-1"]);
    expect(structuralPanelStatus(cells, []).nextActions).toEqual(["panel-run"]);
    expect(structuralPanelStatus(cells, [cells[0]!.cellId]).nextActions)
      .toEqual(["panel-resume"]);
  });

  it("preflights immutable revisions, policy scope, rate card, and spend without dispatch", async () => {
    let inspections = 0;
    const value = await createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout: async (path) => {
        inspections += 1;
        return inspectCheckout(path);
      },
      computeWorkerHarnessDigest,
      inspectWorkerHandshake,
    });
    expect(inspections).toBe(2);
    expect(value.cells).toHaveLength(28);
    expect(value.maximumCalls).toBe(28);
    expect(value.sourceFidelityHash).toBe(
      hashCanonicalJson(preflightInput().sourceFidelity),
    );
    expect(value.estimatedInputTokensPerCall).toBe(4_000);
    expect(value.maximumOutputTokensPerCall).toBe(1_000);
    await expect(createPromptThreadPanelManifest(preflightInput({
      sourceFidelity: {
        ...preflightInput().sourceFidelity,
        comparedLanes: ["prompt.messages"],
      },
    }), { inspectCheckout, inspectWorkerHandshake })).rejects.toThrow(
      "source-fidelity",
    );
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      computeWorkerHarnessDigest: async () => "sha256:untrusted",
      inspectWorkerHandshake,
    })).rejects.toThrow("harness digest");
    await expect(createPromptThreadPanelManifest(preflightInput({
      verdictScope: "full",
      historyEnabled: false,
    }), { inspectCheckout, computeWorkerHarnessDigest, inspectWorkerHandshake })).rejects.toThrow("policy");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout: async (path) => ({
        ...(await inspectCheckout(path)),
        dirty: true,
      }),
      computeWorkerHarnessDigest,
      inspectWorkerHandshake,
    })).rejects.toThrow("dirty");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      computeWorkerHarnessDigest,
      inspectWorkerHandshake: async () =>
        createPromptThreadWorkerHandshake({
          harnessDigest: "sha256:different-harness",
          compilerPolicyDigest: baseline.compilerPolicyDigest,
          actionSchemaHash: "sha256:action",
        }),
    })).rejects.toThrow("harness");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      computeWorkerHarnessDigest,
      inspectWorkerHandshake: async (revision) =>
        createPromptThreadWorkerHandshake({
          harnessDigest: revision.harnessDigest,
          compilerPolicyDigest: "sha256:unattested-policy",
          actionSchemaHash: "sha256:action",
        }),
    })).rejects.toThrow("attested");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      computeWorkerHarnessDigest,
      inspectWorkerHandshake: async (revision) =>
        createPromptThreadWorkerHandshake({
          harnessDigest: revision.harnessDigest,
          compilerPolicyDigest: revision.compilerPolicyDigest,
          actionSchemaHash: "sha256:unattested-action",
        }),
    })).rejects.toThrow("attested");
    await expect(createPromptThreadPanelManifest(preflightInput({
      actorIds: ["lyra", "finn"],
    }), {
      inspectCheckout,
      computeWorkerHarnessDigest,
      inspectWorkerHandshake,
    })).rejects.toThrow("ordered frozen replay actors");
  });

  it("runs exactly 28 fake-provider cells and resumes without duplicate dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-"));
    try {
      const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
      const value = await manifest();
      const approval = approvePromptThreadPanel(value, "producer");
      await initializePromptThreadPanelRun(workspace, value, approval);
      let calls = 0;
      const provider = async (request: Record<string, unknown>) => {
        calls += 1;
        const key = String(request.prompt_cache_key);
        const cell = value.cells[calls - 1]!;
        expect(key).toBe(cell.actorLineage);
        return {
          id: `response-${calls}`,
          status: "completed",
          service_tier: "flex",
          usage: {
            input_tokens_details: { cached_tokens: cell.firstCall ? 0 : 100 },
          },
          output_text: JSON.stringify({ message: `turn-${calls}` }),
        };
      };
      let stop = true;
      const first = await runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        runner(provider, () => {
          const shouldStop = stop;
          stop = false;
          return shouldStop;
        }),
      );
      expect(first.completedCells).toBe(1);
      expect(first.settledSpendUsd).toBeCloseTo(value.cells[0]!.maxCostUsd);
      const completed = await runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        runner(provider),
      );
      expect(completed.lifecycle).toBe("completed");
      expect(completed.completedCells).toBe(28);
      expect(completed.settledSpendUsd).toBeCloseTo(
        value.cells.reduce((sum, cell) => sum + cell.maxCostUsd, 0),
      );
      expect(calls).toBe(28);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("admits only one concurrent resume without duplicate dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-concurrent-"));
    try {
      const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
      const value = await manifest();
      const approval = approvePromptThreadPanel(value, "producer");
      await initializePromptThreadPanelRun(workspace, value, approval);
      let calls = 0;
      let releaseFirst!: () => void;
      let markStarted!: () => void;
      const firstStarted = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const firstRelease = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const provider = async (request: Record<string, unknown>) => {
        calls += 1;
        if (calls === 1) {
          markStarted();
          await firstRelease;
        }
        const cell = value.cells[calls - 1]!;
        return {
          id: `concurrent-${calls}`,
          status: "completed",
          service_tier: "flex",
          usage: {
            input_tokens_details: { cached_tokens: cell.firstCall ? 0 : 100 },
          },
          output_text: JSON.stringify({ request }),
        };
      };
      const first = runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        runner(provider),
      );
      await firstStarted;
      const second = runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        runner(provider),
      );
      const secondResult = await Promise.allSettled([second]);
      releaseFirst();
      const firstResult = await first;
      expect(firstResult.lifecycle).toBe("completed");
      expect(secondResult[0]?.status).toBe("rejected");
      expect(calls).toBe(28);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reapplies a recorded provider response before dispatching the next cell", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-reapply-"));
    try {
      const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
      const value = await manifest();
      const approval = approvePromptThreadPanel(value, "producer");
      await initializePromptThreadPanelRun(workspace, value, approval);
      const broker = new PromptThreadProviderBroker(
        value.cells.map((cell) => ({
          cellId: cell.cellId,
          ordinal: cell.ordinal,
          actorId: cell.actorId,
          lineage: cell.actorLineage,
          firstCall: cell.firstCall,
          requestedServiceTier: value.requestedServiceTier,
          maxCostUsd: cell.maxCostUsd,
          controlReturnTurn: cell.controlReturnTurn,
        })),
        value.maximumSpendUsd,
      );
      const firstCell = value.cells[0]!;
      await withRunMutationLock(workspace, value.runId, async (lock) => {
        await broker.dispatch(
          lock,
          {
            cellId: firstCell.cellId,
            model: value.modelSnapshot,
            request: {
              model: value.modelSnapshot,
              prompt_cache_key: firstCell.actorLineage,
              input: "x".repeat(1_024),
              instructions: "stable panel instructions",
            },
          },
          async () => ({
            id: "saved-first",
            status: "completed",
            service_tier: "flex",
            usage: { input_tokens_details: { cached_tokens: 0 } },
            output_text: "{}",
          }),
          { alreadyPlanned: true },
        );
      });
      let resumeCalls = 0;
      const result = await runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        runner(async (request) => {
          resumeCalls += 1;
          const cell = value.cells[resumeCalls]!;
          expect(request.prompt_cache_key).toBe(cell.actorLineage);
          return {
            id: `resumed-${resumeCalls}`,
            status: "completed",
            service_tier: "flex",
            usage: {
              input_tokens_details: { cached_tokens: cell.firstCall ? 0 : 100 },
            },
            output_text: "{}",
          };
        }),
      );
      expect(result).toMatchObject({ lifecycle: "completed" });
      expect(resumeCalls).toBe(27);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the 28-cell fake panel through two revision worker processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-process-"));
    try {
      const workspace = await createPrivateWorkspace(join(root, "private"), {
        gitWorktreeRoots: [],
      });
      const baselineCheckout = join(root, "baseline");
      const candidateCheckout = join(root, "candidate");
      await Promise.all([
        writeFixtureWorker(
          baselineCheckout,
          baseline.harnessDigest,
          baseline.compilerPolicyDigest,
        ),
        writeFixtureWorker(
          candidateCheckout,
          candidate.harnessDigest,
          candidate.compilerPolicyDigest,
        ),
      ]);
      const processBaseline = { ...baseline, checkoutPath: baselineCheckout };
      const processCandidate = { ...candidate, checkoutPath: candidateCheckout };
      const value = await createPromptThreadPanelManifest(preflightInput({
        baseline: processBaseline,
        candidate: processCandidate,
      }), {
        inspectCheckout: async (path) => ({
          commitSha: path === baselineCheckout
            ? processBaseline.commitSha
            : processCandidate.commitSha,
          dirty: false,
        }),
        computeWorkerHarnessDigest,
      });
      const approval = approvePromptThreadPanel(value, "producer");
      await initializePromptThreadPanelRun(workspace, value, approval);
      let calls = 0;
      const dependencies = createTrustedCheckoutPanelDependencies(
        workspace,
        value,
        async (request) => {
          calls += 1;
          const cell = value.cells[calls - 1]!;
          expect(request.prompt_cache_key).toBe(cell.actorLineage);
          return {
            id: `process-response-${calls}`,
            status: "completed",
            service_tier: "flex",
            output_text: "{}",
            usage: {
              input_tokens_details: {
                cached_tokens: cell.firstCall ? 0 : 100,
              },
            },
          };
        },
        {
          inspectCheckout: async (path) => ({
            commitSha: path === baselineCheckout
              ? processBaseline.commitSha
              : processCandidate.commitSha,
          dirty: false,
        }),
          computeWorkerHarnessDigest,
      },
      );
      expect((await dependencies.workerHandshake(value.cells[0]!)).kind)
        .toBe("handshake");
      const result = await runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        dependencies,
      );
      expect(result).toMatchObject({ lifecycle: "completed" });
      expect(calls).toBe(28);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("runs the real worker CLI through the broker and replays its saved response", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-real-worker-"));
    try {
      const checkoutPath = resolve(import.meta.dir, "../../../..");
      const [harnessDigest, compilerPolicyDigest, actionSchemaHash] = await Promise.all([
        computePromptThreadWorkerHarnessDigest(checkoutPath),
        computePromptThreadWorkerPolicyDigest(checkoutPath),
        computePromptThreadWorkerActionSchemaHash(checkoutPath),
      ]);
      const actualCase = realWorkerCase();
      const actualEvidence = {
        ...evidenceDraft,
        caseHash: hashCanonicalJson(actualCase),
      };
      const actualEvidenceApproval = {
        ...evidenceApproval,
        caseHash: hashCanonicalJson(actualCase),
        cardHash: hashCanonicalJson(actualEvidence),
      };
      const actualBaseline = {
        arm: "baseline" as const,
        checkoutPath,
        commitSha: "c".repeat(40),
        compilerPolicyDigest,
        harnessDigest,
      };
      const actualCandidate = {
        ...actualBaseline,
        arm: "candidate" as const,
      };
      const value = await createPromptThreadPanelManifest(preflightInput({
        caseValue: actualCase,
        sourceFidelity: {
          ...preflightInput().sourceFidelity,
          caseId: actualCase.caseId,
        },
        evidenceDraft: actualEvidence,
        evidenceApproval: actualEvidenceApproval,
        baseline: actualBaseline,
        candidate: actualCandidate,
        runtimeHash: harnessDigest,
        actionSchemaHash,
        estimatedInputTokensPerCall: 50_000,
        maximumOutputTokensPerCall: 10_000,
        actorIds: ["a", "b"],
      }), {
        inspectCheckout: async () => ({
          commitSha: actualBaseline.commitSha,
          dirty: false,
        }),
        computeWorkerHarnessDigest: () =>
          computePromptThreadWorkerHarnessDigest(checkoutPath),
      });
      const approval = approvePromptThreadPanel(value, "producer");
      const firstWorkspace = await createPrivateWorkspace(
        join(root, "first-workspace"),
        { gitWorktreeRoots: [] },
      );
      await initializePromptThreadPanelRun(firstWorkspace, value, approval);
      const response = generatedProviderResponse("A opens");
      let brokerRequest: Record<string, unknown> | undefined;
      const firstDependencies = createTrustedCheckoutPanelDependencies(
        firstWorkspace,
        value,
        async (request) => {
          brokerRequest = structuredClone(request);
          return structuredClone(response);
        },
        {
          inspectCheckout: async () => ({
            commitSha: actualBaseline.commitSha,
            dirty: false,
          }),
          computeWorkerHarnessDigest: () =>
            computePromptThreadWorkerHarnessDigest(checkoutPath),
          stopAfterCell: () => true,
        },
      );
      const first = await runPromptThreadPanel(
        firstWorkspace,
        value,
        approval,
        actualCase,
        actualEvidence,
        actualEvidenceApproval,
        firstDependencies,
      );
      const firstCell = value.cells[0]!;
      expect(first).toMatchObject({ lifecycle: "running", completedCells: 1 });
      expect(brokerRequest).toMatchObject({
        model: PROMPT_THREAD_PANEL_MODEL,
        prompt_cache_key: firstCell.actorLineage,
        store: false,
        service_tier: "flex",
      });
      const firstCheckpoint = await readArtifact(
        firstWorkspace,
        `runs/${value.runId}/cells/${firstCell.cellId}/continuation-checkpoint.json`,
      );
      expect(firstCheckpoint).toMatchObject({
        kind: "continuation_checkpoint",
        cellId: firstCell.cellId,
        turn: 1,
      });
      const firstWorkerResult = await readPrivateJson(
        firstWorkspace,
        `runs/${value.runId}/cells/${firstCell.cellId}/worker-output.json`,
      ) as { request: Record<string, unknown> };

      const replayWorkspace = await createPrivateWorkspace(
        join(root, "replay-workspace"),
        { gitWorktreeRoots: [] },
      );
      await initializePromptThreadPanelRun(replayWorkspace, value, approval);
      const broker = new PromptThreadProviderBroker(
        value.cells.map((cell) => ({
          cellId: cell.cellId,
          ordinal: cell.ordinal,
          actorId: cell.actorId,
          lineage: cell.actorLineage,
          firstCall: cell.firstCall,
          requestedServiceTier: value.requestedServiceTier,
          estimatedInputTokens: value.estimatedInputTokensPerCall,
          maxOutputTokens: value.maximumOutputTokensPerCall,
          maxCostUsd: cell.maxCostUsd,
          controlReturnTurn: cell.controlReturnTurn,
        })),
        value.maximumSpendUsd,
      );
      await withRunMutationLock(replayWorkspace, value.runId, (lock) =>
        broker.dispatch(
          lock,
          {
            cellId: firstCell.cellId,
            model: value.modelSnapshot,
            request: firstWorkerResult.request,
          },
          async () => structuredClone(response),
          { alreadyPlanned: true },
        )
      );
      let replayDispatches = 0;
      const replayDependencies = createTrustedCheckoutPanelDependencies(
        replayWorkspace,
        value,
        async () => {
          replayDispatches += 1;
          throw new Error("saved response replay must not redispatch");
        },
        {
          inspectCheckout: async () => ({
            commitSha: actualBaseline.commitSha,
            dirty: false,
          }),
          computeWorkerHarnessDigest: () =>
            computePromptThreadWorkerHarnessDigest(checkoutPath),
          stopAfterCell: () => true,
        },
      );
      const replayed = await runPromptThreadPanel(
        replayWorkspace,
        value,
        approval,
        actualCase,
        actualEvidence,
        actualEvidenceApproval,
        replayDependencies,
      );
      expect(replayed).toMatchObject({ lifecycle: "running", completedCells: 1 });
      expect(replayDispatches).toBe(0);
      const replayCheckpoint = await readArtifact(
        replayWorkspace,
        `runs/${value.runId}/cells/${firstCell.cellId}/continuation-checkpoint.json`,
      );
      expect(replayCheckpoint).toMatchObject({
        kind: "continuation_checkpoint",
        cellId: firstCell.cellId,
        turn: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("aborts and settles provider dispatch before timeout cleanup completes", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-timeout-"));
    try {
      const workspace = await createPrivateWorkspace(join(root, "workspace"), {
        gitWorktreeRoots: [],
      });
      const baselineCheckout = join(root, "baseline");
      const candidateCheckout = join(root, "candidate");
      await Promise.all([
        writeFixtureWorker(
          baselineCheckout,
          baseline.harnessDigest,
          baseline.compilerPolicyDigest,
        ),
        writeFixtureWorker(
          candidateCheckout,
          candidate.harnessDigest,
          candidate.compilerPolicyDigest,
        ),
      ]);
      const processBaseline = { ...baseline, checkoutPath: baselineCheckout };
      const processCandidate = { ...candidate, checkoutPath: candidateCheckout };
      const value = await createPromptThreadPanelManifest(preflightInput({
        baseline: processBaseline,
        candidate: processCandidate,
      }), {
        inspectCheckout: async (path) => ({
          commitSha: path === baselineCheckout
            ? processBaseline.commitSha
            : processCandidate.commitSha,
          dirty: false,
        }),
        computeWorkerHarnessDigest,
      });
      const approval = approvePromptThreadPanel(value, "producer");
      await initializePromptThreadPanelRun(workspace, value, approval);
      let providerSignal: AbortSignal | undefined;
      let providerSettled = false;
      const dependencies = createTrustedCheckoutPanelDependencies(
        workspace,
        value,
        async (_request, options) => {
          providerSignal = options?.signal;
          try {
            await new Promise<never>((_resolve, reject) => {
              if (!providerSignal) {
                reject(new Error("missing abort signal"));
                return;
              }
              const rejectAbort = () => reject(
                providerSignal?.reason ?? new Error("aborted"),
              );
              if (providerSignal.aborted) {
                rejectAbort();
                return;
              }
              providerSignal.addEventListener("abort", rejectAbort, {
                once: true,
              });
            });
          } finally {
            providerSettled = true;
          }
        },
        {
          inspectCheckout: async (path) => ({
            commitSha: path === baselineCheckout
              ? processBaseline.commitSha
              : processCandidate.commitSha,
            dirty: false,
          }),
          computeWorkerHarnessDigest,
          trustedWorkerTimeoutMs: 100,
        },
      );
      const result = await runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        dependencies,
      );
      expect(result.lifecycle).toBe("invalidated");
      expect(providerSignal?.aborted).toBe(true);
      expect(providerSettled).toBe(true);
      await expect(readArtifact(
        workspace,
        `runs/${value.runId}/cells/${value.cells[0]!.cellId}/provider-result.json`,
      )).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);

  it("invalidates and removes private run data after a provider non-response", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-panel-fail-"));
    try {
      const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
      const value = await manifest();
      const approval = approvePromptThreadPanel(value, "producer");
      await initializePromptThreadPanelRun(workspace, value, approval);
      const result = await runPromptThreadPanel(
        workspace,
        value,
        approval,
        caseValue,
        evidenceDraft,
        evidenceApproval,
        runner(async () => {
          throw new Error("network timeout");
        }),
      );
      expect(result.lifecycle).toBe("invalidated");
      expect(result.reasonCode).toBe("provider_no_complete_response");
      expect(result.outstandingCells).toBe(0);
      await expect(
        initializePromptThreadPanelRun(workspace, value, approval),
      ).rejects.toThrow("fresh manifest and approval");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function generatedSpeechOutput(message: string) {
  return {
    message,
    noReply: false,
    gotoRoomId: null,
    gotoPlayerName: null,
    proposedTarget: null,
    proposedAction: null,
    commitment: null,
    noProposalReason: null,
    strategyDelta: `Recorded ${message}`,
    thinking: `Thinking about ${message}`,
  };
}

function generatedProviderResponse(message: string) {
  const outputText = JSON.stringify(generatedSpeechOutput(message));
  return {
    id: "real-worker-response",
    object: "response",
    status: "completed",
    service_tier: "flex",
    output_text: outputText,
    output: [{
      id: "real-worker-message",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{
        type: "output_text",
        text: outputText,
      }],
    }],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
  };
}

async function writeFixtureWorker(
  checkoutPath: string,
  harnessDigest: string,
  compilerPolicyDigest: string,
): Promise<void> {
  const workerDirectory = join(checkoutPath, "packages/engine/src");
  await mkdir(workerDirectory, { recursive: true });
  await writeFile(
    join(workerDirectory, "prompt-thread-worker.ts"),
    fixtureWorkerSource(harnessDigest, compilerPolicyDigest),
    { mode: 0o600 },
  );
}

function fixtureWorkerSource(
  harnessDigest: string,
  compilerPolicyDigest: string,
): string {
  return `
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
const [command, ...args] = process.argv.slice(2);
if (command === "handshake") {
  console.log(JSON.stringify({
    protocolVersion: ${JSON.stringify(PROTOCOL_VERSION)},
    schemaHash: ${JSON.stringify(PROTOCOL_SCHEMA_HASH)},
    kind: "handshake",
    createdAt: "2026-01-01T00:00:00.000Z",
    canonicalizerId: ${JSON.stringify(CANONICALIZER_ID)},
    canonicalizerVersion: ${JSON.stringify(CANONICALIZER_VERSION)},
    capabilities: ["broker-transport-only", "prompt-thread-worker", "saved-response-apply"],
    harnessDigest: ${JSON.stringify(harnessDigest)},
    compilerPolicyDigest: ${JSON.stringify(compilerPolicyDigest)},
    actionSchemaHash: "sha256:action"
  }));
} else if (command === "run") {
  const [inputPath, outputPath] = args;
  const envelope = JSON.parse(await readFile(inputPath, "utf8"));
  const input = envelope.input;
  const request = {
    model: input.cell.model,
    prompt_cache_key: input.cell.actorLineage,
    input: "x".repeat(1024),
    instructions: "stable panel instructions",
    max_output_tokens: 1000
  };
  const saved = input.savedResponse;
  const response = saved === undefined
    ? await fetch(envelope.brokerUrl, {
        method: "POST",
        headers: {
          authorization: "Bearer " + envelope.brokerToken,
          "content-type": "application/json"
        },
        body: JSON.stringify(request)
      }).then(async (value) => {
        if (!value.ok) throw new Error("broker failed");
        return value.json();
      })
    : saved;
  const state = input.branchState ?? {
    appliedCellIds: [],
    actorLineages: {},
    providerResponses: []
  };
  state.appliedCellIds.push(input.cell.cellId);
  state.actorLineages[input.cell.actorId] = input.cell.actorLineage;
  state.providerResponses.push(response);
  const checkpoint = {
    protocolVersion: ${JSON.stringify(PROTOCOL_VERSION)},
    schemaHash: ${JSON.stringify(PROTOCOL_SCHEMA_HASH)},
    kind: "continuation_checkpoint",
    createdAt: "2026-01-01T00:00:00.000Z",
    branchId: input.cell.branchId,
    cellId: input.cell.cellId,
    turn: input.cell.turn,
    privateState: { branchState: state }
  };
  const result = {
    dispatched: saved === undefined,
    request,
    response,
    branchState: state,
    checkpoint
  };
  const temporary = outputPath + ".tmp";
  await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, outputPath);
  console.log(JSON.stringify({ status: "completed" }));
} else {
  process.exitCode = 1;
}
`;
}
