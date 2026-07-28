import { describe, expect, test } from "bun:test";
import {
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  GOLDEN_CANONICAL_VECTORS,
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  assertApprovalCurrent,
  assertBlindReviewComplete,
  canonicalJson,
  createApproval,
  createHandshake,
  hashCanonicalJson,
  parseArtifact,
  parseStructuralRunSummary,
  validateHandshake,
} from "./index.js";

describe("prompt lab canonical protocol", () => {
  test("hashes canonically equivalent objects identically", () => {
    const first = {
      z: [{ b: true, a: "unchanged\nbytes" }],
      a: { beta: null, alpha: 1 },
    };
    const second = {
      a: { alpha: 1, beta: null },
      z: [{ a: "unchanged\nbytes", b: true }],
    };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(hashCanonicalJson(first)).toBe(hashCanonicalJson(second));
  });

  test("matches frozen canonicalizer and schema golden vectors", () => {
    expect(PROTOCOL_VERSION).toBe("1.0.0");
    expect(CANONICALIZER_ID).toBe("influence-canonical-json");
    expect(CANONICALIZER_VERSION).toBe("1");
    expect(PROTOCOL_SCHEMA_HASH).toBe(
      "sha256:f78427eac1d330b456bd94d17a320548ded773543d98e120dab43b7263e3a517",
    );
    expect(GOLDEN_CANONICAL_VECTORS).toEqual([
      {
        name: "key-order-and-byte-preserving-text",
        value: {
          actor: "Finn",
          messages: [{ role: "user", content: "Line 1\nLine 2" }],
          turn: 1,
        },
        canonical:
          "{\"actor\":\"Finn\",\"messages\":[{\"content\":\"Line 1\\nLine 2\",\"role\":\"user\"}],\"turn\":1}",
        sha256: "sha256:4187d7b004c1f65b5a3d52f080f4e0a34218915399e7e0cdbee99f4c779a2b49",
      },
      {
        name: "nested-order",
        value: { z: [3, { y: false, x: null }], a: "α" },
        canonical: "{\"a\":\"α\",\"z\":[3,{\"x\":null,\"y\":false}]}",
        sha256: "sha256:917fe3ae29b5e5a7d321a0088d8be1f5a0ab7a9638a728ad8f50719f55d43208",
      },
    ]);
    for (const vector of GOLDEN_CANONICAL_VECTORS) {
      expect(canonicalJson(vector.value)).toBe(vector.canonical);
      expect(hashCanonicalJson(vector.value)).toBe(vector.sha256);
    }
  });

  test("rejects values JSON cannot represent deterministically", () => {
    expect(() => canonicalJson({ missing: undefined })).toThrow("undefined");
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("finite");
    expect(() => canonicalJson({ value: 1n })).toThrow("bigint");
  });
});

describe("runtime artifact schemas", () => {
  test("accept every artifact family through the common envelope", () => {
    const base = {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      createdAt: "2026-07-27T12:00:00.000Z",
    };
    const artifacts = [
      { ...base, kind: "frozen_case", caseId: "sha256:case", sourceReceiptHash: "sha256:source", privateData: {} },
      { ...base, kind: "source_receipt", caseId: "sha256:case", sources: [] },
      { ...base, kind: "evidence_card_draft", caseHash: "sha256:case", provenance: "manual", items: [] },
      { ...base, kind: "evidence_card_approval", caseHash: "sha256:case", cardHash: "sha256:card", reviewer: "producer" },
      { ...base, kind: "curator_manifest", caseHash: "sha256:case", maximumCalls: 1, maximumSpendUsd: 1, privateDataClasses: [] },
      { ...base, kind: "curator_approval", targetHash: "sha256:manifest", operator: "producer", maximumCalls: 1, maximumSpendUsd: 1 },
      { ...base, kind: "run_manifest", caseHash: "sha256:case", evidenceCardHash: "sha256:card", maximumCalls: 28, maximumSpendUsd: 5, cells: [] },
      { ...base, kind: "paid_approval", targetHash: "sha256:manifest", operator: "producer", maximumCalls: 28, maximumSpendUsd: 5 },
      { ...base, kind: "handshake", canonicalizerId: CANONICALIZER_ID, canonicalizerVersion: CANONICALIZER_VERSION, capabilities: ["prepare"], harnessDigest: "sha256:harness" },
      { ...base, kind: "prepared_request", cellId: "cell-1", requestHash: "sha256:request", privateRequest: {} },
      { ...base, kind: "provider_result", cellId: "cell-1", requestHash: "sha256:request", status: "completed", privateResponse: {} },
      { ...base, kind: "cell_transition", sequence: 1, cellId: "cell-1", stage: "planned" },
      { ...base, kind: "continuation_checkpoint", branchId: "branch-1", cellId: "cell-1", turn: 1, privateState: {} },
      { ...base, kind: "blind_packet", evidenceCardHash: "sha256:card", pairs: [] },
      { ...base, kind: "unblinding_key", packetHash: "sha256:packet", mappings: [] },
      { ...base, kind: "blind_decisions", packetHash: "sha256:packet", reviewer: "producer", locked: true, decisions: [] },
      { ...base, kind: "final_report", runManifestHash: "sha256:run", blindDecisionsHash: "sha256:decisions", verdicts: {} },
    ] as const;

    expect(artifacts.map((artifact) => parseArtifact(artifact).kind)).toEqual(
      artifacts.map((artifact) => artifact.kind),
    );
  });

  test("fails closed on unknown schema majors and partial artifacts", () => {
    expect(() => parseArtifact({
      protocolVersion: "2.0.0",
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "frozen_case",
    })).toThrow("protocol major");
    expect(() => parseArtifact({
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "prepared_request",
      cellId: "cell-1",
      createdAt: "2026-07-27T12:00:00.000Z",
    })).toThrow("requestHash");
  });

  test("deeply validates blind packet pairs and conversations", () => {
    const turn = (turnNumber: number) => ({
      turn: turnNumber,
      actor: turnNumber % 2 === 1 ? "finn" : "lyra",
      message: `turn ${turnNumber}`,
      noReply: false,
      gotoRoomId: null,
      gotoPlayerName: null,
      coordinationReceipt: null,
      evidenceReferences: [`history:${turnNumber}`],
    });
    const pair = {
      pairToken: "pair-one",
      conversationA: [1, 2, 3, 4].map(turn),
      conversationB: [1, 2, 3, 4].map(turn),
    };
    const packet = {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "blind_packet",
      createdAt: "2026-07-27T12:00:00.000Z",
      evidenceCardHash: "sha256:card",
      pairs: [pair],
    };

    expect(() => parseArtifact(packet)).not.toThrow();
    expect(() => parseArtifact({
      ...packet,
      pairs: [pair, { ...pair }],
    })).toThrow("duplicate pair token");
    expect(() => parseArtifact({
      ...packet,
      pairs: [{
        ...pair,
        conversationA: pair.conversationA.slice(0, 3),
      }],
    })).toThrow("four turns");
    expect(() => parseArtifact({
      ...packet,
      pairs: [{
        ...pair,
        conversationB: pair.conversationB.map((value, index) => (
          index === 2 ? { ...value, evidenceReferences: "history:3" } : value
        )),
      }],
    })).toThrow("evidenceReferences");
  });

  test("keeps structural summaries content-free", () => {
    expect(parseStructuralRunSummary({
      protocolVersion: PROTOCOL_VERSION,
      runId: "sha256:run",
      lifecycle: "running",
      completedCells: 2,
      outstandingCells: 26,
      reservedSpendUsd: 1,
      settledSpendUsd: 0.5,
      nextActions: ["resume"],
      requiresHuman: false,
    }).lifecycle).toBe("running");

    expect(() => parseStructuralRunSummary({
      protocolVersion: PROTOCOL_VERSION,
      runId: "sha256:run",
      lifecycle: "running",
      completedCells: 2,
      outstandingCells: 26,
      reservedSpendUsd: 1,
      settledSpendUsd: 0.5,
      nextActions: ["resume"],
      requiresHuman: false,
      prompt: "private",
    })).toThrow("private");
  });
});

describe("approval, handshake, and blind-review safety", () => {
  test("invalidates approvals when any approved manifest field changes", () => {
    const manifest = {
      kind: "run_manifest",
      caseHash: "sha256:case",
      maximumCalls: 28,
      maximumSpendUsd: 5,
      revision: "abc",
    };
    const approval = createApproval(manifest, {
      kind: "paid_approval",
      operator: "producer",
      maximumCalls: 28,
      maximumSpendUsd: 5,
      createdAt: "2026-07-27T12:00:00.000Z",
    });

    expect(() => assertApprovalCurrent(manifest, approval)).not.toThrow();
    expect(() => assertApprovalCurrent(
      { ...manifest, revision: "def" },
      approval,
    )).toThrow("stale");
    expect(() => assertApprovalCurrent(
      { ...manifest, maximumSpendUsd: 6 },
      approval,
    )).toThrow("stale");
  });

  test("requires exact schema, canonicalizer, harness, and capability handshake", () => {
    const local = createHandshake({
      capabilities: ["apply_response", "prepare_request"],
      harnessDigest: "sha256:harness",
      createdAt: "2026-07-27T12:00:00.000Z",
    });
    const remote = createHandshake({
      capabilities: ["prepare_request", "apply_response"],
      harnessDigest: "sha256:harness",
      createdAt: "2026-07-27T12:00:00.000Z",
    });
    expect(() => validateHandshake(local, remote, ["prepare_request"])).not.toThrow();
    expect(() => validateHandshake(local, {
      ...remote,
      schemaHash: "sha256:changed",
    }, ["prepare_request"])).toThrow("schema hash");
    expect(() => validateHandshake(local, {
      ...remote,
      harnessDigest: "sha256:other",
    }, ["prepare_request"])).toThrow("harness");
    expect(() => validateHandshake(local, remote, ["broker_request"])).toThrow("capability");
  });

  test("refuses unblinding until all blind decisions are locked", () => {
    expect(() => assertBlindReviewComplete(
      { pairTokens: ["pair-a", "pair-b"] },
      {
        locked: false,
        decisions: [{ pairToken: "pair-a", choice: "A" }],
      },
    )).toThrow("incomplete");
    expect(() => assertBlindReviewComplete(
      { pairTokens: ["pair-a", "pair-b"] },
      {
        locked: true,
        decisions: [
          { pairToken: "pair-a", choice: "A" },
          { pairToken: "pair-b", choice: "no_preference" },
        ],
      },
    )).not.toThrow();
  });
});
