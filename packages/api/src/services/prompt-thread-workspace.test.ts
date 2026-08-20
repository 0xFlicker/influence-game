import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
} from "@influence/prompt-lab-protocol";
import {
  WorkspaceLockUnavailableError,
  abortRun,
  appendCellTransition,
  atomicWriteArtifact,
  createPrivateWorkspace,
  createTemporaryMaterialization,
  inspectRunRecovery,
  parseGitWorktreeRoots,
  promoteValidatedMaterialization,
  readArtifact,
  readDurableProviderSettledSpendUsd,
  recordCellProviderResult,
  recordContinuationCheckpoint,
  recoverOrInvalidateRun,
  resolveArtifactPath,
  withRunMutationLock,
  type PrivateWorkspace,
} from "./prompt-thread-workspace.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function tempRoot(name: string): Promise<string> {
  const root = await Bun.$`mktemp -d ${join(tmpdir(), `${name}.XXXXXX`)}`.text();
  const value = root.trim();
  cleanupRoots.push(value);
  return value;
}

async function workspaceFixture(): Promise<PrivateWorkspace> {
  const parent = await tempRoot("prompt-thread-workspace");
  return createPrivateWorkspace(join(parent, "private"), {
    gitWorktreeRoots: [process.cwd()],
  });
}

describe("private workspace boundary", () => {
  test("excludes prunable git worktree records", () => {
    expect(parseGitWorktreeRoots([
      "worktree /repo/main",
      "HEAD aaaaaaa",
      "branch refs/heads/main",
      "",
      "worktree /repo/stale",
      "HEAD bbbbbbb",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /repo/live",
      "HEAD ccccccc",
      "detached",
      "",
    ].join("\n"))).toEqual(["/repo/main", "/repo/live"]);
  });

  test("requires an absolute root outside resolved git worktrees", async () => {
    await expect(createPrivateWorkspace("relative/path", {
      gitWorktreeRoots: [process.cwd()],
    })).rejects.toThrow("absolute");
    await expect(createPrivateWorkspace(join(process.cwd(), ".private-eval"), {
      gitWorktreeRoots: [process.cwd()],
    })).rejects.toThrow("worktree");
  });

  test("rejects symlink and traversal escapes", async () => {
    const parent = await tempRoot("prompt-thread-symlink");
    const privateRoot = join(parent, "private");
    const outside = join(parent, "outside");
    await mkdir(privateRoot, { mode: 0o700 });
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, join(privateRoot, "escape"));
    const workspace = await createPrivateWorkspace(privateRoot, {
      gitWorktreeRoots: [process.cwd()],
    });

    await expect(resolveArtifactPath(workspace, "../outside/file.json"))
      .rejects.toThrow("escape");
    await expect(resolveArtifactPath(workspace, "escape/file.json"))
      .rejects.toThrow("symlink");
  });

  test("rejects permissive or partial frozen artifacts", async () => {
    const workspace = await workspaceFixture();
    const path = await resolveArtifactPath(workspace, "cases/bad.json", {
      createParents: true,
    });
    await writeFile(path, "{\"kind\":", { mode: 0o600 });
    await expect(readArtifact(workspace, "cases/bad.json")).rejects.toThrow("JSON");

    await writeFile(path, JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "source_receipt",
      caseId: "sha256:case",
      sources: [],
      createdAt: "2026-07-27T12:00:00.000Z",
    }));
    await chmod(path, 0o644);
    await expect(readArtifact(workspace, "cases/bad.json")).rejects.toThrow("mode");
  });

  test("atomically writes fsynced private artifacts with owner-only mode", async () => {
    const workspace = await workspaceFixture();
    const artifact = {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "source_receipt" as const,
      caseId: "sha256:case",
      sources: [],
      createdAt: "2026-07-27T12:00:00.000Z",
    };
    await withRunMutationLock(workspace, "artifact-write", async (lock) => {
      await atomicWriteArtifact(lock, "cases/source-receipt.json", artifact);
    });

    const path = await resolveArtifactPath(workspace, "cases/source-receipt.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readArtifact(workspace, "cases/source-receipt.json")).toEqual(artifact);
  });
});

describe("materialization promotion", () => {
  test("promotes a validated temp tree to its content address", async () => {
    const workspace = await workspaceFixture();
    const artifact = {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "source_receipt" as const,
      caseId: "sha256:case",
      sources: [],
      createdAt: "2026-07-27T12:00:00.000Z",
    };
    const contentHash = hashCanonicalJson(artifact);

    await withRunMutationLock(
      workspace,
      `case-${contentHash.slice("sha256:".length)}`,
      async (lock) => {
        const temporary = await createTemporaryMaterialization(lock);
        await atomicWriteArtifact(lock, temporary.relativePath + "/source-receipt.json", artifact);
        const promoted = await promoteValidatedMaterialization(lock, temporary, {
          contentHash,
          validate: async () => {
            await readArtifact(workspace, temporary.relativePath + "/source-receipt.json");
          },
        });
        expect(promoted.relativePath).toBe(`cases/${contentHash.slice("sha256:".length)}`);
      },
    );
  });
});

describe("OS lock and durable lifecycle journal", () => {
  function providerResult(cellId: string, costUsd = 0.125) {
    const requestHash = `sha256:${cellId}`;
    return {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "provider_result" as const,
      createdAt: "2026-07-27T12:00:00.000Z",
      cellId,
      requestHash,
      status: "completed",
      privateResponse: {
        response: { id: `response-${cellId}` },
        receipt: {
          cellId,
          requestDigest: requestHash,
          elapsedMs: 10,
          cachedInputTokens: 0,
          costUsd,
        },
      },
    };
  }

  function checkpoint(cellId: string) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "continuation_checkpoint" as const,
      createdAt: "2026-07-27T12:00:00.000Z",
      branchId: "branch-1",
      cellId,
      turn: 1,
      privateState: { continuity: cellId },
    };
  }

  test("rejects unsafe run identities before acquiring a mutation lock", async () => {
    const workspace = await workspaceFixture();

    await expect(withRunMutationLock(workspace, "../unsafe", async () => undefined))
      .rejects.toThrow("Unsafe prompt-thread run id");
  });

  test("allows only one local mutation holder", async () => {
    const workspace = await workspaceFixture();
    let releaseFirst!: () => void;
    const wait = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let entered = false;
    const first = withRunMutationLock(workspace, "run-lock", async () => {
      entered = true;
      await wait;
    });
    while (!entered) await Bun.sleep(1);

    await expect(withRunMutationLock(workspace, "run-lock", async () => undefined))
      .rejects.toBeInstanceOf(WorkspaceLockUnavailableError);
    releaseFirst();
    await first;
  });

  test("kernel releases a lock after its holder process dies", async () => {
    const workspace = await workspaceFixture();
    const lockName = createHash("sha256").update("death", "utf8").digest("hex");
    const lockPath = await resolveArtifactPath(workspace, `.locks/${lockName}.lock`, {
      createParents: true,
    });
    const holderCommand = process.platform === "darwin"
      ? ["/usr/bin/lockf", "-t", "0", lockPath, "/bin/sh", "-c", "printf acquired; read ignored"]
      : ["/usr/bin/flock", "-n", lockPath, "/bin/sh", "-c", "printf acquired; read ignored"];
    const holder = Bun.spawn(holderCommand, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const firstChunk = await holder.stdout.getReader().read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe("acquired");
    holder.kill(9);
    await holder.exited;

    await expect(withRunMutationLock(workspace, "death", async () => "released"))
      .resolves.toBe("released");
  });

  test("replays legal ordered stages without creating a second claim", async () => {
    const workspace = await workspaceFixture();
    await withRunMutationLock(workspace, "run-a", async (lock) => {
      await appendCellTransition(lock, { cellId: "cell-1", stage: "planned" });
      await appendCellTransition(lock, { cellId: "cell-1", stage: "started" });
      await recordCellProviderResult(lock, "cell-1", providerResult("cell-1"));
    });

    const recovery = await inspectRunRecovery(workspace, "run-a");
    expect(recovery.actions).toEqual([
      { cellId: "cell-1", action: "reapply_saved_response" },
    ]);

    await withRunMutationLock(workspace, "run-a", async (lock) => {
      await expect(appendCellTransition(lock, {
        cellId: "cell-1",
        stage: "started",
      })).rejects.toThrow("Illegal");
    });
  });

  test("rejects a durable provider receipt whose request identity does not match", async () => {
    const workspace = await workspaceFixture();
    await withRunMutationLock(workspace, "run-forged-receipt", async (lock) => {
      await appendCellTransition(lock, { cellId: "cell-1", stage: "planned" });
      await appendCellTransition(lock, { cellId: "cell-1", stage: "started" });
      const artifact = providerResult("cell-1", 50);
      await recordCellProviderResult(lock, "cell-1", {
        ...artifact,
        privateResponse: {
          ...artifact.privateResponse,
          receipt: {
            ...artifact.privateResponse.receipt,
            requestDigest: "sha256:different-request",
          },
        },
      });
    });

    await expect(
      readDurableProviderSettledSpendUsd(workspace, "run-forged-receipt"),
    ).rejects.toThrow("identity");
  });

  test("dispatches only planned cells and resumes after the durable apply cut points", async () => {
    const workspace = await workspaceFixture();
    await withRunMutationLock(workspace, "run-b", async (lock) => {
      await appendCellTransition(lock, { cellId: "planned", stage: "planned" });
      await appendCellTransition(lock, { cellId: "saved", stage: "planned" });
      await appendCellTransition(lock, { cellId: "saved", stage: "started" });
      await recordCellProviderResult(lock, "saved", providerResult("saved"));
      await appendCellTransition(lock, { cellId: "applied", stage: "planned" });
      await appendCellTransition(lock, { cellId: "applied", stage: "started" });
      await recordCellProviderResult(lock, "applied", providerResult("applied"));
      await appendCellTransition(lock, { cellId: "applied", stage: "applied" });
      await appendCellTransition(lock, { cellId: "checkpoint", stage: "planned" });
      await appendCellTransition(lock, { cellId: "checkpoint", stage: "started" });
      await recordCellProviderResult(lock, "checkpoint", providerResult("checkpoint"));
      await appendCellTransition(lock, { cellId: "checkpoint", stage: "applied" });
      await recordContinuationCheckpoint(lock, "checkpoint", checkpoint("checkpoint"));
    });

    expect((await inspectRunRecovery(workspace, "run-b")).actions).toEqual([
      { cellId: "applied", action: "commit_checkpoint" },
      { cellId: "checkpoint", action: "complete_cell" },
      { cellId: "planned", action: "dispatch" },
      { cellId: "saved", action: "reapply_saved_response" },
    ]);
  });

  test("reconciles a complete response saved immediately before its journal marker", async () => {
    const workspace = await workspaceFixture();
    await withRunMutationLock(workspace, "run-cutpoint", async (lock) => {
      await appendCellTransition(lock, { cellId: "cell-1", stage: "planned" });
      await appendCellTransition(lock, { cellId: "cell-1", stage: "started" });
      await atomicWriteArtifact(
        lock,
        "runs/run-cutpoint/cells/cell-1/provider-result.json",
        providerResult("cell-1"),
      );
    });

    expect((await inspectRunRecovery(workspace, "run-cutpoint")).actions).toEqual([
      { cellId: "cell-1", action: "reapply_saved_response" },
    ]);
    const recovered = await recoverOrInvalidateRun(workspace, "run-cutpoint");
    expect(recovered).toMatchObject({
      lifecycle: "running",
      nextActions: ["reapply_saved_response"],
    });
    expect((await inspectRunRecovery(workspace, "run-cutpoint")).transitions.at(-1)?.stage)
      .toBe("response_recorded");
  });

  test("started without a response and explicit abort clean private content", async () => {
    const workspace = await workspaceFixture();
    await withRunMutationLock(workspace, "run-invalid", async (lock) => {
      await appendCellTransition(lock, { cellId: "cell-completed", stage: "planned" });
      await appendCellTransition(lock, { cellId: "cell-completed", stage: "started" });
      await recordCellProviderResult(
        lock,
        "cell-completed",
        providerResult("cell-completed", 0.375),
      );
      await appendCellTransition(lock, { cellId: "cell-completed", stage: "applied" });
      await recordContinuationCheckpoint(
        lock,
        "cell-completed",
        checkpoint("cell-completed"),
      );
      await appendCellTransition(lock, { cellId: "cell-completed", stage: "completed" });
      await appendCellTransition(lock, { cellId: "cell-1", stage: "planned" });
      await appendCellTransition(lock, { cellId: "cell-1", stage: "started" });
      await atomicWriteArtifact(lock, "runs/run-invalid/private.json", {
        protocolVersion: PROTOCOL_VERSION,
        schemaHash: PROTOCOL_SCHEMA_HASH,
        kind: "prepared_request",
        cellId: "cell-1",
        requestHash: "sha256:request",
        privateRequest: { prompt: "must disappear" },
        createdAt: "2026-07-27T12:00:00.000Z",
      });
    });

    const invalidated = await recoverOrInvalidateRun(workspace, "run-invalid");
    expect(invalidated.lifecycle).toBe("invalidated");
    expect(invalidated.reasonCode).toBe("started_without_response");
    expect(invalidated.settledSpendUsd).toBe(0.375);
    expect(await Bun.file(join(workspace.root, "runs/run-invalid/private.json")).exists())
      .toBe(false);
    const summaryText = await readFile(
      join(workspace.root, "summaries/run-invalid.json"),
      "utf8",
    );
    expect(JSON.parse(summaryText).settledSpendUsd).toBe(0.375);
    expect(summaryText).not.toContain("must disappear");

    await withRunMutationLock(workspace, "run-abort", async () => {
      await mkdir(join(workspace.root, "runs/run-abort"), { recursive: true, mode: 0o700 });
      await writeFile(join(workspace.root, "runs/run-abort/raw.txt"), "private", { mode: 0o600 });
    });
    await abortRun(workspace, "run-abort", "operator_abort");
    expect(await Bun.file(join(workspace.root, "runs/run-abort/raw.txt")).exists())
      .toBe(false);
  });

  test("rejects illegal transition order and a truncated journal", async () => {
    const workspace = await workspaceFixture();
    await withRunMutationLock(workspace, "run-illegal", async (lock) => {
      await expect(appendCellTransition(lock, {
        cellId: "cell-1",
        stage: "started",
      })).rejects.toThrow("Illegal");
    });

    const journal = join(workspace.root, "runs/run-partial/transition-journal.jsonl");
    await mkdir(join(workspace.root, "runs/run-partial"), { recursive: true, mode: 0o700 });
    await writeFile(journal, "{\"kind\":\"cell_transition\"", { mode: 0o600 });
    await expect(inspectRunRecovery(workspace, "run-partial")).rejects.toThrow("journal");
  });
});
