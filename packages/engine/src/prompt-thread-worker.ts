import {
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  createHandshake,
  hashCanonicalJson,
  parseArtifact,
  validateHandshake,
  type ContinuationCheckpointArtifact,
  type EvidenceCardApprovalArtifact,
  type EvidenceCardDraftArtifact,
  type FrozenCaseArtifact,
  type JsonValue,
  type ProtocolHandshake,
} from "@influence/prompt-lab-protocol";
import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  runPromptThreadMingleIntentProbe,
  runPromptThreadGeneratedCell,
  type PromptThreadMingleIntentProbeResult,
  type PromptThreadGeneratedCellResult,
} from "./prompt-thread-lab";

export interface PromptThreadWorkerCell {
  cellId: string;
  branchId: string;
  turn: number;
  actorId: string;
  actorLineage: string;
  model: string;
  revision: string;
  compilerPolicyDigest: string;
  runtimeHash: string;
  actionSchemaHash: string;
  harnessDigest: string;
}

export interface PromptThreadWorkerHandshake extends ProtocolHandshake {
  compilerPolicyDigest: string;
  actionSchemaHash: string;
}

export interface PromptThreadWorkerBranchState {
  appliedCellIds: string[];
  actorLineages: Record<string, string>;
  providerResponses: unknown[];
}

export interface PromptThreadWorkerInput {
  handshake: ProtocolHandshake;
  caseValue: FrozenCaseArtifact;
  evidenceDraft: EvidenceCardDraftArtifact;
  evidenceApproval: EvidenceCardApprovalArtifact;
  cell: PromptThreadWorkerCell;
  expected: Pick<
    PromptThreadWorkerCell,
    "revision" | "compilerPolicyDigest" | "runtimeHash" | "actionSchemaHash" | "harnessDigest"
  >;
  branchState?: PromptThreadWorkerBranchState;
  savedResponse?: unknown;
  brokerTransport?: (request: Record<string, unknown>) => Promise<unknown>;
}

export interface PromptThreadWorkerResult {
  dispatched: boolean;
  request?: Record<string, unknown>;
  response: unknown;
  branchState: PromptThreadWorkerBranchState;
  checkpoint: ContinuationCheckpointArtifact;
}

export interface PromptThreadIntentProbeWorkerResult {
  status: "completed";
  caseHash: string;
  handshake: PromptThreadWorkerHandshake;
  probe: PromptThreadMingleIntentProbeResult;
}

export interface PromptThreadIntentProbeWorkerDependencies {
  computeHarnessDigest?: () => Promise<string>;
  computePolicyDigest?: () => Promise<string>;
  computeActionSchemaHash?: () => Promise<string>;
  executeProbe?: (
    caseValue: FrozenCaseArtifact,
  ) => Promise<PromptThreadMingleIntentProbeResult>;
}

export class PromptThreadWorkerError extends Error {
  constructor(readonly code:
    | "protocol_mismatch"
    | "input_mismatch"
    | "duplicate_cell"
    | "missing_transport"
    | "provider_failure"
    | "worker_failure") {
    super(`Prompt-thread worker rejected cell: ${code}`);
  }
}

export interface PromptThreadWorkerDependencies {
  executeCell?: (
    caseValue: FrozenCaseArtifact,
    input: {
      turn: 1 | 2 | 3 | 4;
      model: string;
      promptCacheKey: string;
      previousResponses: unknown[];
      dispatch: (request: Record<string, unknown>) => Promise<unknown>;
    },
  ) => Promise<PromptThreadGeneratedCellResult>;
}

/**
 * Trusted local revision-worker boundary. It never constructs an OpenAI client:
 * the injected broker transport is the sole outbound seam. Each cell rebuilds
 * its branch through this checkout's real Mingle path before applying the
 * current provider response.
 */
export async function runPromptThreadWorker(
  input: PromptThreadWorkerInput,
  dependencies: PromptThreadWorkerDependencies = {},
): Promise<PromptThreadWorkerResult> {
  validateWorkerInput(input);
  const branchState = freshBranchState(input.branchState);
  if (branchState.appliedCellIds.includes(input.cell.cellId)) {
    throw new PromptThreadWorkerError("duplicate_cell");
  }
  const existingLineage = branchState.actorLineages[input.cell.actorId];
  if (existingLineage && existingLineage !== input.cell.actorLineage) {
    throw new PromptThreadWorkerError("input_mismatch");
  }

  const saved = input.savedResponse;
  if (saved === undefined && !input.brokerTransport) {
    throw new PromptThreadWorkerError("missing_transport");
  }
  let dispatched = false;
  const executeCell = dependencies.executeCell ?? runPromptThreadGeneratedCell;
  let generated: PromptThreadGeneratedCellResult;
  try {
    generated = await executeCell(input.caseValue, {
      turn: workerTurn(input.cell.turn),
      model: input.cell.model,
      promptCacheKey: input.cell.actorLineage,
      previousResponses: structuredClone(branchState.providerResponses),
      dispatch: async (request) => {
        if (saved !== undefined) return structuredClone(saved);
        dispatched = true;
        try {
          return await input.brokerTransport!(request);
        } catch {
          throw new PromptThreadWorkerError("provider_failure");
        }
      },
    });
  } catch (error) {
    if (error instanceof PromptThreadWorkerError) throw error;
    throw new PromptThreadWorkerError("worker_failure");
  }
  const { request, response } = generated;
  branchState.appliedCellIds.push(input.cell.cellId);
  branchState.actorLineages[input.cell.actorId] = input.cell.actorLineage;
  branchState.providerResponses.push(structuredClone(response));
  const checkpoint: ContinuationCheckpointArtifact = {
    ...generated.checkpoint,
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "continuation_checkpoint",
    createdAt: new Date().toISOString(),
    branchId: input.cell.branchId,
    cellId: input.cell.cellId,
    turn: input.cell.turn,
    privateState: {
      caseHash: hashCanonicalJson(input.caseValue),
      cardHash: hashCanonicalJson(input.evidenceDraft),
      appliedCellIds: [...branchState.appliedCellIds],
      actorLineages: structuredClone(branchState.actorLineages),
      branchState: jsonValue(branchState),
      applied: generated.checkpoint.privateState,
      selectionExplanation: jsonValue(
        generated.capture.selectionExplanations.at(-1) ?? null,
      ),
    },
  };
  parseArtifact(checkpoint);
  return { dispatched, request, response, branchState, checkpoint };
}

export function createPromptThreadWorkerHandshake(input: {
  harnessDigest: string;
  compilerPolicyDigest: string;
  actionSchemaHash: string;
}): PromptThreadWorkerHandshake {
  return {
    ...createHandshake({
      capabilities: [
        "prompt-thread-worker",
        "saved-response-apply",
        "broker-transport-only",
      ],
      harnessDigest: input.harnessDigest,
    }),
    compilerPolicyDigest: input.compilerPolicyDigest,
    actionSchemaHash: input.actionSchemaHash,
  };
}

export async function runPromptThreadWorkerIntentProbe(
  caseValue: FrozenCaseArtifact,
  dependencies: PromptThreadIntentProbeWorkerDependencies = {},
): Promise<PromptThreadIntentProbeWorkerResult> {
  const parsed = parseArtifact(caseValue);
  if (parsed.kind !== "frozen_case") {
    throw new PromptThreadWorkerError("input_mismatch");
  }
  const [harnessDigest, compilerPolicyDigest, actionSchemaHash] = await Promise.all([
    dependencies.computeHarnessDigest?.() ?? computePromptThreadWorkerHarnessDigest(),
    dependencies.computePolicyDigest?.() ?? computePromptThreadWorkerPolicyDigest(),
    dependencies.computeActionSchemaHash?.() ?? computePromptThreadWorkerActionSchemaHash(),
  ]);
  const probe = await (
    dependencies.executeProbe ?? runPromptThreadMingleIntentProbe
  )(caseValue);
  if (
    probe.providerCalls !== 0
    || probe.caseId !== caseValue.caseId
    || probe.probes.length !== 2
    || probe.probes.some((item) => (
      item.action !== "mingle-intent"
      || item.promptClass !== "strategic_decision"
    ))
  ) {
    throw new PromptThreadWorkerError("worker_failure");
  }
  return {
    status: "completed",
    caseHash: hashCanonicalJson(caseValue),
    handshake: createPromptThreadWorkerHandshake({
      harnessDigest,
      compilerPolicyDigest,
      actionSchemaHash,
    }),
    probe,
  };
}

const PROMPT_THREAD_WORKER_EXTERNAL_HARNESS_FILES = [
  "bun.lock",
  "packages/api/src/services/prompt-thread-provider-broker.ts",
  "packages/prompt-lab-protocol/src/schemas.ts",
] as const;

export async function listPromptThreadWorkerHarnessFiles(
  checkoutRoot = resolve(import.meta.dir, "../../.."),
): Promise<string[]> {
  const engineRoot = join(checkoutRoot, "packages/engine/src");
  const engineFiles = (await listTypeScriptFiles(engineRoot))
    .map((path) => relative(checkoutRoot, path))
    .filter((path) => (
      !path.includes("/__tests__/")
      && !path.endsWith(".test.ts")
      && path !== "packages/engine/src/context-recall-plan.ts"
    ));
  return [...new Set([
    ...PROMPT_THREAD_WORKER_EXTERNAL_HARNESS_FILES,
    ...engineFiles,
  ])].sort();
}

export async function computePromptThreadWorkerHarnessDigest(
  checkoutRoot = resolve(import.meta.dir, "../../.."),
): Promise<string> {
  const digest = createHash("sha256");
  digest.update(`bun:${Bun.version}\n`);
  for (const relativePath of await listPromptThreadWorkerHarnessFiles(checkoutRoot)) {
    digest.update(`${relativePath}\0`);
    digest.update(await readFile(join(checkoutRoot, relativePath)));
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}

export async function computePromptThreadWorkerPolicyDigest(
  checkoutRoot = resolve(import.meta.dir, "../../.."),
): Promise<string> {
  return fileDigest(join(
    checkoutRoot,
    "packages/engine/src/context-recall-plan.ts",
  ));
}

export async function computePromptThreadWorkerActionSchemaHash(
  checkoutRoot = resolve(import.meta.dir, "../../.."),
): Promise<string> {
  return fileDigest(join(checkoutRoot, "packages/engine/src/agent.ts"));
}

function validateWorkerInput(input: PromptThreadWorkerInput): void {
  try {
    validateHandshake(
      createPromptThreadWorkerHandshake({
        harnessDigest: input.cell.harnessDigest,
        compilerPolicyDigest: input.cell.compilerPolicyDigest,
        actionSchemaHash: input.cell.actionSchemaHash,
      }),
      input.handshake,
      ["prompt-thread-worker"],
    );
  } catch {
    throw new PromptThreadWorkerError("protocol_mismatch");
  }
  const caseArtifact = parseArtifact(input.caseValue);
  const draft = parseArtifact(input.evidenceDraft);
  const approval = parseArtifact(input.evidenceApproval);
  if (caseArtifact.kind !== "frozen_case" || draft.kind !== "evidence_card_draft" || approval.kind !== "evidence_card_approval") {
    throw new PromptThreadWorkerError("input_mismatch");
  }
  if (
    approval.caseHash !== hashCanonicalJson(caseArtifact)
    || approval.cardHash !== hashCanonicalJson(draft)
    || input.cell.revision !== input.expected.revision
    || input.cell.compilerPolicyDigest !== input.expected.compilerPolicyDigest
    || input.cell.runtimeHash !== input.expected.runtimeHash
    || input.cell.actionSchemaHash !== input.expected.actionSchemaHash
    || input.cell.harnessDigest !== input.expected.harnessDigest
    || input.cell.turn < 1
    || !Number.isInteger(input.cell.turn)
    || !input.cell.actorLineage
    || (input.branchState?.appliedCellIds?.length ?? 0) !== input.cell.turn - 1
    || (input.branchState?.providerResponses?.length ?? 0) !== input.cell.turn - 1
  ) {
    throw new PromptThreadWorkerError("input_mismatch");
  }
  if (
    input.handshake.protocolVersion !== PROTOCOL_VERSION
    || input.handshake.schemaHash !== PROTOCOL_SCHEMA_HASH
    || input.handshake.canonicalizerId !== CANONICALIZER_ID
    || input.handshake.canonicalizerVersion !== CANONICALIZER_VERSION
    || input.handshake.compilerPolicyDigest !== input.cell.compilerPolicyDigest
    || input.handshake.actionSchemaHash !== input.cell.actionSchemaHash
  ) {
    throw new PromptThreadWorkerError("protocol_mismatch");
  }
}

async function fileDigest(path: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

function freshBranchState(value: PromptThreadWorkerBranchState | undefined): PromptThreadWorkerBranchState {
  return {
    appliedCellIds: [...(value?.appliedCellIds ?? [])],
    actorLineages: { ...(value?.actorLineages ?? {}) },
    providerResponses: structuredClone(value?.providerResponses ?? []),
  };
}

function workerTurn(value: number): 1 | 2 | 3 | 4 {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new PromptThreadWorkerError("input_mismatch");
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

interface WorkerRunFile {
  input: Omit<PromptThreadWorkerInput, "brokerTransport">;
  brokerUrl: string;
  brokerToken: string;
}

async function runWorkerFile(inputPath: string, outputPath: string): Promise<void> {
  const envelope = JSON.parse(await readFile(inputPath, "utf8")) as WorkerRunFile;
  const result = await runPromptThreadWorker({
    ...envelope.input,
    brokerTransport: async (request) => {
      const response = await fetch(envelope.brokerUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${envelope.brokerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Broker rejected worker request: ${response.status}`);
      return response.json();
    },
  });
  const temporaryPath = join(dirname(outputPath), `.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(result), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, outputPath);
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "handshake") {
    const [harnessDigest, compilerPolicyDigest, actionSchemaHash] = await Promise.all([
      computePromptThreadWorkerHarnessDigest(),
      computePromptThreadWorkerPolicyDigest(),
      computePromptThreadWorkerActionSchemaHash(),
    ]);
    process.stdout.write(`${JSON.stringify(createPromptThreadWorkerHandshake({
      harnessDigest,
      compilerPolicyDigest,
      actionSchemaHash,
    }))}\n`);
    return;
  }
  if (command === "run") {
    const [inputPath, outputPath] = rest;
    if (!inputPath || !outputPath) throw new Error("run requires private input and output paths");
    await runWorkerFile(inputPath, outputPath);
    process.stdout.write('{"status":"completed"}\n');
    return;
  }
  if (command === "intent-probe") {
    const caseValue = JSON.parse(await Bun.stdin.text()) as FrozenCaseArtifact;
    process.stdout.write(
      `${JSON.stringify(await runPromptThreadWorkerIntentProbe(caseValue))}\n`,
    );
    return;
  }
  throw new Error("Expected prompt-thread-worker handshake, run, or intent-probe");
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof PromptThreadWorkerError ? error.code : "worker_failed";
    process.stderr.write(`${JSON.stringify({ code })}\n`);
    process.exitCode = 1;
  });
}
