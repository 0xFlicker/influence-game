import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  createApproval,
  hashCanonicalJson,
  parseArtifact,
  validateHandshake,
  type ArtifactEnvelope,
  type ContinuationCheckpointArtifact,
  type EvidenceCardApprovalArtifact,
  type EvidenceCardDraftArtifact,
  type FrozenCaseArtifact,
  type JsonObject,
  type PaidApprovalArtifact,
  type ProtocolHandshake,
  type StructuralRunSummary,
} from "@influence/prompt-lab-protocol";
import {
  createPromptThreadWorkerHandshake,
  type PromptThreadWorkerBranchState,
  type PromptThreadWorkerCell,
  type PromptThreadWorkerResult,
} from "@influence/engine/prompt-thread-worker";
import { assertEvidenceCardApproval, type PromptThreadEvidenceCard } from "./prompt-thread-evidence-card.js";
import {
  PROMPT_THREAD_PANEL_MODEL,
  PromptThreadProviderBroker,
  type PromptThreadProviderDispatch,
} from "./prompt-thread-provider-broker.js";
import {
  appendCellTransition,
  atomicWriteArtifact,
  inspectRunRecovery,
  invalidateRunUnderLock,
  readArtifact,
  recordContinuationCheckpoint,
  recoverOrInvalidateRun,
  atomicWriteJson,
  readPrivateJson,
  withRunMutationLock,
  type PrivateWorkspace,
  type RunMutationLock,
} from "./prompt-thread-workspace.js";
import { quoteProviderUsageCeiling } from "./provider-cost-accounting.js";

const execFile = promisify(execFileCallback);

export const PROMPT_THREAD_PRIMARY_CALLS = 24;
export const PROMPT_THREAD_CONTROL_CALLS = 4;
export const PROMPT_THREAD_TOTAL_CALLS = 28;

export type PromptThreadVerdictScope = "full" | "cache_quality_only";
export type PromptThreadArm = "baseline" | "candidate" | "control";

export interface PromptThreadPanelCell {
  cellId: string;
  ordinal: number;
  branchId: string;
  arm: PromptThreadArm;
  repetition: number;
  turn: number;
  actor: "finn" | "lyra";
  actorId: string;
  actorLineage: string;
  firstCall: boolean;
  controlReturnTurn: boolean;
  revision: string;
  checkoutPath: string;
  maxCostUsd: number;
}

export interface PromptThreadRevision {
  arm: "baseline" | "candidate";
  checkoutPath: string;
  commitSha: string;
  compilerPolicyDigest: string;
  harnessDigest: string;
}

export interface PromptThreadPanelManifest {
  protocolVersion: typeof PROTOCOL_VERSION;
  schemaHash: typeof PROTOCOL_SCHEMA_HASH;
  kind: "run_manifest";
  createdAt: string;
  caseHash: string;
  evidenceCardHash: string;
  maximumCalls: number;
  maximumSpendUsd: number;
  runId: string;
  sourceReceiptHash: string;
  verdictScope: PromptThreadVerdictScope;
  modelSnapshot: string;
  requestedServiceTier: "flex";
  zdrStatus: "enabled" | "disabled" | "unknown";
  runtimeHash: string;
  actionSchemaHash: string;
  rateCardVersion: string;
  pricingSourceId: string;
  baseline: PromptThreadRevision;
  candidate: PromptThreadRevision;
  cells: PromptThreadPanelCell[];
}

export interface PanelPreflightInput {
  caseValue: FrozenCaseArtifact;
  sourceFidelity: {
    status: "matched";
    caseId: string;
    turnCount: number;
    sourceMutation: false;
  };
  evidenceDraft: PromptThreadEvidenceCard;
  evidenceApproval: EvidenceCardApprovalArtifact;
  baseline: PromptThreadRevision;
  candidate: PromptThreadRevision;
  verdictScope: PromptThreadVerdictScope;
  historyEnabled: boolean;
  modelSnapshot: string;
  requestedServiceTier: "flex";
  zdrStatus: "enabled" | "disabled" | "unknown";
  runtimeHash: string;
  actionSchemaHash: string;
  maximumSpendUsd: number;
  estimatedInputTokensPerCall: number;
  maximumOutputTokensPerCall: number;
  actorIds: readonly [string, string];
  now?: Date;
}

export interface CheckoutInspection {
  commitSha: string;
  dirty: boolean;
}

export interface PanelPreflightDependencies {
  inspectCheckout?: (path: string) => Promise<CheckoutInspection>;
  inspectWorkerHandshake?: (
    revision: PromptThreadRevision,
  ) => Promise<ProtocolHandshake>;
}

export interface PanelWorkerInvocation {
  handshake: ProtocolHandshake;
  caseValue: FrozenCaseArtifact;
  evidenceDraft: EvidenceCardDraftArtifact;
  evidenceApproval: EvidenceCardApprovalArtifact;
  cell: PromptThreadWorkerCell;
  expected: {
    revision: string;
    runtimeHash: string;
    actionSchemaHash: string;
    harnessDigest: string;
  };
  branchState?: PromptThreadWorkerBranchState;
  savedResponse?: unknown;
  brokerTransport?: (request: Record<string, unknown>) => Promise<unknown>;
  mutationLock: RunMutationLock;
}

export interface RunPanelDependencies {
  validateCheckouts: () => Promise<void>;
  workerHandshake: (cell: PromptThreadPanelCell) => Promise<ProtocolHandshake>;
  runWorker: (input: PanelWorkerInvocation) => Promise<PromptThreadWorkerResult>;
  providerDispatch: PromptThreadProviderDispatch;
  stopAfterCell?: () => boolean;
  stopBeforeCell?: () => boolean;
}

export function createTrustedCheckoutPanelDependencies(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  providerDispatch: PromptThreadProviderDispatch,
  options: {
    stopAfterCell?: () => boolean;
    stopBeforeCell?: () => boolean;
    bunExecutable?: string;
    inspectCheckout?: (path: string) => Promise<CheckoutInspection>;
  } = {},
): RunPanelDependencies {
  const bunExecutable = options.bunExecutable ?? process.execPath;
  const inspectCheckout = options.inspectCheckout ?? inspectGitCheckout;
  return {
    validateCheckouts: async () => {
      for (const revision of [manifest.baseline, manifest.candidate]) {
        const checkout = await inspectCheckout(revision.checkoutPath);
        if (checkout.dirty || checkout.commitSha !== revision.commitSha) {
          throw new Error(`Checkout ${revision.arm} changed after panel approval`);
        }
        await readTrustedWorkerHandshake(
          revision.checkoutPath,
          revision.harnessDigest,
          bunExecutable,
        );
      }
    },
    workerHandshake: (cell) => readTrustedWorkerHandshake(
      cell.checkoutPath,
      revisionForCell(manifest, cell).harnessDigest,
      bunExecutable,
    ),
    runWorker: (input) => runTrustedCheckoutWorker(
      workspace,
      manifest,
      input,
      bunExecutable,
    ),
    providerDispatch,
    ...(options.stopAfterCell && { stopAfterCell: options.stopAfterCell }),
    ...(options.stopBeforeCell && { stopBeforeCell: options.stopBeforeCell }),
  };
}

export function planPromptThreadPanel(
  scope: PromptThreadVerdictScope,
  historyEnabled: boolean,
  input: {
    baseline?: PromptThreadRevision;
    candidate?: PromptThreadRevision;
    actorIds?: readonly [string, string];
    runSeed?: string;
    maxCostUsdPerCell?: number;
  } = {},
): PromptThreadPanelCell[] {
  if (scope === "full" && !historyEnabled) {
    throw new Error("full scope requires exercised history policy");
  }
  const baseline = input.baseline ?? placeholderRevision("baseline");
  const candidate = input.candidate ?? placeholderRevision("candidate");
  const actorIds = input.actorIds ?? ["finn", "lyra"];
  const runSeed = input.runSeed ?? "unfrozen-panel";
  const maxCostUsd = input.maxCostUsdPerCell ?? 0;
  const cells: PromptThreadPanelCell[] = [];
  let ordinal = 1;
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    const arms = repetition % 2
      ? ["baseline", "candidate"] as const
      : ["candidate", "baseline"] as const;
    for (const arm of arms) {
      const revision = arm === "baseline" ? baseline : candidate;
      const branchId = `${arm}-${repetition}`;
      for (let turn = 1; turn <= 4; turn += 1) {
        cells.push(panelCell({
          ordinal: ordinal++,
          arm,
          repetition,
          turn,
          branchId,
          revision,
          actorIds,
          runSeed,
          maxCostUsd,
        }));
      }
    }
  }
  for (let turn = 1; turn <= 4; turn += 1) {
    cells.push(panelCell({
      ordinal: ordinal++,
      arm: "control",
      repetition: 1,
      turn,
      branchId: "control-1",
      revision: baseline,
      actorIds,
      runSeed,
      maxCostUsd,
    }));
  }
  if (cells.length !== PROMPT_THREAD_TOTAL_CALLS) {
    throw new Error("invalid panel cardinality");
  }
  return cells;
}

export async function createPromptThreadPanelManifest(
  input: PanelPreflightInput,
  dependencies: PanelPreflightDependencies = {},
): Promise<PromptThreadPanelManifest> {
  const caseArtifact = parseArtifact(input.caseValue);
  if (caseArtifact.kind !== "frozen_case" ||
      input.sourceFidelity.status !== "matched" ||
      input.sourceFidelity.caseId !== caseArtifact.caseId ||
      input.sourceFidelity.turnCount !== 4 ||
      input.sourceFidelity.sourceMutation !== false) {
    throw new Error("Panel preflight requires a matching source-fidelity receipt");
  }
  assertEvidenceCardApproval(input.caseValue, input.evidenceDraft, input.evidenceApproval);
  if (input.modelSnapshot !== PROMPT_THREAD_PANEL_MODEL) {
    throw new Error("Panel preflight model snapshot is not supported");
  }
  if (input.baseline.harnessDigest !== input.candidate.harnessDigest) {
    throw new Error("Non-variant harness digest mismatch");
  }
  if (
    input.verdictScope === "full" &&
    (!input.historyEnabled ||
      input.baseline.compilerPolicyDigest === input.candidate.compilerPolicyDigest)
  ) {
    throw new Error("Full verdict scope requires a candidate recall-policy delta");
  }
  const inspect = dependencies.inspectCheckout ?? inspectGitCheckout;
  const inspectHandshake = dependencies.inspectWorkerHandshake
    ?? ((revision: PromptThreadRevision) => readTrustedWorkerHandshake(
      revision.checkoutPath,
      revision.harnessDigest,
      process.execPath,
    ));
  for (const revision of [input.baseline, input.candidate]) {
    const checkout = await inspect(revision.checkoutPath);
    if (checkout.dirty || checkout.commitSha !== revision.commitSha) {
      throw new Error(`Checkout ${revision.arm} is dirty or SHA-mismatched`);
    }
    const handshake = await inspectHandshake(revision);
    validateHandshake(
      createPromptThreadWorkerHandshake(revision.harnessDigest),
      handshake,
      ["prompt-thread-worker"],
    );
  }
  const quote = quoteProviderUsageCeiling({
    modelSnapshot: input.modelSnapshot,
    promptTokenCeiling: input.estimatedInputTokensPerCall,
    cachedPromptTokenCeiling: 0,
    outputTokenCeiling: input.maximumOutputTokensPerCall,
  });
  if (quote.status !== "estimated" ||
      quote.estimatedCostUsd === undefined ||
      !quote.rateCardVersion ||
      !quote.pricingSourceId) {
    throw new Error("Panel preflight has no pinned snapshot rate-card mapping");
  }
  const quotedMaximumSpendUsd = quote.estimatedCostUsd * PROMPT_THREAD_TOTAL_CALLS;
  if (
    !Number.isFinite(input.maximumSpendUsd) ||
    input.maximumSpendUsd < quotedMaximumSpendUsd
  ) {
    throw new Error("Panel spend cap is below the conservative 28-call ceiling");
  }
  const createdAt = (input.now ?? new Date()).toISOString();
  const caseHash = hashCanonicalJson(input.caseValue);
  const evidenceCardHash = hashCanonicalJson(input.evidenceDraft);
  const runSeed = hashCanonicalJson({
    caseHash,
    evidenceCardHash,
    baseline: input.baseline.commitSha,
    candidate: input.candidate.commitSha,
    createdAt,
  });
  const cells = planPromptThreadPanel(input.verdictScope, input.historyEnabled, {
    baseline: input.baseline,
    candidate: input.candidate,
    actorIds: input.actorIds,
    runSeed,
    maxCostUsdPerCell: quote.estimatedCostUsd,
  });
  const runId = `panel-${runSeed.slice("sha256:".length, "sha256:".length + 24)}`;
  const manifest: PromptThreadPanelManifest = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "run_manifest",
    createdAt,
    runId,
    caseHash,
    sourceReceiptHash: input.caseValue.sourceReceiptHash,
    evidenceCardHash,
    maximumCalls: PROMPT_THREAD_TOTAL_CALLS,
    maximumSpendUsd: input.maximumSpendUsd,
    verdictScope: input.verdictScope,
    modelSnapshot: input.modelSnapshot,
    requestedServiceTier: input.requestedServiceTier,
    zdrStatus: input.zdrStatus,
    runtimeHash: input.runtimeHash,
    actionSchemaHash: input.actionSchemaHash,
    rateCardVersion: quote.rateCardVersion,
    pricingSourceId: quote.pricingSourceId,
    baseline: structuredClone(input.baseline),
    candidate: structuredClone(input.candidate),
    cells,
  };
  parseArtifact(manifest);
  return manifest;
}

export function approvePromptThreadPanel(
  manifest: PromptThreadPanelManifest,
  operator: string,
  now = new Date(),
): PaidApprovalArtifact {
  if (!operator.trim()) throw new Error("Panel approval requires an operator");
  return createApproval(manifest, {
    kind: "paid_approval",
    operator,
    maximumCalls: manifest.maximumCalls,
    maximumSpendUsd: manifest.maximumSpendUsd,
    createdAt: now.toISOString(),
  });
}

export async function initializePromptThreadPanelRun(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  approval: PaidApprovalArtifact,
): Promise<void> {
  assertPanelApproval(manifest, approval);
  await withRunMutationLock(workspace, manifest.runId, async (lock) => {
    await atomicWriteArtifact(
      lock,
      `runs/${manifest.runId}/run-manifest.json`,
      manifest as unknown as ArtifactEnvelope,
    );
    await atomicWriteArtifact(
      lock,
      `runs/${manifest.runId}/paid-approval.json`,
      approval,
    );
    for (const cell of manifest.cells) {
      await appendCellTransition(lock, { cellId: cell.cellId, stage: "planned" });
    }
  });
}

export async function runPromptThreadPanel(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  approval: PaidApprovalArtifact,
  caseValue: FrozenCaseArtifact,
  evidenceDraft: PromptThreadEvidenceCard,
  evidenceApproval: EvidenceCardApprovalArtifact,
  dependencies: RunPanelDependencies,
): Promise<StructuralRunSummary> {
  assertPanelApproval(manifest, approval);
  assertRunInputs(manifest, caseValue, evidenceDraft, evidenceApproval);
  await dependencies.validateCheckouts();
  const recovered = await recoverOrInvalidateRun(workspace, manifest.runId);
  if (recovered.lifecycle !== "running") return recovered;
  return withRunMutationLock(workspace, manifest.runId, async (lock) => {
    const inspection = await inspectRunRecovery(workspace, manifest.runId);
    if (inspection.invalidReason) {
      return invalidateRunUnderLock(lock, inspection.invalidReason);
    }
    const stages = latestCellStages(inspection.transitions);
    const completedIds = completedCellIds(manifest.cells, stages);
    const brokeredIds = providerCompletedCellIds(
      manifest.cells,
      stages,
    );
    const broker = new PromptThreadProviderBroker(
      manifest.cells.map((cell) => ({
        cellId: cell.cellId,
        ordinal: cell.ordinal,
        actorId: cell.actorId,
        lineage: cell.actorLineage,
        firstCall: cell.firstCall,
        requestedServiceTier: manifest.requestedServiceTier,
        maxCostUsd: cell.maxCostUsd,
        controlReturnTurn: cell.controlReturnTurn,
      })),
      manifest.maximumSpendUsd,
      { completedCellIds: brokeredIds },
    );
    try {
      for (const cell of manifest.cells) {
        if (dependencies.stopBeforeCell?.()) break;
        const stage = stages.get(cell.cellId);
        if (stage === "completed") continue;
        if (stage === "applied") {
          const pending = await readCheckpoint(
            workspace,
            manifest.runId,
            cell.cellId,
            "pending-checkpoint.json",
          );
          await recordContinuationCheckpoint(lock, cell.cellId, pending);
          await appendCellTransition(lock, { cellId: cell.cellId, stage: "completed" });
          completedIds.push(cell.cellId);
          continue;
        }
        if (stage === "checkpoint_committed") {
          await appendCellTransition(lock, { cellId: cell.cellId, stage: "completed" });
          completedIds.push(cell.cellId);
          continue;
        }
        if (stage !== "planned" && stage !== "response_recorded") {
          throw new Error(`Cell ${cell.cellId} is not safely resumable from ${stage ?? "none"}`);
        }
        const prior = await priorBranchCheckpoint(workspace, manifest, cell);
        const savedResponse = stage === "response_recorded"
          ? await savedProviderResponse(workspace, manifest.runId, cell.cellId)
          : undefined;
        const handshake = await dependencies.workerHandshake(cell);
        const workerCell = toWorkerCell(manifest, cell);
        const result = await dependencies.runWorker({
          handshake,
          caseValue,
          evidenceDraft: evidenceDraft as unknown as EvidenceCardDraftArtifact,
          evidenceApproval,
          cell: workerCell,
          expected: {
            revision: workerCell.revision,
            runtimeHash: manifest.runtimeHash,
            actionSchemaHash: manifest.actionSchemaHash,
            harnessDigest: workerCell.harnessDigest,
          },
          mutationLock: lock,
          branchState: prior?.privateState.branchState as PromptThreadWorkerBranchState | undefined,
          ...(savedResponse !== undefined
            ? { savedResponse }
            : {
                brokerTransport: (request) => broker.dispatch(
                  lock,
                  { cellId: cell.cellId, model: manifest.modelSnapshot, request },
                  dependencies.providerDispatch,
                  { alreadyPlanned: true },
                ).then(({ response }) => response),
              }),
        });
        await atomicWriteArtifact(
          lock,
          `runs/${manifest.runId}/cells/${cell.cellId}/pending-checkpoint.json`,
          result.checkpoint,
        );
        await appendCellTransition(lock, { cellId: cell.cellId, stage: "applied" });
        await recordContinuationCheckpoint(lock, cell.cellId, result.checkpoint);
        await appendCellTransition(lock, { cellId: cell.cellId, stage: "completed" });
        completedIds.push(cell.cellId);
        if (dependencies.stopAfterCell?.()) break;
      }
    } catch (error) {
      return invalidateRunUnderLock(
        lock,
        error instanceof Error ? `panel_failure_${error.name}` : "panel_failure_unknown",
      );
    }
    const after = await inspectRunRecovery(workspace, manifest.runId);
    return structuralPanelStatus(
      manifest.cells,
      completedCellIds(manifest.cells, latestCellStages(after.transitions)),
      manifest.runId,
    );
  });
}

async function readTrustedWorkerHandshake(
  checkoutPath: string,
  harnessDigest: string,
  bunExecutable: string,
): Promise<ProtocolHandshake> {
  const workerPath = join(
    checkoutPath,
    "packages/engine/src/prompt-thread-worker.ts",
  );
  const child = Bun.spawn(
    [bunExecutable, workerPath, "handshake"],
    {
      cwd: checkoutPath,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Trusted worker handshake failed: ${structuralWorkerError(stderr)}`);
  }
  const handshake = JSON.parse(stdout) as ProtocolHandshake;
  validateHandshake(
    createPromptThreadWorkerHandshake(harnessDigest),
    handshake,
    ["prompt-thread-worker"],
  );
  return handshake;
}

async function runTrustedCheckoutWorker(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  invocation: PanelWorkerInvocation,
  bunExecutable: string,
): Promise<PromptThreadWorkerResult> {
  const revision = revisionForWorker(manifest, invocation.cell.revision);
  const brokerToken = randomUUID();
  let brokerCalls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (
        request.method !== "POST"
        || request.headers.get("authorization") !== `Bearer ${brokerToken}`
        || brokerCalls > 0
        || !invocation.brokerTransport
      ) {
        return Response.json({ code: "broker_request_rejected" }, { status: 403 });
      }
      brokerCalls += 1;
      try {
        const value = await invocation.brokerTransport(
          await request.json() as Record<string, unknown>,
        );
        return Response.json(value);
      } catch {
        return Response.json({ code: "broker_dispatch_failed" }, { status: 502 });
      }
    },
  });
  const base = `runs/${manifest.runId}/cells/${invocation.cell.cellId}`;
  const inputRelative = `${base}/worker-input.json`;
  const outputRelative = `${base}/worker-output.json`;
  try {
    const inputPath = await atomicWriteJson(
      invocation.mutationLock,
      inputRelative,
      {
        input: {
          handshake: invocation.handshake,
          caseValue: invocation.caseValue,
          evidenceDraft: invocation.evidenceDraft,
          evidenceApproval: invocation.evidenceApproval,
          cell: invocation.cell,
          expected: invocation.expected,
          ...(invocation.branchState !== undefined && {
            branchState: invocation.branchState,
          }),
          ...(invocation.savedResponse !== undefined && {
            savedResponse: invocation.savedResponse,
          }),
        },
        brokerUrl: new URL("/", server.url).toString(),
        brokerToken,
      },
      { overwrite: true },
    );
    const outputPath = join(workspace.root, outputRelative);
    const workerPath = join(
      revision.checkoutPath,
      "packages/engine/src/prompt-thread-worker.ts",
    );
    const child = Bun.spawn(
      [bunExecutable, workerPath, "run", inputPath, outputPath],
      {
        cwd: revision.checkoutPath,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`Trusted worker failed: ${structuralWorkerError(stderr)}`);
    }
    const structural = JSON.parse(stdout) as { status?: string };
    if (structural.status !== "completed") {
      throw new Error("Trusted worker returned an invalid structural status");
    }
    const result = await readPrivateJson(
      workspace,
      outputRelative,
    ) as PromptThreadWorkerResult;
    const checkpoint = parseArtifact(result.checkpoint);
    if (
      checkpoint.kind !== "continuation_checkpoint"
      || checkpoint.cellId !== invocation.cell.cellId
      || result.branchState.appliedCellIds.at(-1) !== invocation.cell.cellId
      || (invocation.savedResponse === undefined && brokerCalls !== 1)
      || (invocation.savedResponse !== undefined && brokerCalls !== 0)
    ) {
      throw new Error("Trusted worker result failed protocol validation");
    }
    return result;
  } finally {
    server.stop(true);
  }
}

export function structuralPanelStatus(
  cells: readonly PromptThreadPanelCell[],
  completedCellIdsValue: readonly string[],
  runId = "unpersisted",
): StructuralRunSummary {
  const completed = new Set(completedCellIdsValue);
  const next = cells.find((cell) => !completed.has(cell.cellId));
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId,
    lifecycle: next ? "running" : "completed",
    completedCells: completed.size,
    outstandingCells: cells.length - completed.size,
    reservedSpendUsd: cells.reduce((sum, cell) => sum + cell.maxCostUsd, 0),
    settledSpendUsd: 0,
    nextActions: next ? ["dispatch"] : [],
    requiresHuman: false,
  };
}

function panelCell(input: {
  ordinal: number;
  arm: PromptThreadArm;
  repetition: number;
  turn: number;
  branchId: string;
  revision: PromptThreadRevision;
  actorIds: readonly [string, string];
  runSeed: string;
  maxCostUsd: number;
}): PromptThreadPanelCell {
  const actorIndex = input.turn % 2 === 1 ? 0 : 1;
  const actor = actorIndex === 0 ? "finn" : "lyra";
  const actorId = input.actorIds[actorIndex];
  return {
    cellId: `${input.arm}-${input.repetition}-${input.turn}`,
    ordinal: input.ordinal,
    branchId: input.branchId,
    arm: input.arm,
    repetition: input.repetition,
    turn: input.turn,
    actor,
    actorId,
    actorLineage: `influence:${hashCanonicalJson({
      runSeed: input.runSeed,
      branchId: input.branchId,
      actorId,
    }).slice("sha256:".length, "sha256:".length + 24)}`,
    firstCall: input.turn <= 2,
    controlReturnTurn: input.arm === "control" && input.turn >= 3,
    revision: input.revision.commitSha,
    checkoutPath: input.revision.checkoutPath,
    maxCostUsd: input.maxCostUsd,
  };
}

function placeholderRevision(arm: "baseline" | "candidate"): PromptThreadRevision {
  return {
    arm,
    checkoutPath: `/placeholder/${arm}`,
    commitSha: arm,
    compilerPolicyDigest: arm,
    harnessDigest: "placeholder",
  };
}

async function inspectGitCheckout(path: string): Promise<CheckoutInspection> {
  const [{ stdout: sha }, { stdout: status }] = await Promise.all([
    execFile("git", ["-C", path, "rev-parse", "HEAD"]),
    execFile("git", ["-C", path, "status", "--porcelain"]),
  ]);
  return { commitSha: sha.trim(), dirty: status.trim().length > 0 };
}

function assertPanelApproval(
  manifest: PromptThreadPanelManifest,
  approval: PaidApprovalArtifact,
): void {
  const artifact = parseArtifact(approval);
  if (
    artifact.kind !== "paid_approval" ||
    artifact.targetHash !== hashCanonicalJson(manifest) ||
    artifact.maximumCalls !== manifest.maximumCalls ||
    artifact.maximumSpendUsd !== manifest.maximumSpendUsd
  ) {
    throw new Error("Paid panel approval is stale or cap-mismatched");
  }
}

function assertRunInputs(
  manifest: PromptThreadPanelManifest,
  caseValue: FrozenCaseArtifact,
  evidenceDraft: PromptThreadEvidenceCard,
  evidenceApproval: EvidenceCardApprovalArtifact,
): void {
  if (
    manifest.caseHash !== hashCanonicalJson(caseValue) ||
    manifest.evidenceCardHash !== hashCanonicalJson(evidenceDraft)
  ) {
    throw new Error("Panel inputs changed after approval");
  }
  assertEvidenceCardApproval(caseValue, evidenceDraft, evidenceApproval);
}

function latestCellStages(
  transitions: readonly { cellId: string; stage: string }[],
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const transition of transitions) {
    latest.set(transition.cellId, transition.stage);
  }
  return latest;
}

function completedCellIds(
  cells: readonly PromptThreadPanelCell[],
  stages: ReadonlyMap<string, string>,
): string[] {
  return cells
    .filter((cell) => stages.get(cell.cellId) === "completed")
    .map((cell) => cell.cellId);
}

function providerCompletedCellIds(
  cells: readonly PromptThreadPanelCell[],
  stages: ReadonlyMap<string, string>,
): string[] {
  const providerCompleteStages = new Set([
    "response_recorded",
    "applied",
    "checkpoint_committed",
    "completed",
  ]);
  return cells
    .filter((cell) => providerCompleteStages.has(stages.get(cell.cellId) ?? ""))
    .map((cell) => cell.cellId);
}

async function savedProviderResponse(
  workspace: PrivateWorkspace,
  runId: string,
  cellId: string,
): Promise<unknown> {
  const artifact = await readArtifact(
    workspace,
    `runs/${runId}/cells/${cellId}/provider-result.json`,
  );
  if (artifact.kind !== "provider_result" || artifact.status !== "completed") {
    throw new Error("Saved provider result is incomplete");
  }
  return (artifact.privateResponse as JsonObject).response;
}

async function readCheckpoint(
  workspace: PrivateWorkspace,
  runId: string,
  cellId: string,
  name: string,
): Promise<ContinuationCheckpointArtifact> {
  const artifact = await readArtifact(
    workspace,
    `runs/${runId}/cells/${cellId}/${name}`,
  );
  if (artifact.kind !== "continuation_checkpoint") {
    throw new Error("Expected continuation checkpoint");
  }
  return artifact as ContinuationCheckpointArtifact;
}

async function priorBranchCheckpoint(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  cell: PromptThreadPanelCell,
): Promise<ContinuationCheckpointArtifact | null> {
  const prior = [...manifest.cells]
    .filter((candidate) => (
      candidate.branchId === cell.branchId &&
      candidate.turn < cell.turn
    ))
    .sort((left, right) => right.turn - left.turn)[0];
  return prior
    ? readCheckpoint(workspace, manifest.runId, prior.cellId, "continuation-checkpoint.json")
    : null;
}

function toWorkerCell(
  manifest: PromptThreadPanelManifest,
  cell: PromptThreadPanelCell,
): PromptThreadWorkerCell {
  const revision = cell.arm === "candidate" ? manifest.candidate : manifest.baseline;
  return {
    cellId: cell.cellId,
    branchId: cell.branchId,
    turn: cell.turn,
    actorId: cell.actorId,
    actorLineage: cell.actorLineage,
    model: manifest.modelSnapshot,
    revision: revision.commitSha,
    runtimeHash: manifest.runtimeHash,
    actionSchemaHash: manifest.actionSchemaHash,
    harnessDigest: revision.harnessDigest,
  };
}

function revisionForCell(
  manifest: PromptThreadPanelManifest,
  cell: PromptThreadPanelCell,
): PromptThreadRevision {
  return cell.arm === "candidate" ? manifest.candidate : manifest.baseline;
}

function revisionForWorker(
  manifest: PromptThreadPanelManifest,
  commitSha: string,
): PromptThreadRevision {
  const revision = [manifest.baseline, manifest.candidate]
    .find((candidate) => candidate.commitSha === commitSha);
  if (!revision) throw new Error("Worker revision is not part of the approved manifest");
  return revision;
}

function structuralWorkerError(stderr: string): string {
  for (const line of stderr.trim().split("\n").reverse()) {
    try {
      const value = JSON.parse(line) as { code?: unknown };
      if (typeof value.code === "string") return value.code;
    } catch {
      // Worker stderr may contain runtime diagnostics. Never surface private text.
    }
  }
  return "worker_failed";
}
