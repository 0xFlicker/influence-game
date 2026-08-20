import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  canonicalJson,
  hashCanonicalJson,
  parseArtifact,
  parseStructuralRunSummary,
  type ArtifactEnvelope,
  type CellStage,
  type CellTransition,
  type StructuralRunSummary,
} from "@influence/prompt-lab-protocol";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SAFE_RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;
const LOCK_READY = "PROMPT_THREAD_LOCK_ACQUIRED\n";

export interface PrivateWorkspace {
  readonly root: string;
  readonly worktreeRoots: readonly string[];
}

export interface RunMutationLock {
  readonly workspace: PrivateWorkspace;
  readonly runId: string;
  readonly lockPath: string;
  readonly active: boolean;
}

interface MutableRunMutationLock extends RunMutationLock {
  active: boolean;
  temporaryPaths: Set<string>;
}

export interface TemporaryMaterialization {
  readonly relativePath: string;
  readonly absolutePath: string;
}

export type RecoveryAction =
  | "dispatch"
  | "reapply_saved_response"
  | "commit_checkpoint"
  | "complete_cell";

export interface RunRecoveryInspection {
  readonly actions: readonly {
    cellId: string;
    action: RecoveryAction;
  }[];
  readonly transitions: readonly CellTransition[];
  readonly invalidReason: "started_without_response" | null;
}

export class WorkspaceLockUnavailableError extends Error {
  constructor(runId: string) {
    super(`Prompt-thread workspace lock is already held for ${runId}`);
    this.name = "WorkspaceLockUnavailableError";
  }
}

export async function createPrivateWorkspace(
  root: string,
  options: {
    gitWorktreeRoots?: readonly string[];
    cwd?: string;
  } = {},
): Promise<PrivateWorkspace> {
  if (!isAbsolute(root)) {
    throw new Error("Prompt-thread private workspace root must be absolute");
  }
  await assertRootEntryIsNotSymlink(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const resolvedRoot = await realpath(root);
  const worktreeRoots = options.gitWorktreeRoots
    ? await Promise.all(options.gitWorktreeRoots.map((path) => realpath(path)))
    : await discoverGitWorktreeRoots(options.cwd ?? process.cwd());
  for (const worktreeRoot of worktreeRoots) {
    if (isWithin(worktreeRoot, resolvedRoot)) {
      throw new Error(
        `Prompt-thread private workspace ${resolvedRoot} is inside git worktree ${worktreeRoot}`,
      );
    }
  }
  for (const directory of [".locks", ".tmp", "cases", "runs", "summaries"]) {
    const path = join(resolvedRoot, directory);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
  await fsyncDirectory(resolvedRoot);
  return Object.freeze({
    root: resolvedRoot,
    worktreeRoots: Object.freeze([...worktreeRoots]),
  });
}

export async function resolveArtifactPath(
  workspace: PrivateWorkspace,
  relativePath: string,
  options: { createParents?: boolean } = {},
): Promise<string> {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error("Artifact path must be a non-empty workspace-relative path");
  }
  const target = resolve(workspace.root, relativePath);
  if (!isWithin(workspace.root, target) || target === workspace.root) {
    throw new Error(`Artifact path escapes private workspace: ${relativePath}`);
  }
  const parent = resolve(target, "..");
  if (options.createParents) {
    await assertNoSymlinkBelowRoot(workspace.root, parent);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmodCreatedPathChain(workspace.root, parent);
  }
  await assertNoSymlinkBelowRoot(workspace.root, target);
  return target;
}

export async function atomicWriteArtifact(
  lockValue: RunMutationLock,
  relativePath: string,
  artifact: ArtifactEnvelope,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  const lock = requireActiveLock(lockValue);
  parseArtifact(artifact);
  return atomicWriteJson(lock, relativePath, artifact, options);
}

export async function atomicWriteJson(
  lockValue: RunMutationLock,
  relativePath: string,
  value: unknown,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  return atomicWritePrivateText(
    lockValue,
    relativePath,
    canonicalJson(value),
    options,
  );
}

export async function atomicWritePrivateText(
  lockValue: RunMutationLock,
  relativePath: string,
  value: string,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  const lock = requireActiveLock(lockValue);
  const target = await resolveArtifactPath(lock.workspace, relativePath, {
    createParents: true,
  });
  if (!options.overwrite && await pathExists(target)) {
    throw new Error(`Immutable artifact already exists: ${relativePath}`);
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  let renamed = false;
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    await chmod(temporary, 0o600);
    if (!options.overwrite && await pathExists(target)) {
      throw new Error(`Immutable artifact already exists: ${relativePath}`);
    }
    await rename(temporary, target);
    renamed = true;
    await fsyncDirectory(resolve(target, ".."));
    return target;
  } finally {
    await handle.close().catch(() => undefined);
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function readArtifact(
  workspace: PrivateWorkspace,
  relativePath: string,
): Promise<ArtifactEnvelope> {
  const target = await resolveArtifactPath(workspace, relativePath);
  await assertPrivateRegularFile(target);
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid JSON in frozen artifact ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return parseArtifact(decoded);
}

export async function readArtifactIfExists(
  workspace: PrivateWorkspace,
  relativePath: string,
): Promise<ArtifactEnvelope | null> {
  const target = await resolveArtifactPath(workspace, relativePath);
  if (!await pathExists(target)) return null;
  return readArtifact(workspace, relativePath);
}

export async function readPrivateJson(
  workspace: PrivateWorkspace,
  relativePath: string,
): Promise<unknown> {
  const target = await resolveArtifactPath(workspace, relativePath);
  await assertPrivateRegularFile(target);
  try {
    return JSON.parse(await readFile(target, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid JSON in private file ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function withRunMutationLock<T>(
  workspace: PrivateWorkspace,
  runId: string,
  callback: (lock: RunMutationLock) => Promise<T> | T,
): Promise<T> {
  assertSafeRunId(runId);
  const lockName = createHash("sha256").update(runId, "utf8").digest("hex");
  const lockPath = await resolveArtifactPath(
    workspace,
    `.locks/${lockName}.lock`,
    { createParents: true },
  );
  const lockFile = await open(lockPath, "a", 0o600);
  await lockFile.close();
  await chmod(lockPath, 0o600);

  const child = await acquireOsLock(lockPath, runId);
  const lock: MutableRunMutationLock = {
    workspace,
    runId,
    lockPath,
    active: true,
    temporaryPaths: new Set(),
  };
  const markInactive = () => {
    lock.active = false;
  };
  child.once("exit", markInactive);
  try {
    return await callback(lock);
  } finally {
    for (const temporaryPath of lock.temporaryPaths) {
      await rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
    }
    lock.temporaryPaths.clear();
    lock.active = false;
    child.removeListener("exit", markInactive);
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolveExit) => {
        child.once("exit", () => resolveExit());
      });
    }
  }
}

export async function createTemporaryMaterialization(
  lockValue: RunMutationLock,
): Promise<TemporaryMaterialization> {
  const lock = requireActiveLock(lockValue);
  const relativePath = `.tmp/materialization-${randomUUID()}`;
  const absolutePath = await resolveArtifactPath(
    lock.workspace,
    relativePath,
    { createParents: true },
  );
  await mkdir(absolutePath, { mode: 0o700 });
  await chmod(absolutePath, 0o700);
  await fsyncDirectory(resolve(absolutePath, ".."));
  lock.temporaryPaths.add(absolutePath);
  return { relativePath, absolutePath };
}

export async function promoteValidatedMaterialization(
  lockValue: RunMutationLock,
  temporary: TemporaryMaterialization,
  options: {
    contentHash: string;
    validate: () => Promise<void> | void;
  },
): Promise<{ relativePath: string; absolutePath: string }> {
  const lock = requireActiveLock(lockValue);
  if (!/^sha256:[a-f0-9]{64}$/.test(options.contentHash)) {
    throw new Error("Materialization content address must be a SHA-256 digest");
  }
  const expectedTemporaryPath = await resolveArtifactPath(
    lock.workspace,
    temporary.relativePath,
  );
  if (
    expectedTemporaryPath !== temporary.absolutePath
    || !isWithin(join(lock.workspace.root, ".tmp"), expectedTemporaryPath)
  ) {
    throw new Error("Materialization temporary path is outside the private temp root");
  }
  try {
    await options.validate();
    const relativePath = `cases/${options.contentHash.slice("sha256:".length)}`;
    const absolutePath = await resolveArtifactPath(lock.workspace, relativePath, {
      createParents: true,
    });
    if (await pathExists(absolutePath)) {
      throw new Error(`Content-addressed materialization already exists: ${options.contentHash}`);
    }
    await rename(expectedTemporaryPath, absolutePath);
    lock.temporaryPaths.delete(expectedTemporaryPath);
    await fsyncDirectory(resolve(absolutePath, ".."));
    return { relativePath, absolutePath };
  } catch (error) {
    await rm(expectedTemporaryPath, { recursive: true, force: true }).catch(() => undefined);
    lock.temporaryPaths.delete(expectedTemporaryPath);
    throw error;
  }
}

export async function appendCellTransition(
  lockValue: RunMutationLock,
  input: {
    cellId: string;
    stage: CellStage;
    artifactHash?: string;
    artifactPath?: string;
    createdAt?: string;
  },
): Promise<CellTransition> {
  const lock = requireActiveLock(lockValue);
  assertSafeRunId(lock.runId);
  assertSafeCellId(input.cellId);
  const transitions = await readTransitionJournal(lock.workspace, lock.runId);
  assertLegalNextStage(transitions, input.cellId, input.stage);
  if (
    (input.stage === "response_recorded" || input.stage === "checkpoint_committed")
    && (!input.artifactHash || !input.artifactPath)
  ) {
    throw new Error(`${input.stage} requires a durable artifact hash and path`);
  }
  if (input.artifactPath) {
    const expectedPrefix = `runs/${lock.runId}/cells/${input.cellId}/`;
    if (!input.artifactPath.startsWith(expectedPrefix)) {
      throw new Error(`${input.stage} artifact must belong to the same run and cell`);
    }
    const artifact = await readArtifact(lock.workspace, input.artifactPath);
    if (hashCanonicalJson(artifact) !== input.artifactHash) {
      throw new Error(`${input.stage} durable artifact hash does not match`);
    }
  }
  const transition = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "cell_transition" as const,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sequence: transitions.length + 1,
    cellId: input.cellId,
    stage: input.stage,
    ...(input.artifactHash ? { artifactHash: input.artifactHash } : {}),
    ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
  };
  parseArtifact(transition);
  const journalPath = await resolveArtifactPath(
    lock.workspace,
    journalRelativePath(lock.runId),
    { createParents: true },
  );
  if (await pathExists(journalPath)) await assertPrivateRegularFile(journalPath);
  const handle = await open(journalPath, "a", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(transition)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(journalPath, 0o600);
  await fsyncDirectory(resolve(journalPath, ".."));
  await atomicWriteArtifact(
    lock,
    `runs/${lock.runId}/cells/${input.cellId}/state.json`,
    transition,
    { overwrite: true },
  );
  return transition;
}

export async function recordCellProviderResult(
  lockValue: RunMutationLock,
  cellId: string,
  artifact: ArtifactEnvelope,
): Promise<CellTransition> {
  const lock = requireActiveLock(lockValue);
  if (artifact.kind !== "provider_result" || artifact.cellId !== cellId) {
    throw new Error("Provider result must match the claimed cell");
  }
  const artifactPath = `runs/${lock.runId}/cells/${cellId}/provider-result.json`;
  await atomicWriteArtifact(lock, artifactPath, artifact);
  return appendCellTransition(lock, {
    cellId,
    stage: "response_recorded",
    artifactPath,
    artifactHash: hashCanonicalJson(artifact),
  });
}

export async function recordContinuationCheckpoint(
  lockValue: RunMutationLock,
  cellId: string,
  artifact: ArtifactEnvelope,
): Promise<CellTransition> {
  const lock = requireActiveLock(lockValue);
  if (artifact.kind !== "continuation_checkpoint" || artifact.cellId !== cellId) {
    throw new Error("Continuation checkpoint must match the claimed cell");
  }
  const artifactPath = `runs/${lock.runId}/cells/${cellId}/continuation-checkpoint.json`;
  await atomicWriteArtifact(lock, artifactPath, artifact);
  return appendCellTransition(lock, {
    cellId,
    stage: "checkpoint_committed",
    artifactPath,
    artifactHash: hashCanonicalJson(artifact),
  });
}

export async function inspectRunRecovery(
  workspace: PrivateWorkspace,
  runId: string,
): Promise<RunRecoveryInspection> {
  assertSafeRunId(runId);
  const transitions = await readTransitionJournal(workspace, runId);
  const byCell = groupTransitions(transitions);
  const actions: { cellId: string; action: RecoveryAction }[] = [];
  let invalidReason: RunRecoveryInspection["invalidReason"] = null;
  for (const [cellId, cellTransitions] of [...byCell.entries()].sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    const current = cellTransitions.at(-1)?.stage;
    if (!current) continue;
    if (current === "planned") actions.push({ cellId, action: "dispatch" });
    if (current === "started") {
      const saved = await findSavedProviderResult(workspace, runId, cellId);
      if (saved) {
        actions.push({ cellId, action: "reapply_saved_response" });
      } else {
        invalidReason = "started_without_response";
      }
    }
    if (current === "response_recorded") {
      await verifyTransitionArtifact(workspace, cellTransitions.at(-1)!);
      actions.push({ cellId, action: "reapply_saved_response" });
    }
    if (current === "applied") actions.push({ cellId, action: "commit_checkpoint" });
    if (current === "checkpoint_committed") {
      await verifyTransitionArtifact(workspace, cellTransitions.at(-1)!);
      actions.push({ cellId, action: "complete_cell" });
    }
  }
  return { actions, transitions, invalidReason };
}

export async function recoverOrInvalidateRun(
  workspace: PrivateWorkspace,
  runId: string,
): Promise<StructuralRunSummary> {
  assertSafeRunId(runId);
  return withRunMutationLock(workspace, runId, async (lock) => {
    let inspection: RunRecoveryInspection;
    let settledSpendUsd: number;
    try {
      await reconcileSavedResponses(lock);
      inspection = await inspectRunRecovery(workspace, runId);
      settledSpendUsd = await readDurableProviderSettledSpendUsd(workspace, runId);
    } catch {
      return cleanupUnusableRun(lock, "failed", "invalid_journal");
    }
    if (inspection.invalidReason) {
      return cleanupUnusableRun(
        lock,
        "invalidated",
        inspection.invalidReason,
        settledSpendUsd,
      );
    }
    return structuralSummary(runId, {
      lifecycle: "running",
      completedCells: countCompletedCells(inspection.transitions),
      outstandingCells: inspection.actions.length,
      settledSpendUsd,
      nextActions: [...new Set(inspection.actions.map(({ action }) => action))],
    });
  });
}

export async function abortRun(
  workspace: PrivateWorkspace,
  runId: string,
  reasonCode: string,
): Promise<StructuralRunSummary> {
  assertSafeRunId(runId);
  return withRunMutationLock(workspace, runId, (lock) => (
    cleanupUnusableRun(lock, "aborted", reasonCode)
  ));
}

/** Used by the broker after a durable `started` call cannot produce a complete response. */
export async function invalidateRunUnderLock(
  lockValue: RunMutationLock,
  reasonCode: string,
): Promise<StructuralRunSummary> {
  return cleanupUnusableRun(lockValue, "invalidated", reasonCode);
}

export async function purgeCompletedRun(
  workspace: PrivateWorkspace,
  runId: string,
): Promise<void> {
  assertSafeRunId(runId);
  await withRunMutationLock(workspace, runId, async (lock) => {
    const inspection = await inspectRunRecovery(workspace, runId);
    if (inspection.invalidReason || inspection.actions.length > 0) {
      throw new Error("Only completed runs may be explicitly purged");
    }
    const cells = groupTransitions(inspection.transitions);
    if (cells.size === 0 || [...cells.values()].some((values) => values.at(-1)?.stage !== "completed")) {
      throw new Error("Only completed runs may be explicitly purged");
    }
    requireActiveLock(lock);
    await rm(join(workspace.root, "runs", runId), { recursive: true, force: true });
    await fsyncDirectory(join(workspace.root, "runs"));
  });
}

async function cleanupUnusableRun(
  lockValue: RunMutationLock,
  lifecycle: "invalidated" | "aborted" | "failed",
  reasonCode: string,
  knownSettledSpendUsd?: number,
): Promise<StructuralRunSummary> {
  const lock = requireActiveLock(lockValue);
  const transitions = await readTransitionJournal(lock.workspace, lock.runId)
    .catch(() => [] as CellTransition[]);
  const settledSpendUsd = knownSettledSpendUsd
    ?? await settledSpendFromTransitions(lock.workspace, lock.runId, transitions)
      .catch(() => 0);
  const summary = structuralSummary(lock.runId, {
    lifecycle,
    reasonCode,
    completedCells: countCompletedCells(transitions),
    outstandingCells: 0,
    settledSpendUsd,
    nextActions: [],
  });
  await rm(join(lock.workspace.root, "runs", lock.runId), {
    recursive: true,
    force: true,
  });
  await fsyncDirectory(join(lock.workspace.root, "runs"));
  await atomicWriteJson(
    lock,
    `summaries/${lock.runId}.json`,
    summary,
    { overwrite: true },
  );
  return summary;
}

export async function readDurableProviderSettledSpendUsd(
  workspace: PrivateWorkspace,
  runId: string,
): Promise<number> {
  assertSafeRunId(runId);
  return settledSpendFromTransitions(
    workspace,
    runId,
    await readTransitionJournal(workspace, runId),
  );
}

async function settledSpendFromTransitions(
  workspace: PrivateWorkspace,
  runId: string,
  transitions: readonly CellTransition[],
): Promise<number> {
  let settledSpendUsd = 0;
  for (const transition of transitions) {
    if (transition.stage !== "response_recorded") continue;
    const expectedPath =
      `runs/${runId}/cells/${transition.cellId}/provider-result.json`;
    if (transition.artifactPath !== expectedPath) {
      throw new Error("Provider result is not bound to its run and cell");
    }
    await verifyTransitionArtifact(workspace, transition);
    const artifact = await readArtifact(workspace, expectedPath);
    if (
      artifact.kind !== "provider_result"
      || artifact.status !== "completed"
      || artifact.cellId !== transition.cellId
    ) {
      throw new Error("Durable provider result is incomplete or mismatched");
    }
    const privateResponse = requireJsonRecord(
      artifact.privateResponse,
      "provider result payload",
    );
    const receipt = requireJsonRecord(
      privateResponse.receipt,
      "provider result receipt",
    );
    if (
      receipt.cellId !== artifact.cellId
      || receipt.requestDigest !== artifact.requestHash
    ) {
      throw new Error("Durable provider receipt identity does not match");
    }
    const costUsd = receipt.costUsd;
    if (
      typeof costUsd !== "number"
      || !Number.isFinite(costUsd)
      || costUsd < 0
    ) {
      throw new Error("Durable provider receipt cost must be non-negative");
    }
    settledSpendUsd += costUsd;
    if (!Number.isFinite(settledSpendUsd)) {
      throw new Error("Durable provider settled spend is not finite");
    }
  }
  return settledSpendUsd;
}

async function reconcileSavedResponses(lockValue: RunMutationLock): Promise<void> {
  const lock = requireActiveLock(lockValue);
  const transitions = await readTransitionJournal(lock.workspace, lock.runId);
  for (const [cellId, cellTransitions] of groupTransitions(transitions)) {
    if (cellTransitions.at(-1)?.stage !== "started") continue;
    const saved = await findSavedProviderResult(lock.workspace, lock.runId, cellId);
    if (!saved) continue;
    await appendCellTransition(lock, {
      cellId,
      stage: "response_recorded",
      artifactHash: saved.artifactHash,
      artifactPath: saved.artifactPath,
    });
  }
}

async function findSavedProviderResult(
  workspace: PrivateWorkspace,
  runId: string,
  cellId: string,
): Promise<{
  artifactPath: string;
  artifactHash: string;
} | null> {
  const artifactPath = `runs/${runId}/cells/${cellId}/provider-result.json`;
  const absolutePath = await resolveArtifactPath(workspace, artifactPath);
  if (!await pathExists(absolutePath)) return null;
  const artifact = await readArtifact(workspace, artifactPath);
  if (
    artifact.kind !== "provider_result"
    || artifact.cellId !== cellId
    || artifact.status !== "completed"
  ) {
    return null;
  }
  return {
    artifactPath,
    artifactHash: hashCanonicalJson(artifact),
  };
}

function structuralSummary(
  runId: string,
  input: {
    lifecycle: StructuralRunSummary["lifecycle"];
    reasonCode?: string;
    completedCells: number;
    outstandingCells: number;
    settledSpendUsd?: number;
    nextActions: string[];
  },
): StructuralRunSummary {
  return parseStructuralRunSummary({
    protocolVersion: PROTOCOL_VERSION,
    runId,
    lifecycle: input.lifecycle,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    completedCells: input.completedCells,
    outstandingCells: input.outstandingCells,
    reservedSpendUsd: 0,
    settledSpendUsd: input.settledSpendUsd ?? 0,
    nextActions: input.nextActions,
    requiresHuman: false,
  });
}

function requireJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function readTransitionJournal(
  workspace: PrivateWorkspace,
  runId: string,
): Promise<CellTransition[]> {
  const path = await resolveArtifactPath(workspace, journalRelativePath(runId));
  if (!await pathExists(path)) return [];
  await assertPrivateRegularFile(path);
  const text = await readFile(path, "utf8");
  if (text.length === 0) return [];
  if (!text.endsWith("\n")) {
    throw new Error("Invalid transition journal: truncated final record");
  }
  const transitions: CellTransition[] = [];
  for (const [index, line] of text.slice(0, -1).split("\n").entries()) {
    try {
      const artifact = parseArtifact(JSON.parse(line));
      if (artifact.kind !== "cell_transition") {
        throw new Error("record is not a cell transition");
      }
      const transition = artifact as CellTransition;
      if (transition.sequence !== index + 1) {
        throw new Error("sequence is not contiguous");
      }
      assertSafeCellId(transition.cellId);
      assertLegalNextStage(transitions, transition.cellId, transition.stage);
      transitions.push(transition);
    } catch (error) {
      throw new Error(
        `Invalid transition journal at record ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return transitions;
}

function assertLegalNextStage(
  transitions: readonly CellTransition[],
  cellId: string,
  next: CellStage,
): void {
  const previous = [...transitions].reverse().find(
    (transition) => transition.cellId === cellId,
  )?.stage;
  const expected: Record<CellStage, CellStage | null> = {
    planned: "started",
    started: "response_recorded",
    response_recorded: "applied",
    applied: "checkpoint_committed",
    checkpoint_committed: "completed",
    completed: null,
  };
  const legal = previous === undefined ? next === "planned" : expected[previous] === next;
  if (!legal) {
    throw new Error(
      `Illegal cell transition for ${cellId}: ${previous ?? "none"} -> ${next}`,
    );
  }
}

function groupTransitions(
  transitions: readonly CellTransition[],
): Map<string, CellTransition[]> {
  const grouped = new Map<string, CellTransition[]>();
  for (const transition of transitions) {
    const values = grouped.get(transition.cellId) ?? [];
    values.push(transition);
    grouped.set(transition.cellId, values);
  }
  return grouped;
}

async function verifyTransitionArtifact(
  workspace: PrivateWorkspace,
  transition: CellTransition,
): Promise<void> {
  const artifactPath = transition.artifactPath;
  const artifactHash = transition.artifactHash;
  if (typeof artifactPath !== "string" || typeof artifactHash !== "string") {
    throw new Error(`${transition.stage} is missing its durable artifact binding`);
  }
  const artifact = await readArtifact(workspace, artifactPath);
  if (hashCanonicalJson(artifact) !== artifactHash) {
    throw new Error(`${transition.stage} durable artifact changed after journaling`);
  }
}

function countCompletedCells(transitions: readonly CellTransition[]): number {
  return [...groupTransitions(transitions).values()].filter(
    (values) => values.at(-1)?.stage === "completed",
  ).length;
}

async function acquireOsLock(
  lockPath: string,
  runId: string,
): Promise<ChildProcessWithoutNullStreams> {
  const { executable, args } = await osLockCommand(lockPath);
  const child = spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolveLock, rejectLock) => {
    let stdout = "";
    const cleanup = () => {
      child.stdout.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    const onData = (chunk: string) => {
      stdout += chunk;
      if (!stdout.includes(LOCK_READY)) return;
      cleanup();
      resolveLock(child);
    };
    const onError = (error: Error) => {
      cleanup();
      rejectLock(new Error(`Unable to start OS workspace lock: ${error.message}`));
    };
    const onExit = () => {
      cleanup();
      if (stderr.trim().length > 0) {
        rejectLock(new WorkspaceLockUnavailableError(`${runId} (${stderr.trim()})`));
      } else {
        rejectLock(new WorkspaceLockUnavailableError(runId));
      }
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function osLockCommand(
  lockPath: string,
): Promise<{ executable: string; args: string[] }> {
  const shellHold = `printf '${LOCK_READY}'; cat >/dev/null`;
  if (process.platform === "darwin") {
    await requireExecutable("/usr/bin/lockf");
    return {
      executable: "/usr/bin/lockf",
      args: ["-t", "0", lockPath, "/bin/sh", "-c", shellHold],
    };
  }
  if (process.platform === "linux") {
    const executable = await firstExecutable(["/usr/bin/flock", "/bin/flock"]);
    if (!executable) {
      throw new Error("No sanctioned kernel-backed OS lock primitive is available");
    }
    return {
      executable,
      args: ["-n", lockPath, "/bin/sh", "-c", shellHold],
    };
  }
  throw new Error(`No sanctioned kernel-backed OS lock adapter for ${process.platform}`);
}

async function discoverGitWorktreeRoots(cwd: string): Promise<string[]> {
  const child = spawn("git", ["-C", cwd, "worktree", "list", "--porcelain"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.once("exit", resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error(
      `Unable to resolve git worktrees: ${Buffer.concat(stderr).toString("utf8").trim()}`,
    );
  }
  const roots = parseGitWorktreeRoots(Buffer.concat(stdout).toString("utf8"));
  if (roots.length === 0) throw new Error("No git worktrees were resolved");
  return Promise.all(roots.map((path) => realpath(path)));
}

export function parseGitWorktreeRoots(output: string): string[] {
  return output
    .trim()
    .split(/\n\n+/)
    .filter((record) => !record.split("\n").some((line) => line.startsWith("prunable")))
    .map((record) => record.split("\n").find((line) => line.startsWith("worktree ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => line.slice("worktree ".length));
}

async function assertRootEntryIsNotSymlink(root: string): Promise<void> {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink()) {
      throw new Error("Prompt-thread private workspace root must not be a symlink");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function assertNoSymlinkBelowRoot(root: string, target: string): Promise<void> {
  const pathParts = relative(root, target).split(sep).filter(Boolean);
  let cursor = root;
  for (const part of pathParts) {
    cursor = join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        throw new Error(`Artifact path traverses symlink ${cursor}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function chmodCreatedPathChain(root: string, target: string): Promise<void> {
  const pathParts = relative(root, target).split(sep).filter(Boolean);
  let cursor = root;
  for (const part of pathParts) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`Artifact path traverses symlink ${cursor}`);
    if (!info.isDirectory()) throw new Error(`Artifact parent is not a directory: ${cursor}`);
    await chmod(cursor, 0o700);
  }
}

async function assertPrivateRegularFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Private artifact is not a regular non-symlink file: ${path}`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`Private artifact has a permissive file mode: ${path}`);
  }
}

function requireActiveLock(lockValue: RunMutationLock): MutableRunMutationLock {
  const lock = lockValue as MutableRunMutationLock;
  if (!lock.active || !(lock.temporaryPaths instanceof Set)) {
    throw new Error("Workspace mutation requires a live OS-backed run lock");
  }
  return lock;
}

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId) || /^\.*$/.test(runId)) {
    throw new Error(`Unsafe prompt-thread run id: ${runId}`);
  }
}

function assertSafeCellId(cellId: string): void {
  if (!SAFE_RUN_ID.test(cellId) || /^\.*$/.test(cellId)) {
    throw new Error(`Unsafe prompt-thread cell id: ${cellId}`);
  }
}

function journalRelativePath(runId: string): string {
  return `runs/${runId}/transition-journal.jsonl`;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function requireExecutable(path: string): Promise<void> {
  await access(path, constants.X_OK).catch(() => {
    throw new Error(`Required kernel-backed OS lock primitive is unavailable: ${path}`);
  });
}

async function firstExecutable(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next fixed platform path.
    }
  }
  return null;
}
