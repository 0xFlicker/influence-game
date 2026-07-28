import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  assertApprovalCurrent,
  createApproval,
  hashCanonicalJson,
  parseArtifact,
  type CuratorApprovalArtifact,
  type EvidenceCardApprovalArtifact,
  type FrozenCaseArtifact,
  type JsonObject,
  type JsonValue,
} from "@influence/prompt-lab-protocol";

export type EvidenceClass = "required" | "useful" | "known_distractor" | "unscored";

export interface PromptThreadEvidenceCitation {
  sourceId: string;
  classification: EvidenceClass;
  applicableTurns: number[];
  rationale: string;
}

export interface PromptThreadEvidenceCard {
  protocolVersion: typeof PROTOCOL_VERSION;
  schemaHash: typeof PROTOCOL_SCHEMA_HASH;
  kind: "evidence_card_draft";
  createdAt: string;
  caseHash: string;
  provenance: "manual" | "curator";
  items: PromptThreadEvidenceCitation[];
}

export interface EligibleHistoryItem {
  sourceId: string;
  eligibleActorIds: string[];
  privateItem: JsonObject;
}

export interface CuratorPartition {
  partitionId: string;
  actorId: string;
  sourceIds: string[];
  privateItems: JsonObject[];
  privateContext: JsonObject;
}

export interface CuratorManifest {
  protocolVersion: typeof PROTOCOL_VERSION;
  schemaHash: typeof PROTOCOL_SCHEMA_HASH;
  kind: "curator_manifest";
  createdAt: string;
  caseHash: string;
  maximumCalls: number;
  maximumSpendUsd: number;
  privateDataClasses: JsonValue[];
  model: string;
  outputSchema: JsonObject;
  partitions: CuratorPartition[];
}

export interface CuratorPartitionResponse {
  partitionId: string;
  items: PromptThreadEvidenceCitation[];
}

const EVIDENCE_CLASSES = new Set<EvidenceClass>([
  "required",
  "useful",
  "known_distractor",
  "unscored",
]);

const CURATOR_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "classification", "applicableTurns", "rationale"],
        properties: {
          sourceId: { type: "string" },
          classification: {
            type: "string",
            enum: ["required", "useful", "known_distractor", "unscored"],
          },
          applicableTurns: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 4 },
          },
          rationale: { type: "string" },
        },
      },
    },
  },
};

export function eligibleHistoryCatalog(caseValue: FrozenCaseArtifact): EligibleHistoryItem[] {
  const artifact = parseArtifact(caseValue);
  if (artifact.kind !== "frozen_case") throw new Error("Evidence cards require a frozen case");
  const starting = requireObject(artifact.privateData.startingState, "starting state");
  const catalog = starting.historyCatalog;
  if (!Array.isArray(catalog)) throw new Error("Case has no eligible history catalog");
  const seen = new Set<string>();
  return catalog.map((value, index) => {
    const row = requireObject(value, `history item ${index}`);
    if (typeof row.sourceId !== "string" || row.sourceId.length === 0 || seen.has(row.sourceId)) {
      throw new Error(`History item ${index} has an invalid sourceId`);
    }
    seen.add(row.sourceId);
    if (!Array.isArray(row.eligibleActorIds) ||
        row.eligibleActorIds.some((actorId) => typeof actorId !== "string")) {
      throw new Error(`History item ${row.sourceId} has invalid actor eligibility`);
    }
    return {
      sourceId: row.sourceId,
      eligibleActorIds: [...new Set(row.eligibleActorIds as string[])].sort(),
      privateItem: structuredClone(row),
    };
  });
}

/** Complete, blind curator input sourced only from the frozen starting catalog. */
export function buildCuratorManifest(
  caseValue: FrozenCaseArtifact,
  input: {
    model: string;
    maximumCalls: number;
    maximumSpendUsd: number;
    maxItemsPerPartition: number;
    now?: Date;
  },
): CuratorManifest {
  if (
    input.model.trim().length === 0 ||
    !Number.isInteger(input.maximumCalls) ||
    input.maximumCalls < 1 ||
    !Number.isFinite(input.maximumSpendUsd) ||
    input.maximumSpendUsd < 0 ||
    !Number.isInteger(input.maxItemsPerPartition) ||
    input.maxItemsPerPartition < 1
  ) {
    throw new Error("Invalid curator manifest cap or model");
  }
  const byActor = new Map<string, EligibleHistoryItem[]>();
  const catalog = eligibleHistoryCatalog(caseValue);
  const starting = requireObject(caseValue.privateData.startingState, "starting state");
  for (const item of catalog) {
    for (const actorId of item.eligibleActorIds) {
      const values = byActor.get(actorId) ?? [];
      values.push(item);
      byActor.set(actorId, values);
    }
  }
  const partitions = [...byActor.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([actorId, items]) => (
      Array.from(
        { length: Math.ceil(items.length / input.maxItemsPerPartition) },
        (_, index): CuratorPartition => {
          const slice = items.slice(
            index * input.maxItemsPerPartition,
            (index + 1) * input.maxItemsPerPartition,
          );
          return {
            partitionId: `${actorId}:${String(index + 1).padStart(3, "0")}`,
            actorId,
            sourceIds: slice.map(({ sourceId }) => sourceId),
            privateItems: slice.map(({ privateItem }) => structuredClone(privateItem)),
            privateContext: curatorActorContext(starting, actorId, catalog),
          };
        },
      )
    ));
  if (partitions.length > input.maximumCalls) {
    throw new Error("Curator call cap cannot cover the complete eligible catalog");
  }
  const manifest: CuratorManifest = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "curator_manifest",
    createdAt: (input.now ?? new Date()).toISOString(),
    caseHash: hashCanonicalJson(caseValue),
    maximumCalls: input.maximumCalls,
    maximumSpendUsd: input.maximumSpendUsd,
    privateDataClasses: [
      "canonical_facts",
      "typed_strategic_receipts",
      "public_dialogue",
      "actor_owned_private_dialogue",
    ],
    model: input.model,
    outputSchema: structuredClone(CURATOR_OUTPUT_SCHEMA),
    partitions,
  };
  parseArtifact(manifest);
  return manifest;
}

function curatorActorContext(
  starting: JsonObject,
  actorId: string,
  catalog: readonly EligibleHistoryItem[],
): JsonObject {
  const continuity = requireObject(starting.continuity, "continuity");
  const capsules = Array.isArray(continuity.playerContinuityCapsules)
    ? continuity.playerContinuityCapsules.filter((value) => {
        const capsule = value && typeof value === "object" && !Array.isArray(value)
          ? value as JsonObject
          : null;
        return capsule?.playerId === actorId;
      })
    : [];
  return {
    actorId,
    ...(starting.canonicalProjection !== undefined
      ? { canonicalProjection: structuredClone(starting.canonicalProjection) }
      : {}),
    ...(starting.roster !== undefined
      ? { roster: structuredClone(starting.roster) }
      : {}),
    ...(starting.config !== undefined
      ? { config: structuredClone(starting.config) }
      : {}),
    continuity: capsules,
    prelude: catalog
      .filter((item) => (
        item.privateItem.lane === "prelude" &&
        item.eligibleActorIds.includes(actorId)
      ))
      .map((item) => structuredClone(item.privateItem)),
  };
}

export function approveCuratorManifest(
  manifest: CuratorManifest,
  operator: string,
  now = new Date(),
): CuratorApprovalArtifact {
  if (!operator.trim()) throw new Error("Curator approval requires an operator");
  return createApproval(manifest, {
    kind: "curator_approval",
    operator,
    maximumCalls: manifest.maximumCalls,
    maximumSpendUsd: manifest.maximumSpendUsd,
    createdAt: now.toISOString(),
  });
}

export function assertCuratorApproval(
  manifest: CuratorManifest,
  approval: CuratorApprovalArtifact,
): void {
  assertApprovalCurrent(manifest, approval);
  if (approval.kind !== "curator_approval") throw new Error("Expected curator approval");
}

/**
 * Applies already-saved complete curator responses. This is deliberately pure:
 * restart never needs to redispatch a completed curator partition.
 */
export function applyCuratorResponses(
  caseValue: FrozenCaseArtifact,
  manifest: CuratorManifest,
  approval: CuratorApprovalArtifact,
  responses: readonly CuratorPartitionResponse[],
  now = new Date(),
): PromptThreadEvidenceCard {
  assertCuratorApproval(manifest, approval);
  if (manifest.caseHash !== hashCanonicalJson(caseValue)) {
    throw new Error("Curator manifest is stale for this case");
  }
  const expected = new Map(manifest.partitions.map((partition) => [
    partition.partitionId,
    new Set(partition.sourceIds),
  ]));
  if (responses.length !== expected.size) throw new Error("Curator response set is incomplete");
  const proposed: PromptThreadEvidenceCitation[] = [];
  const seenPartitions = new Set<string>();
  for (const response of responses) {
    const allowed = expected.get(response.partitionId);
    if (!allowed || seenPartitions.has(response.partitionId)) {
      throw new Error("Curator response has an unknown or duplicate partition");
    }
    seenPartitions.add(response.partitionId);
    for (const item of response.items) {
      if (!allowed.has(item.sourceId)) {
        throw new Error("Curator response cited data outside its actor partition");
      }
      proposed.push(item);
    }
  }
  return draft(caseValue, "curator", completeCuratorCard(caseValue, proposed), now);
}

/** Any omitted catalog item stays visible as unscored, never silently disappears. */
export function completeCuratorCard(
  caseValue: FrozenCaseArtifact,
  proposed: readonly PromptThreadEvidenceCitation[],
): PromptThreadEvidenceCitation[] {
  const catalog = new Map(eligibleHistoryCatalog(caseValue).map((item) => [item.sourceId, item]));
  const cited = new Map<string, PromptThreadEvidenceCitation>();
  for (const item of proposed) {
    if (!catalog.has(item.sourceId) || cited.has(item.sourceId)) {
      throw new Error("Curator card has an unknown or duplicate citation");
    }
    cited.set(item.sourceId, structuredClone(item));
  }
  return [...catalog.keys()].map((sourceId) => cited.get(sourceId) ?? {
    sourceId,
    classification: "unscored",
    applicableTurns: [],
    rationale: "Not scored by curator",
  });
}

export function createManualEvidenceCard(
  caseValue: FrozenCaseArtifact,
  items: readonly PromptThreadEvidenceCitation[],
  now = new Date(),
): PromptThreadEvidenceCard {
  const card = draft(caseValue, "manual", completeCuratorCard(caseValue, items), now);
  validateEvidenceCard(caseValue, card);
  return card;
}

export function freezeEvidenceCard(
  caseValue: FrozenCaseArtifact,
  draftValue: PromptThreadEvidenceCard,
  reviewer: string,
  now = new Date(),
): EvidenceCardApprovalArtifact {
  validateEvidenceCard(caseValue, draftValue);
  if (!reviewer.trim()) throw new Error("Evidence-card approval requires a reviewer");
  const approval: EvidenceCardApprovalArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "evidence_card_approval",
    createdAt: now.toISOString(),
    caseHash: hashCanonicalJson(caseValue),
    cardHash: hashCanonicalJson(draftValue),
    reviewer,
  };
  parseArtifact(approval);
  return approval;
}

export function assertEvidenceCardApproval(
  caseValue: FrozenCaseArtifact,
  draftValue: PromptThreadEvidenceCard,
  approvalValue: EvidenceCardApprovalArtifact,
): void {
  validateEvidenceCard(caseValue, draftValue);
  const approval = parseArtifact(approvalValue);
  if (approval.kind !== "evidence_card_approval") throw new Error("Expected evidence-card approval");
  if (
    approval.caseHash !== hashCanonicalJson(caseValue) ||
    approval.cardHash !== hashCanonicalJson(draftValue)
  ) {
    throw new Error("Evidence-card approval is stale");
  }
}

export function validateEvidenceCard(
  caseValue: FrozenCaseArtifact,
  value: PromptThreadEvidenceCard,
): void {
  if (value.kind !== "evidence_card_draft") throw new Error("Expected an evidence-card draft");
  if (value.caseHash !== hashCanonicalJson(caseValue)) {
    throw new Error("Evidence card is stale for this case");
  }
  const catalog = new Map(eligibleHistoryCatalog(caseValue).map((item) => [item.sourceId, item]));
  const turnActors = replayTurnActors(caseValue);
  const seen = new Set<string>();
  for (const item of value.items) {
    const source = catalog.get(item.sourceId);
    if (!source || seen.has(item.sourceId)) throw new Error("Evidence card has invalid citation");
    if (!EVIDENCE_CLASSES.has(item.classification) || !item.rationale.trim()) {
      throw new Error("Evidence card has invalid classification or rationale");
    }
    for (const turn of item.applicableTurns) {
      if (!Number.isInteger(turn) || turn < 1 || turn > turnActors.length) {
        throw new Error("Evidence card has invalid applicable turn");
      }
      if (!source.eligibleActorIds.includes(turnActors[turn - 1]!)) {
        throw new Error("Evidence card citation is not eligible for its applicable turn");
      }
    }
    seen.add(item.sourceId);
  }
  if (seen.size !== catalog.size) {
    throw new Error("Evidence card must retain every eligible catalog item");
  }
}

export function renderEvidenceCardMarkdown(card: PromptThreadEvidenceCard): string {
  return [
    "# Prompt-thread evidence card",
    "",
    ...card.items.map((item) => (
      `- ${item.sourceId}: **${item.classification}** ` +
      `(turns ${item.applicableTurns.join(", ") || "none"}) — ${item.rationale}`
    )),
  ].join("\n");
}

function replayTurnActors(caseValue: FrozenCaseArtifact): string[] {
  const traces = caseValue.privateData.traces;
  if (!Array.isArray(traces)) throw new Error("Case has no replay traces");
  return traces.flatMap((value) => {
    const trace = requireObject(value, "replay trace");
    return trace.action === "mingle-turn" && typeof trace.actorId === "string"
      ? [trace.actorId]
      : [];
  });
}

function draft(
  caseValue: FrozenCaseArtifact,
  provenance: "manual" | "curator",
  items: readonly PromptThreadEvidenceCitation[],
  now: Date,
): PromptThreadEvidenceCard {
  const card: PromptThreadEvidenceCard = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "evidence_card_draft",
    createdAt: now.toISOString(),
    caseHash: hashCanonicalJson(caseValue),
    provenance,
    items: items.map((item) => structuredClone(item)),
  };
  parseArtifact(card);
  return card;
}

function requireObject(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
