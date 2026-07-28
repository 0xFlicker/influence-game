import { createHash } from "node:crypto";

export const PROTOCOL_VERSION = "1.0.0" as const;
export const CANONICALIZER_ID = "influence-canonical-json" as const;
export const CANONICALIZER_VERSION = "1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ArtifactKind =
  | "frozen_case"
  | "source_receipt"
  | "evidence_card_draft"
  | "evidence_card_approval"
  | "curator_manifest"
  | "curator_approval"
  | "run_manifest"
  | "paid_approval"
  | "handshake"
  | "prepared_request"
  | "provider_result"
  | "cell_transition"
  | "continuation_checkpoint"
  | "blind_packet"
  | "unblinding_key"
  | "blind_decisions"
  | "final_report";

export const CELL_STAGES = [
  "planned",
  "started",
  "response_recorded",
  "applied",
  "checkpoint_committed",
  "completed",
] as const;

export type CellStage = (typeof CELL_STAGES)[number];

export interface ArtifactEnvelope {
  protocolVersion: string;
  schemaHash: string;
  kind: ArtifactKind;
  createdAt: string;
  [key: string]: JsonValue;
}

export interface FrozenCaseArtifact extends ArtifactEnvelope {
  kind: "frozen_case";
  caseId: string;
  sourceReceiptHash: string;
  privateData: JsonObject;
}

export interface SourceReceiptArtifact extends ArtifactEnvelope {
  kind: "source_receipt";
  caseId: string;
  sources: JsonValue[];
}

export interface EvidenceCardDraftArtifact extends ArtifactEnvelope {
  kind: "evidence_card_draft";
  caseHash: string;
  provenance: "manual" | "curator";
  items: JsonValue[];
}

export interface EvidenceCardApprovalArtifact extends ArtifactEnvelope {
  kind: "evidence_card_approval";
  caseHash: string;
  cardHash: string;
  reviewer: string;
}

export interface CuratorManifestArtifact extends ArtifactEnvelope {
  kind: "curator_manifest";
  caseHash: string;
  maximumCalls: number;
  maximumSpendUsd: number;
  privateDataClasses: JsonValue[];
}

export interface ProtocolHandshake extends ArtifactEnvelope {
  kind: "handshake";
  protocolVersion: typeof PROTOCOL_VERSION;
  schemaHash: typeof PROTOCOL_SCHEMA_HASH;
  canonicalizerId: typeof CANONICALIZER_ID;
  canonicalizerVersion: typeof CANONICALIZER_VERSION;
  capabilities: string[];
  harnessDigest: string;
}

interface ApprovalArtifactBase extends ArtifactEnvelope {
  targetHash: string;
  operator: string;
  maximumCalls: number;
  maximumSpendUsd: number;
}

export interface CuratorApprovalArtifact extends ApprovalArtifactBase {
  kind: "curator_approval";
}

export interface PaidApprovalArtifact extends ApprovalArtifactBase {
  kind: "paid_approval";
}

export type BoundApproval = CuratorApprovalArtifact | PaidApprovalArtifact;

export interface RunManifestArtifact extends ArtifactEnvelope {
  kind: "run_manifest";
  caseHash: string;
  evidenceCardHash: string;
  maximumCalls: number;
  maximumSpendUsd: number;
  cells: JsonValue[];
}

export interface PreparedRequestArtifact extends ArtifactEnvelope {
  kind: "prepared_request";
  cellId: string;
  requestHash: string;
  privateRequest: JsonObject;
}

export interface ProviderResultArtifact extends ArtifactEnvelope {
  kind: "provider_result";
  cellId: string;
  requestHash: string;
  status: "completed" | "provider_failure";
  privateResponse: JsonValue;
}

export interface CellTransition extends ArtifactEnvelope {
  kind: "cell_transition";
  sequence: number;
  cellId: string;
  stage: CellStage;
}

export interface ContinuationCheckpointArtifact extends ArtifactEnvelope {
  kind: "continuation_checkpoint";
  branchId: string;
  cellId: string;
  turn: number;
  privateState: JsonObject;
}

export interface BlindPacketArtifact extends ArtifactEnvelope {
  kind: "blind_packet";
  evidenceCardHash: string;
  pairs: JsonValue[];
}

export interface UnblindingKeyArtifact extends ArtifactEnvelope {
  kind: "unblinding_key";
  packetHash: string;
  mappings: JsonValue[];
}

export interface BlindDecisionsArtifact extends ArtifactEnvelope {
  kind: "blind_decisions";
  packetHash: string;
  reviewer: string;
  locked: boolean;
  decisions: JsonValue[];
}

export interface FinalReportArtifact extends ArtifactEnvelope {
  kind: "final_report";
  runManifestHash: string;
  blindDecisionsHash: string;
  verdicts: JsonObject;
}

export type ProtocolArtifact =
  | FrozenCaseArtifact
  | SourceReceiptArtifact
  | EvidenceCardDraftArtifact
  | EvidenceCardApprovalArtifact
  | CuratorManifestArtifact
  | BoundApproval
  | RunManifestArtifact
  | ProtocolHandshake
  | PreparedRequestArtifact
  | ProviderResultArtifact
  | CellTransition
  | ContinuationCheckpointArtifact
  | BlindPacketArtifact
  | UnblindingKeyArtifact
  | BlindDecisionsArtifact
  | FinalReportArtifact;

export interface StructuralRunSummary {
  protocolVersion: typeof PROTOCOL_VERSION;
  runId: string;
  lifecycle:
    | "draft"
    | "running"
    | "completed"
    | "invalidated"
    | "aborted"
    | "failed";
  reasonCode?: string;
  completedCells: number;
  outstandingCells: number;
  reservedSpendUsd: number;
  settledSpendUsd: number;
  nextActions: string[];
  requiresHuman: boolean;
}

const ARTIFACT_REQUIREMENTS = {
  frozen_case: ["caseId", "sourceReceiptHash", "privateData"],
  source_receipt: ["caseId", "sources"],
  evidence_card_draft: ["caseHash", "provenance", "items"],
  evidence_card_approval: ["caseHash", "cardHash", "reviewer"],
  curator_manifest: [
    "caseHash",
    "maximumCalls",
    "maximumSpendUsd",
    "privateDataClasses",
  ],
  curator_approval: [
    "targetHash",
    "operator",
    "maximumCalls",
    "maximumSpendUsd",
  ],
  run_manifest: [
    "caseHash",
    "evidenceCardHash",
    "maximumCalls",
    "maximumSpendUsd",
    "cells",
  ],
  paid_approval: [
    "targetHash",
    "operator",
    "maximumCalls",
    "maximumSpendUsd",
  ],
  handshake: [
    "canonicalizerId",
    "canonicalizerVersion",
    "capabilities",
    "harnessDigest",
  ],
  prepared_request: ["cellId", "requestHash", "privateRequest"],
  provider_result: [
    "cellId",
    "requestHash",
    "status",
    "privateResponse",
  ],
  cell_transition: ["sequence", "cellId", "stage"],
  continuation_checkpoint: [
    "branchId",
    "cellId",
    "turn",
    "privateState",
  ],
  blind_packet: ["evidenceCardHash", "pairs"],
  unblinding_key: ["packetHash", "mappings"],
  blind_decisions: ["packetHash", "reviewer", "locked", "decisions"],
  final_report: ["runManifestHash", "blindDecisionsHash", "verdicts"],
} as const satisfies Record<ArtifactKind, readonly string[]>;

const SCHEMA_DESCRIPTOR = {
  protocolVersion: PROTOCOL_VERSION,
  canonicalizer: {
    id: CANONICALIZER_ID,
    version: CANONICALIZER_VERSION,
  },
  artifacts: ARTIFACT_REQUIREMENTS,
  cellStages: CELL_STAGES,
  structuralSummary: {
    required: [
      "protocolVersion",
      "runId",
      "lifecycle",
      "completedCells",
      "outstandingCells",
      "reservedSpendUsd",
      "settledSpendUsd",
      "nextActions",
      "requiresHuman",
    ],
    optional: ["reasonCode"],
    exact: true,
  },
} as const;

export const PROTOCOL_SCHEMA_HASH = hashCanonicalJson(SCHEMA_DESCRIPTOR);

export interface RuntimeSchema<T> {
  parse(value: unknown): T;
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: Error };
}

function schema<T>(parser: (value: unknown) => T): RuntimeSchema<T> {
  return {
    parse: parser,
    safeParse(value) {
      try {
        return { success: true, data: parser(value) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };
}

export const ArtifactSchema = schema<ProtocolArtifact>(parseArtifact);
export const HandshakeSchema = schema<ProtocolHandshake>((value) => {
  const artifact = parseArtifact(value);
  if (artifact.kind !== "handshake") {
    throw new Error("Expected handshake artifact");
  }
  return artifact as ProtocolHandshake;
});
export const CellTransitionSchema = schema<CellTransition>((value) => {
  const artifact = parseArtifact(value);
  if (artifact.kind !== "cell_transition") {
    throw new Error("Expected cell_transition artifact");
  }
  return artifact as CellTransition;
});
export const StructuralRunSummarySchema =
  schema<StructuralRunSummary>(parseStructuralRunSummary);

function artifactKindSchema<K extends ProtocolArtifact["kind"]>(
  kind: K,
): RuntimeSchema<Extract<ProtocolArtifact, { kind: K }>> {
  return schema((value) => {
    const artifact = parseArtifact(value);
    if (artifact.kind !== kind) {
      throw new Error(`Expected ${kind} artifact`);
    }
    return artifact as Extract<ProtocolArtifact, { kind: K }>;
  });
}

export const schemas = {
  artifact: ArtifactSchema,
  frozenCase: artifactKindSchema("frozen_case"),
  sourceReceipt: artifactKindSchema("source_receipt"),
  evidenceCardDraft: artifactKindSchema("evidence_card_draft"),
  evidenceCardApproval: artifactKindSchema("evidence_card_approval"),
  curatorManifest: artifactKindSchema("curator_manifest"),
  curatorApproval: artifactKindSchema("curator_approval"),
  runManifest: artifactKindSchema("run_manifest"),
  paidApproval: artifactKindSchema("paid_approval"),
  handshake: HandshakeSchema,
  preparedRequest: artifactKindSchema("prepared_request"),
  providerResult: artifactKindSchema("provider_result"),
  cellTransition: CellTransitionSchema,
  continuationCheckpoint: artifactKindSchema("continuation_checkpoint"),
  blindPacket: artifactKindSchema("blind_packet"),
  unblindingKey: artifactKindSchema("unblinding_key"),
  blindDecisions: artifactKindSchema("blind_decisions"),
  finalReport: artifactKindSchema("final_report"),
  structuralRunSummary: StructuralRunSummarySchema,
} as const;

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, "$", new Set<object>());
}

export function hashCanonicalJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function parseArtifact(value: unknown): ProtocolArtifact {
  const artifact = requireRecord(value, "artifact");
  const protocolVersion = requireString(artifact, "protocolVersion");
  assertCompatibleProtocolVersion(protocolVersion);
  const schemaHash = requireString(artifact, "schemaHash");
  if (schemaHash !== PROTOCOL_SCHEMA_HASH) {
    throw new Error(
      `Artifact schema hash mismatch: expected ${PROTOCOL_SCHEMA_HASH}, received ${schemaHash}`,
    );
  }
  const kind = requireString(artifact, "kind") as ArtifactKind;
  if (!Object.hasOwn(ARTIFACT_REQUIREMENTS, kind)) {
    throw new Error(`Unknown artifact kind: ${kind}`);
  }
  requireString(artifact, "createdAt");
  assertJsonValue(artifact, "artifact");
  for (const key of ARTIFACT_REQUIREMENTS[kind]) {
    if (!Object.hasOwn(artifact, key)) {
      throw new Error(`${kind} artifact is missing required field ${key}`);
    }
  }
  validateArtifactFields(kind, artifact);
  return artifact as ProtocolArtifact;
}

export function parseStructuralRunSummary(value: unknown): StructuralRunSummary {
  const summary = requireRecord(value, "structural run summary");
  assertCompatibleProtocolVersion(requireString(summary, "protocolVersion"));
  const allowed = new Set([
    "protocolVersion",
    "runId",
    "lifecycle",
    "reasonCode",
    "completedCells",
    "outstandingCells",
    "reservedSpendUsd",
    "settledSpendUsd",
    "nextActions",
    "requiresHuman",
  ]);
  for (const key of Object.keys(summary)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Structural summaries reject private or unknown field ${key}`,
      );
    }
  }
  requireString(summary, "runId");
  const lifecycle = requireString(summary, "lifecycle");
  if (![
    "draft",
    "running",
    "completed",
    "invalidated",
    "aborted",
    "failed",
  ].includes(lifecycle)) {
    throw new Error(`Invalid structural lifecycle ${lifecycle}`);
  }
  if (summary.reasonCode !== undefined && typeof summary.reasonCode !== "string") {
    throw new Error("Structural reasonCode must be a string");
  }
  for (const key of [
    "completedCells",
    "outstandingCells",
    "reservedSpendUsd",
    "settledSpendUsd",
  ] as const) {
    const number = summary[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0) {
      throw new Error(`Structural ${key} must be a non-negative finite number`);
    }
  }
  if (
    !Array.isArray(summary.nextActions)
    || summary.nextActions.some((action) => typeof action !== "string")
  ) {
    throw new Error("Structural nextActions must contain only strings");
  }
  if (typeof summary.requiresHuman !== "boolean") {
    throw new Error("Structural requiresHuman must be boolean");
  }
  return summary as unknown as StructuralRunSummary;
}

export function createHandshake(input: {
  capabilities: readonly string[];
  harnessDigest: string;
  createdAt?: string;
}): ProtocolHandshake {
  const capabilities = [...new Set(input.capabilities)].sort();
  if (capabilities.length === 0 || capabilities.some((value) => value.length === 0)) {
    throw new Error("Handshake capabilities must contain non-empty values");
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "handshake",
    createdAt: input.createdAt ?? new Date().toISOString(),
    canonicalizerId: CANONICALIZER_ID,
    canonicalizerVersion: CANONICALIZER_VERSION,
    capabilities,
    harnessDigest: nonEmpty(input.harnessDigest, "harness digest"),
  };
}

export function validateHandshake(
  localValue: unknown,
  remoteValue: unknown,
  requiredCapabilities: readonly string[] = [],
): void {
  const local = HandshakeSchema.parse(localValue);
  const remote = HandshakeSchema.parse(remoteValue);
  if (local.protocolVersion !== remote.protocolVersion) {
    throw new Error("Worker protocol version mismatch");
  }
  if (local.schemaHash !== remote.schemaHash) {
    throw new Error("Worker schema hash mismatch");
  }
  if (
    local.canonicalizerId !== remote.canonicalizerId
    || local.canonicalizerVersion !== remote.canonicalizerVersion
  ) {
    throw new Error("Worker canonicalizer mismatch");
  }
  if (local.harnessDigest !== remote.harnessDigest) {
    throw new Error("Worker non-variant harness digest mismatch");
  }
  if (canonicalJson([...local.capabilities].sort()) !== canonicalJson([...remote.capabilities].sort())) {
    throw new Error("Worker capability set mismatch");
  }
  const missing = requiredCapabilities.filter(
    (capability) => !remote.capabilities.includes(capability),
  );
  if (missing.length > 0) {
    throw new Error(`Worker is missing required capability: ${missing.join(", ")}`);
  }
}

export function createApproval<T extends Record<string, unknown>>(
  target: unknown,
  input: T & {
    kind: "curator_approval" | "paid_approval";
    operator: string;
    maximumCalls: number;
    maximumSpendUsd: number;
    createdAt?: string;
  },
): BoundApproval & T {
  return {
    ...input,
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    createdAt: input.createdAt ?? new Date().toISOString(),
    targetHash: hashCanonicalJson(target),
  } as BoundApproval & T;
}

export function assertApprovalCurrent(
  target: unknown,
  approvalValue: unknown,
): void {
  const approval = parseArtifact(approvalValue);
  if (approval.kind !== "curator_approval" && approval.kind !== "paid_approval") {
    throw new Error("Expected a curator or paid approval");
  }
  if (approval.targetHash !== hashCanonicalJson(target)) {
    throw new Error("Approval is stale for the current immutable manifest");
  }
  const targetRecord = requireRecord(target, "approval target");
  for (const key of ["maximumCalls", "maximumSpendUsd"] as const) {
    if (
      Object.hasOwn(targetRecord, key)
      && targetRecord[key] !== approval[key]
    ) {
      throw new Error(`Approval ${key} does not match its manifest`);
    }
  }
}

export function assertBlindReviewComplete(
  packet: { pairTokens: readonly string[] },
  decisions: {
    locked: boolean;
    decisions: readonly { pairToken: string; choice: string }[];
  },
): void {
  const expected = new Set(packet.pairTokens);
  const observed = new Set<string>();
  for (const decision of decisions.decisions) {
    if (!expected.has(decision.pairToken) || observed.has(decision.pairToken)) {
      throw new Error("Blind review contains a foreign or duplicate decision");
    }
    observed.add(decision.pairToken);
  }
  if (!decisions.locked || observed.size !== expected.size) {
    throw new Error("Blind review is incomplete and cannot be unblinded");
  }
}

export function assertCompatibleProtocolVersion(version: string): void {
  const currentMajor = PROTOCOL_VERSION.split(".", 1)[0];
  const receivedMajor = version.split(".", 1)[0];
  if (!/^\d+\.\d+\.\d+$/.test(version) || receivedMajor !== currentMajor) {
    throw new Error(
      `Unsupported protocol major: expected ${currentMajor}.x, received ${version}`,
    );
  }
}

export const GOLDEN_CANONICAL_VECTORS = [
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
] as const;

function serializeCanonical(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Canonical JSON requires a finite number at ${path}`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === "undefined") {
    throw new Error(`Canonical JSON cannot represent undefined at ${path}`);
  }
  if (typeof value === "bigint") {
    throw new Error(`Canonical JSON cannot represent bigint at ${path}`);
  }
  if (typeof value !== "object") {
    throw new Error(`Canonical JSON cannot represent ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Canonical JSON cannot represent cycles at ${path}`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        throw new Error(`Canonical JSON rejects sparse or decorated arrays at ${path}`);
      }
      return `[${value.map((entry, index) => (
        serializeCanonical(entry, `${path}[${index}]`, ancestors)
      )).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Canonical JSON requires plain objects at ${path}`);
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${serializeCanonical(record[key], `${path}.${key}`, ancestors)}`
    )).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function validateArtifactFields(
  kind: ArtifactKind,
  artifact: Record<string, unknown>,
): void {
  for (const field of ["caseId", "caseHash", "sourceReceiptHash", "cardHash",
    "evidenceCardHash", "targetHash", "operator", "reviewer", "cellId",
    "requestHash", "branchId", "packetHash", "runManifestHash",
    "blindDecisionsHash", "harnessDigest", "canonicalizerId",
    "canonicalizerVersion"] as const) {
    if (Object.hasOwn(artifact, field)) requireString(artifact, field);
  }
  for (const field of [
    "maximumCalls",
    "maximumSpendUsd",
    "sequence",
    "turn",
  ] as const) {
    if (!Object.hasOwn(artifact, field)) continue;
    const value = artifact[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${kind}.${field} must be a non-negative finite number`);
    }
  }
  for (const field of [
    "sources",
    "items",
    "privateDataClasses",
    "cells",
    "capabilities",
    "pairs",
    "mappings",
    "decisions",
  ] as const) {
    if (Object.hasOwn(artifact, field) && !Array.isArray(artifact[field])) {
      throw new Error(`${kind}.${field} must be an array`);
    }
  }
  if (kind === "cell_transition" && !CELL_STAGES.includes(artifact.stage as CellStage)) {
    throw new Error(`Invalid cell transition stage ${String(artifact.stage)}`);
  }
  if (
    kind === "provider_result"
    && !["completed", "provider_failure"].includes(String(artifact.status))
  ) {
    throw new Error(`Invalid provider result status ${String(artifact.status)}`);
  }
  if (
    kind === "evidence_card_draft"
    && !["manual", "curator"].includes(String(artifact.provenance))
  ) {
    throw new Error(`Invalid evidence-card provenance ${String(artifact.provenance)}`);
  }
  if (kind === "blind_decisions" && typeof artifact.locked !== "boolean") {
    throw new Error("blind_decisions.locked must be boolean");
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function nonEmpty(value: string, label: string): string {
  if (value.length === 0) throw new Error(`${label} must not be empty`);
  return value;
}

function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  try {
    canonicalJson(value);
  } catch (error) {
    throw new Error(
      `${label} must contain only canonical JSON values: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
