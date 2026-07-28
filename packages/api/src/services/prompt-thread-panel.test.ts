import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  hashCanonicalJson,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import {
  createPromptThreadWorkerHandshake,
  runPromptThreadWorker,
} from "@influence/engine/prompt-thread-worker";
import {
  createPrivateWorkspace,
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
      status: "matched",
      caseId: caseValue.caseId,
      turnCount: 4,
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

async function manifest(): Promise<PromptThreadPanelManifest> {
  return createPromptThreadPanelManifest(preflightInput(), {
    inspectCheckout,
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
    expect(structuralPanelStatus(cells, []).nextActions).toEqual(["dispatch"]);
  });

  it("preflights immutable revisions, policy scope, rate card, and spend without dispatch", async () => {
    let inspections = 0;
    const value = await createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout: async (path) => {
        inspections += 1;
        return inspectCheckout(path);
      },
      inspectWorkerHandshake,
    });
    expect(inspections).toBe(2);
    expect(value.cells).toHaveLength(28);
    expect(value.maximumCalls).toBe(28);
    await expect(createPromptThreadPanelManifest(preflightInput({
      verdictScope: "full",
      historyEnabled: false,
    }), { inspectCheckout, inspectWorkerHandshake })).rejects.toThrow("policy");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout: async (path) => ({
        ...(await inspectCheckout(path)),
        dirty: true,
      }),
      inspectWorkerHandshake,
    })).rejects.toThrow("dirty");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      inspectWorkerHandshake: async () =>
        createPromptThreadWorkerHandshake({
          harnessDigest: "sha256:different-harness",
          compilerPolicyDigest: baseline.compilerPolicyDigest,
          actionSchemaHash: "sha256:action",
        }),
    })).rejects.toThrow("harness");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      inspectWorkerHandshake: async (revision) =>
        createPromptThreadWorkerHandshake({
          harnessDigest: revision.harnessDigest,
          compilerPolicyDigest: "sha256:unattested-policy",
          actionSchemaHash: "sha256:action",
        }),
    })).rejects.toThrow("attested");
    await expect(createPromptThreadPanelManifest(preflightInput(), {
      inspectCheckout,
      inspectWorkerHandshake: async (revision) =>
        createPromptThreadWorkerHandshake({
          harnessDigest: revision.harnessDigest,
          compilerPolicyDigest: revision.compilerPolicyDigest,
          actionSchemaHash: "sha256:unattested-action",
        }),
    })).rejects.toThrow("attested");
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
      expect(result.lifecycle).toBe("completed");
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
      expect(result.lifecycle).toBe("completed");
      expect(calls).toBe(28);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

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
      expect(result.outstandingCells).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

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
    instructions: "stable panel instructions"
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
