import { describe, expect, it } from "bun:test";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  type EvidenceCardApprovalArtifact,
  type EvidenceCardDraftArtifact,
  type FrozenCaseArtifact,
} from "@influence/prompt-lab-protocol";
import {
  createPromptThreadWorkerHandshake,
  computePromptThreadWorkerHarnessDigest,
  PromptThreadWorkerError,
  runPromptThreadWorker,
} from "../prompt-thread-worker";

const caseValue = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "frozen_case",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseId: `sha256:${"1".repeat(64)}`,
  sourceReceiptHash: `sha256:${"2".repeat(64)}`,
  privateData: {},
} satisfies FrozenCaseArtifact;

const draft = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "evidence_card_draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseHash: hashCanonicalJson(caseValue),
  provenance: "manual",
  items: [],
} satisfies EvidenceCardDraftArtifact;

const approval = {
  protocolVersion: PROTOCOL_VERSION,
  schemaHash: PROTOCOL_SCHEMA_HASH,
  kind: "evidence_card_approval",
  createdAt: "2026-01-01T00:00:00.000Z",
  caseHash: hashCanonicalJson(caseValue),
  cardHash: hashCanonicalJson(draft),
  reviewer: "producer",
} satisfies EvidenceCardApprovalArtifact;

function input(overrides: Record<string, unknown> = {}) {
  const harnessDigest = "harness-a";
  return {
    handshake: createPromptThreadWorkerHandshake(harnessDigest),
    caseValue,
    evidenceDraft: draft,
    evidenceApproval: approval,
    cell: {
      cellId: "cell-1", branchId: "branch-1", turn: 1, actorId: "finn",
      actorLineage: "opaque-lineage-finn", model: "gpt-5.4-nano-2026-03-17",
      revision: "sha", runtimeHash: "runtime", actionSchemaHash: "action", harnessDigest,
    },
    expected: { revision: "sha", runtimeHash: "runtime", actionSchemaHash: "action", harnessDigest },
    ...overrides,
  };
}

const dependencies = {
  executeCell: async (
    _caseValue: FrozenCaseArtifact,
    value: {
      turn: 1 | 2 | 3 | 4;
      model: string;
      promptCacheKey: string;
      previousResponses: unknown[];
      dispatch: (request: Record<string, unknown>) => Promise<unknown>;
    },
  ) => {
    const request = {
      model: value.model,
      prompt_cache_key: value.promptCacheKey,
      input: "real revision prompt",
      instructions: "real revision instructions",
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
        kind: "continuation_checkpoint" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        branchId: "source",
        cellId: "source-turn",
        turn: value.turn,
        privateState: {},
      },
    };
  },
};

describe("prompt-thread worker", () => {
  it("computes its harness digest from the checkout instead of accepting one", async () => {
    const first = await computePromptThreadWorkerHarnessDigest();
    const second = await computePromptThreadWorkerHarnessDigest();
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("uses only the injected broker once and checkpoints isolated branch state", async () => {
    const requests: Record<string, unknown>[] = [];
    const result = await runPromptThreadWorker(input({
      brokerTransport: async (request: Record<string, unknown>) => {
        requests.push(request);
        return { status: "completed", output: "hello" };
      },
    }), dependencies);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prompt_cache_key).toBe("opaque-lineage-finn");
    expect(result.checkpoint.privateState.actorLineages).toEqual({ finn: "opaque-lineage-finn" });
    expect(result.branchState).not.toBe((input() as { branchState?: unknown }).branchState);
  });

  it("applies a saved response without dispatching", async () => {
    let calls = 0;
    const result = await runPromptThreadWorker(input({
      savedResponse: { status: "completed", output: "saved" },
      brokerTransport: async () => { calls += 1; return {}; },
    }), dependencies);
    expect(calls).toBe(0);
    expect(result.dispatched).toBe(false);
    expect(result.checkpoint.privateState.appliedCellIds).toEqual(["cell-1"]);
  });

  it("rejects protocol mismatch, actor lineage reuse drift, duplicate cells, and transport failure", async () => {
    await expect(runPromptThreadWorker(input({
      handshake: { ...createPromptThreadWorkerHandshake("other"), schemaHash: "sha256:bad" },
    }), dependencies)).rejects.toMatchObject({ code: "protocol_mismatch" } satisfies Partial<PromptThreadWorkerError>);
    await expect(runPromptThreadWorker(input({
      branchState: { appliedCellIds: [], actorLineages: { finn: "other-lineage" }, providerResponses: [] },
    }), dependencies)).rejects.toMatchObject({ code: "input_mismatch" });
    await expect(runPromptThreadWorker(input({
      cell: {
        ...(input().cell as object),
        turn: 2,
      },
      branchState: {
        appliedCellIds: ["cell-1"],
        actorLineages: {},
        providerResponses: [{ status: "completed" }],
      },
    }), dependencies)).rejects.toMatchObject({ code: "duplicate_cell" });
    await expect(runPromptThreadWorker(input({
      brokerTransport: async () => { throw new Error("boom"); },
    }), dependencies)).rejects.toMatchObject({ code: "provider_failure" });
  });
});
