import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import { createPromptThreadWorkerHandshake } from "@influence/engine/prompt-thread-worker";
import {
  atomicWriteArtifact,
  createPrivateWorkspace,
  readArtifact,
  withRunMutationLock,
} from "../services/prompt-thread-workspace.js";
import { runPromptThreadLabCli } from "./prompt-thread-lab.js";

async function workspaceWithCase() {
  const root = await mkdtemp(join(tmpdir(), "prompt-thread-cli-"));
  const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
  const privateData = {
    startingState: {
      canonicalProjection: { round: 4 },
      roster: [{ id: "finn" }],
      config: {},
      continuity: {
        playerContinuityCapsules: [
          { playerId: "finn", recentStrategicDecisions: [] },
        ],
      },
      historyCatalog: [{ sourceId: "history:one", eligibleActorIds: ["finn"] }],
    },
    traces: [
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "finn" },
      { action: "mingle-turn", actorId: "finn" },
    ],
  };
  const caseValue = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "frozen_case" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    caseId: hashCanonicalJson(privateData),
    sourceReceiptHash: `sha256:${"1".repeat(64)}`,
    privateData,
  } satisfies FrozenCaseArtifact;
  await withRunMutationLock(workspace, "seed", (lock) => (
    atomicWriteArtifact(lock, "cases/case.json", caseValue)
  ));
  return { root, workspace, caseValue };
}

describe("prompt-thread lab CLI primitives", () => {
  it("writes an offline manual card and curator proposal artifacts", async () => {
    const { root, workspace } = await workspaceWithCase();
    try {
      const manual = await runPromptThreadLabCli([
        "manual-draft", "--workspace", root, "--case", "cases/case.json",
        "--items", JSON.stringify([{
          sourceId: "history:one", classification: "required", applicableTurns: [1], rationale: "commitment",
        }]),
      ]);
      expect(manual.status).toBe("ok");
      expect(await readArtifact(workspace, "evidence/manual-draft.json")).toMatchObject({
        kind: "evidence_card_draft", provenance: "manual",
      });

      const preview = await runPromptThreadLabCli([
        "curator-manifest", "--workspace", root, "--case", "cases/case.json",
        "--model", "gpt-5.4-nano-2026-03-17", "--max-calls", "1",
        "--max-spend-usd", "0.01", "--max-items-per-partition", "1",
      ]);
      expect(preview).toMatchObject({ status: "ok", lifecycle: "draft" });
      expect(await readArtifact(workspace, "evidence/curator-manifest.json")).toMatchObject({
        kind: "curator_manifest", maximumCalls: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires an injected interactive TTY before curator approval or freeze", async () => {
    const { root } = await workspaceWithCase();
    try {
      const result = await runPromptThreadLabCli([
        "curator-approve", "--workspace", root, "--manifest", "evidence/curator-manifest.json",
        "--reviewer", "producer", "--confirm",
      ], { isTTY: false });
      expect(result).toMatchObject({
        status: "error", errorCode: "interactive_tty_required", requiresHuman: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs an explicitly approved injected curator and applies its saved response after restart", async () => {
    const { root } = await workspaceWithCase();
    try {
      await runPromptThreadLabCli([
        "curator-manifest", "--workspace", root, "--case", "cases/case.json",
        "--model", "frontier-curator", "--max-calls", "1",
        "--max-spend-usd", "0.01", "--max-items-per-partition", "1",
      ]);
      const approved = await runPromptThreadLabCli([
        "curator-approve", "--workspace", root,
        "--manifest", "evidence/curator-manifest.json",
        "--reviewer", "producer", "--confirm",
      ], { isTTY: true });
      expect(approved.lifecycle).toBe("approved");

      let dispatches = 0;
      const curated = await runPromptThreadLabCli([
        "curate", "--workspace", root,
        "--manifest", "evidence/curator-manifest.json",
        "--approval", "evidence/curator-approval.json", "--confirm",
      ], {
        isTTY: true,
        curatorBroker: {
          async dispatchPartition({ partition }) {
            dispatches += 1;
            return {
              partitionId: partition.partitionId,
              items: [{
                sourceId: "history:one",
                classification: "required",
                applicableTurns: [1],
                rationale: "commitment",
              }],
            };
          },
        },
      });
      expect(curated).toMatchObject({ status: "ok", completedCells: 1 });
      expect(dispatches).toBe(1);

      const applied = await runPromptThreadLabCli([
        "apply-curator-response", "--workspace", root,
        "--case", "cases/case.json",
        "--manifest", "evidence/curator-manifest.json",
        "--approval", "evidence/curator-approval.json",
        "--responses-path", "evidence/curator-responses.json",
      ]);
      expect(applied).toMatchObject({ status: "ok", lifecycle: "draft" });
      expect(await readFile(join(root, "evidence/curator-draft.md"), "utf8"))
        .toContain("history:one");

      const frozen = await runPromptThreadLabCli([
        "freeze", "--workspace", root, "--case", "cases/case.json",
        "--draft", "evidence/curator-draft.json",
        "--reviewer", "producer", "--confirm",
      ], { isTTY: true });
      expect(frozen).toMatchObject({ status: "ok", lifecycle: "frozen" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preflights, approves, initializes, and inspects a 28-cell panel without dispatch", async () => {
    const { root, caseValue } = await workspaceWithCase();
    try {
      await runPromptThreadLabCli([
        "manual-draft", "--workspace", root, "--case", "cases/case.json",
        "--items", JSON.stringify([]),
      ]);
      await runPromptThreadLabCli([
        "freeze", "--workspace", root, "--case", "cases/case.json",
        "--draft", "evidence/manual-draft.json",
        "--reviewer", "producer", "--confirm",
      ], { isTTY: true });
      const baselineSha = "a".repeat(40);
      const candidateSha = "b".repeat(40);
      const manifest = await runPromptThreadLabCli([
        "panel-manifest", "--workspace", root, "--case", "cases/case.json",
        "--draft", "evidence/manual-draft.json",
        "--evidence-approval", "evidence/evidence-card-approval.json",
        "--source-fidelity", JSON.stringify({
          status: "matched",
          caseId: caseValue.caseId,
          turnCount: 4,
          sourceMutation: false,
        }),
        "--baseline-checkout", "/baseline", "--baseline-sha", baselineSha,
        "--baseline-policy-digest", "sha256:baseline",
        "--candidate-checkout", "/candidate", "--candidate-sha", candidateSha,
        "--candidate-policy-digest", "sha256:candidate",
        "--harness-digest", "sha256:harness",
        "--verdict-scope", "cache_quality_only",
        "--history-enabled", "false",
        "--model", "gpt-5.4-nano-2026-03-17",
        "--zdr-status", "unknown",
        "--runtime-hash", "sha256:runtime",
        "--action-schema-hash", "sha256:action",
        "--max-spend-usd", "10",
        "--input-token-ceiling", "4000",
        "--output-token-ceiling", "1000",
        "--actor-ids", "finn,lyra",
      ], {
        panelPreflight: {
          inspectCheckout: async (path) => ({
            commitSha: path === "/baseline" ? baselineSha : candidateSha,
            dirty: false,
          }),
          inspectWorkerHandshake: async (revision) =>
            createPromptThreadWorkerHandshake(revision.harnessDigest),
        },
      });
      expect(manifest).toMatchObject({ status: "ok", lifecycle: "draft" });
      const approved = await runPromptThreadLabCli([
        "panel-approve", "--workspace", root,
        "--manifest", "panel/run-manifest.json",
        "--reviewer", "producer", "--confirm",
      ], { isTTY: true });
      expect(approved.lifecycle).toBe("approved");
      const initialized = await runPromptThreadLabCli([
        "panel-init", "--workspace", root,
        "--manifest", "panel/run-manifest.json",
        "--approval", "panel/paid-approval.json",
      ]);
      expect(initialized).toMatchObject({
        lifecycle: "running",
        completedCells: 0,
        outstandingCells: 28,
      });
      const status = await runPromptThreadLabCli([
        "panel-status", "--workspace", root,
        "--manifest", "panel/run-manifest.json",
      ]);
      expect(status).toMatchObject({
        lifecycle: "running",
        outstandingCells: 28,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
