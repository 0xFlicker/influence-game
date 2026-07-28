import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  assertBlindReviewComplete,
  canonicalJson,
  hashCanonicalJson,
  parseArtifact,
  type BlindDecisionsArtifact,
  type BlindPacketArtifact,
  type ContinuationCheckpointArtifact,
  type FinalReportArtifact,
  type JsonObject,
  type UnblindingKeyArtifact,
} from "@influence/prompt-lab-protocol";
import {
  buildPromptThreadFinalReport,
  renderPromptThreadReportMarkdown,
  type PromptThreadReportCell,
  type PromptThreadRevealedDecision,
  type PromptThreadSelectionReason,
} from "@influence/engine/prompt-thread-report";
import { randomBytes } from "node:crypto";
import {
  atomicWriteArtifact,
  atomicWriteJson,
  atomicWritePrivateText,
  inspectRunRecovery,
  readArtifact,
  readArtifactIfExists,
  withRunMutationLock,
  type PrivateWorkspace,
} from "./prompt-thread-workspace.js";
import type {
  PromptThreadPanelCell,
  PromptThreadPanelManifest,
} from "./prompt-thread-panel.js";
import type {
  PromptThreadEvidenceCard,
  PromptThreadEvidenceCitation,
} from "./prompt-thread-evidence-card.js";
import { estimateProviderUsageForSnapshot } from "./provider-cost-accounting.js";

export type BlindChoice = "A" | "B" | "no_preference" | "insufficient_evidence";

export interface BlindConversationTurn {
  turn: number;
  actor: "finn" | "lyra";
  message: string | null;
  noReply: boolean;
  gotoRoomId: number | null;
  gotoPlayerName: string | null;
  coordinationReceipt: JsonObject | null;
  evidenceReferences: string[];
}

export interface BlindConversationBranch {
  repetition: number;
  arm: "baseline" | "candidate";
  turns: BlindConversationTurn[];
}

export interface PromptThreadBlindPair {
  pairToken: string;
  conversationA: BlindConversationTurn[];
  conversationB: BlindConversationTurn[];
}

export interface PromptThreadBlindMapping {
  pairToken: string;
  repetition: number;
  aArm: "baseline" | "candidate";
  bArm: "baseline" | "candidate";
}

export interface BlindDecisionReasons {
  strategy?: string;
  coherence?: string;
  evidenceUse?: string;
  watchability?: string;
}

export interface BlindReviewStatus {
  lifecycle: "blind_ready" | "review_in_progress" | "reviewed";
  completedPairTokens: string[];
  outstandingPairTokens: string[];
}

export interface PromptThreadUnblindedReview {
  decisionsArtifact: BlindDecisionsArtifact;
  revealedDecisions: PromptThreadRevealedDecision[];
}

export function createPromptThreadBlindArtifacts(
  evidenceCardHash: string,
  branches: readonly BlindConversationBranch[],
  options: { seed?: string; now?: Date } = {},
): { packet: BlindPacketArtifact; key: UnblindingKeyArtifact } {
  const seed = options.seed ?? randomBytes(32).toString("hex");
  const createdAt = (options.now ?? new Date()).toISOString();
  const pairs: PromptThreadBlindPair[] = [];
  const mappings: PromptThreadBlindMapping[] = [];
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    const baseline = requireBranch(branches, repetition, "baseline");
    const candidate = requireBranch(branches, repetition, "candidate");
    const pairToken = `pair-${hashCanonicalJson({
      seed,
      repetition,
      baseline: hashCanonicalJson(baseline.turns),
      candidate: hashCanonicalJson(candidate.turns),
    }).slice("sha256:".length, "sha256:".length + 24)}`;
    const candidateFirst = Number.parseInt(
      hashCanonicalJson({ seed, repetition }).slice(-2),
      16,
    ) % 2 === 0;
    const a = candidateFirst ? candidate : baseline;
    const b = candidateFirst ? baseline : candidate;
    pairs.push({
      pairToken,
      conversationA: structuredClone(a.turns),
      conversationB: structuredClone(b.turns),
    });
    mappings.push({
      pairToken,
      repetition,
      aArm: a.arm,
      bArm: b.arm,
    });
  }
  const packet: BlindPacketArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "blind_packet",
    createdAt,
    evidenceCardHash,
    pairs: JSON.parse(JSON.stringify(pairs)),
  };
  parseArtifact(packet);
  const key: UnblindingKeyArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "unblinding_key",
    createdAt,
    packetHash: hashCanonicalJson(packet),
    mappings: JSON.parse(JSON.stringify(mappings)),
  };
  parseArtifact(key);
  assertBlindPacketSafe(packet);
  return { packet, key };
}

export async function initializePromptThreadBlindReview(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  evidenceCard: PromptThreadEvidenceCard,
  options: { seed?: string; now?: Date } = {},
): Promise<{ packet: BlindPacketArtifact; key: UnblindingKeyArtifact }> {
  await assertCompletedRun(workspace, manifest);
  if (hashCanonicalJson(evidenceCard) !== manifest.evidenceCardHash) {
    throw new Error("Blind packet evidence card changed after panel approval");
  }
  const branches = await loadBlindBranches(workspace, manifest);
  const artifacts = createPromptThreadBlindArtifacts(
    manifest.evidenceCardHash,
    branches,
    options,
  );
  await withRunMutationLock(workspace, manifest.runId, async (lock) => {
    await atomicWriteArtifact(
      lock,
      `runs/${manifest.runId}/blind-packet.json`,
      artifacts.packet,
    );
    await atomicWriteArtifact(
      lock,
      `runs/${manifest.runId}/unblinding-key.json`,
      artifacts.key,
    );
  });
  return artifacts;
}

export async function recordPromptThreadBlindDecision(
  workspace: PrivateWorkspace,
  runId: string,
  packet: BlindPacketArtifact,
  input: {
    pairToken: string;
    choice: BlindChoice;
    reviewer: string;
    reasons?: BlindDecisionReasons;
    now?: Date;
  },
): Promise<BlindDecisionsArtifact> {
  const pairTokens = packetPairTokens(packet);
  if (!pairTokens.includes(input.pairToken)) {
    throw new Error("Blind decision references an unknown pair token");
  }
  if (!input.reviewer.trim()) throw new Error("Blind decision requires a reviewer");
  const decision = {
    pairToken: input.pairToken,
    choice: input.choice,
    ...(input.reasons && { reasons: cleanReasons(input.reasons) }),
  };
  const artifact: BlindDecisionsArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "blind_decisions",
    createdAt: (input.now ?? new Date()).toISOString(),
    packetHash: hashCanonicalJson(packet),
    reviewer: input.reviewer,
    locked: true,
    decisions: JSON.parse(JSON.stringify([decision])),
  };
  parseArtifact(artifact);
  await withRunMutationLock(workspace, runId, async (lock) => {
    await atomicWriteArtifact(
      lock,
      decisionPath(runId, input.pairToken),
      artifact,
    );
  });
  return artifact;
}

export async function promptThreadBlindReviewStatus(
  workspace: PrivateWorkspace,
  runId: string,
  packet: BlindPacketArtifact,
): Promise<BlindReviewStatus> {
  const completedPairTokens: string[] = [];
  for (const pairToken of packetPairTokens(packet)) {
    const artifact = await readArtifactIfExists(
      workspace,
      decisionPath(runId, pairToken),
    );
    if (artifact) {
      assertSingleDecision(parseArtifact(artifact), packet, pairToken);
      completedPairTokens.push(pairToken);
    }
  }
  const outstandingPairTokens = packetPairTokens(packet)
    .filter((pairToken) => !completedPairTokens.includes(pairToken));
  return {
    lifecycle: completedPairTokens.length === 0
      ? "blind_ready"
      : outstandingPairTokens.length === 0
        ? "reviewed"
        : "review_in_progress",
    completedPairTokens,
    outstandingPairTokens,
  };
}

export async function unblindPromptThreadReview(
  workspace: PrivateWorkspace,
  runId: string,
  packet: BlindPacketArtifact,
  key: UnblindingKeyArtifact,
): Promise<PromptThreadUnblindedReview> {
  if (key.packetHash !== hashCanonicalJson(packet)) {
    throw new Error("Unblinding key does not match the blind packet");
  }
  const decisions: Array<{
    pairToken: string;
    choice: BlindChoice;
    reasons?: BlindDecisionReasons;
  }> = [];
  let reviewer: string | null = null;
  for (const pairToken of packetPairTokens(packet)) {
    const artifact = parseArtifact(await readArtifact(
      workspace,
      decisionPath(runId, pairToken),
    ));
    if (artifact.kind !== "blind_decisions") {
      throw new Error("Stored blind decision has the wrong artifact kind");
    }
    const decision = assertSingleDecision(artifact, packet, pairToken);
    reviewer ??= artifact.reviewer;
    if (artifact.reviewer !== reviewer) {
      throw new Error("Blind decisions must use one reviewer identity");
    }
    decisions.push(decision);
  }
  const decisionsArtifact: BlindDecisionsArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "blind_decisions",
    createdAt: new Date().toISOString(),
    packetHash: hashCanonicalJson(packet),
    reviewer: reviewer ?? "",
    locked: true,
    decisions: JSON.parse(JSON.stringify(decisions)),
  };
  assertBlindReviewComplete(
    { pairTokens: packetPairTokens(packet) },
    decisionsArtifact as unknown as {
      locked: boolean;
      decisions: Array<{ pairToken: string; choice: string }>;
    },
  );
  parseArtifact(decisionsArtifact);
  const mappings = parseMappings(key);
  const revealedDecisions = decisions.map((decision) => {
    const mapping = mappings.get(decision.pairToken);
    if (!mapping) throw new Error("Unblinding key is missing a pair mapping");
    return {
      pairToken: decision.pairToken,
      choice: decision.choice,
      preferredArm: decision.choice === "A"
        ? mapping.aArm
        : decision.choice === "B"
          ? mapping.bArm
          : null,
      ...(decision.reasons && { reasons: structuredClone(decision.reasons) }),
    } satisfies PromptThreadRevealedDecision;
  });
  await withRunMutationLock(workspace, runId, async (lock) => {
    await atomicWriteArtifact(
      lock,
      `runs/${runId}/blind-decisions.json`,
      decisionsArtifact,
    );
    await atomicWriteJson(
      lock,
      `runs/${runId}/unblinded.json`,
      { revealedDecisions },
    );
  });
  return { decisionsArtifact, revealedDecisions };
}

export async function buildPromptThreadReportFromRun(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  evidenceCard: PromptThreadEvidenceCard,
  decisions: PromptThreadUnblindedReview,
  caseValue: { privateData: JsonObject },
  options: { now?: Date } = {},
): Promise<{ report: FinalReportArtifact; markdown: string }> {
  await assertCompletedRun(workspace, manifest);
  const packet = parseArtifact(await readArtifact(
    workspace,
    `runs/${manifest.runId}/blind-packet.json`,
  ));
  if (packet.kind !== "blind_packet") {
    throw new Error("Report requires the run's blind packet");
  }
  assertUnblindedReviewMatchesPacket(packet, decisions);
  const reportCells = await loadReportCells(
    workspace,
    manifest,
    evidenceCard,
    caseValue,
  );
  const report = buildPromptThreadFinalReport({
    runManifestHash: hashCanonicalJson(manifest),
    blindDecisionsHash: hashCanonicalJson(decisions.decisionsArtifact),
    caseHash: manifest.caseHash,
    evidenceCardHash: manifest.evidenceCardHash,
    verdictScope: manifest.verdictScope,
    expectedCalls: 28,
    cells: reportCells,
    blindDecisions: decisions.revealedDecisions,
    rateCardVersion: manifest.rateCardVersion,
    pricingSourceId: manifest.pricingSourceId,
    now: options.now,
  });
  const markdown = renderPromptThreadReportMarkdown(report);
  await withRunMutationLock(workspace, manifest.runId, async (lock) => {
    await atomicWriteArtifact(
      lock,
      `runs/${manifest.runId}/final-report.json`,
      report,
    );
    await atomicWritePrivateText(
      lock,
      `runs/${manifest.runId}/final-report.md`,
      markdown,
    );
  });
  return { report, markdown };
}

function assertUnblindedReviewMatchesPacket(
  packet: BlindPacketArtifact,
  review: PromptThreadUnblindedReview,
): void {
  if (
    review.decisionsArtifact.packetHash !== hashCanonicalJson(packet)
    || !review.decisionsArtifact.locked
    || review.decisionsArtifact.decisions.length !== 3
    || review.revealedDecisions.length !== 3
  ) {
    throw new Error("Report requires complete unblinding data for this run");
  }
  const choices = new Map<string, BlindChoice>();
  for (const candidate of review.decisionsArtifact.decisions) {
    const decision = record(candidate, "locked blind decision");
    if (
      typeof decision.pairToken !== "string"
      || !isBlindChoice(decision.choice)
      || choices.has(decision.pairToken)
    ) {
      throw new Error("Report received invalid locked blind decisions");
    }
    choices.set(decision.pairToken, decision.choice);
  }
  const packetTokens = packetPairTokens(packet);
  if (
    packetTokens.some((token) => !choices.has(token))
    || review.revealedDecisions.some((decision) => (
      choices.get(decision.pairToken) !== decision.choice
    ))
  ) {
    throw new Error("Report unblinding data does not match the blind packet");
  }
}

export function renderPromptThreadBlindPacket(
  packet: BlindPacketArtifact,
): string {
  assertBlindPacketSafe(packet);
  const pairs = packet.pairs as unknown as PromptThreadBlindPair[];
  return pairs.flatMap((pair) => [
    `## ${pair.pairToken}`,
    "",
    "### A",
    ...renderConversation(pair.conversationA),
    "",
    "### B",
    ...renderConversation(pair.conversationB),
    "",
  ]).join("\n");
}

function renderConversation(turns: readonly BlindConversationTurn[]): string[] {
  return turns.flatMap((turn) => {
    const diagnostics = [
      turn.noReply ? "no-reply" : null,
      turn.gotoRoomId === null ? null : `goto-room=${turn.gotoRoomId}`,
      turn.gotoPlayerName === null ? null : `goto-player=${turn.gotoPlayerName}`,
      turn.coordinationReceipt === null
        ? null
        : `coordination=${JSON.stringify(turn.coordinationReceipt)}`,
      turn.evidenceReferences.length === 0
        ? null
        : `evidence=${turn.evidenceReferences.join(",")}`,
    ].filter((value): value is string => value !== null);
    return [
      `- Turn ${turn.turn}, ${turn.actor}: ${turn.message ?? "[NO_REPLY]"}`,
      ...(diagnostics.length > 0 ? [`  - ${diagnostics.join("; ")}`] : []),
    ];
  });
}

async function loadBlindBranches(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
): Promise<BlindConversationBranch[]> {
  const branches: BlindConversationBranch[] = [];
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const arm of ["baseline", "candidate"] as const) {
      const cells = manifest.cells
        .filter((cell) => cell.repetition === repetition && cell.arm === arm)
        .sort((left, right) => left.turn - right.turn);
      if (cells.length !== 4) throw new Error("Blind branch is incomplete");
      branches.push({
        repetition,
        arm,
        turns: await Promise.all(cells.map(
          (cell) => loadBlindTurn(workspace, manifest.runId, cell),
        )),
      });
    }
  }
  return branches;
}

async function loadBlindTurn(
  workspace: PrivateWorkspace,
  runId: string,
  cell: PromptThreadPanelCell,
): Promise<BlindConversationTurn> {
  const checkpoint = await readCheckpoint(workspace, runId, cell.cellId);
  const applied = record(checkpoint.privateState.applied, "applied checkpoint");
  const output = record(applied.output, "applied output");
  const selection = nullableRecord(
    checkpoint.privateState.selectionExplanation,
    "selection explanation",
  );
  const items = selection && Array.isArray(selection.items)
    ? selection.items.map((item) => record(item, "selection item"))
    : [];
  const coordination = nullableRecord(
    output.coordinationReceipt,
    "coordination receipt",
  );
  return {
    turn: cell.turn,
    actor: cell.actor,
    message: nullableString(output.message),
    noReply: output.noReply === true,
    gotoRoomId: nullableInteger(output.gotoRoomId),
    gotoPlayerName: nullableString(output.gotoPlayerName),
    coordinationReceipt: coordination
      ? JSON.parse(JSON.stringify(coordination)) as JsonObject
      : null,
    evidenceReferences: items
      .filter((item) => item.terminalReason === "selected_history")
      .map((item) => String(item.sourceId)),
  };
}

async function loadReportCells(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
  evidenceCard: PromptThreadEvidenceCard,
  caseValue: { privateData: JsonObject },
): Promise<PromptThreadReportCell[]> {
  const sourceIds = sourceIdBySequence(caseValue.privateData);
  const loaded = await Promise.all(manifest.cells.map(async (cell) => {
    const [checkpoint, provider, prepared] = await Promise.all([
      readCheckpoint(workspace, manifest.runId, cell.cellId),
      readArtifact(
        workspace,
        `runs/${manifest.runId}/cells/${cell.cellId}/provider-result.json`,
      ),
      readArtifact(
        workspace,
        `runs/${manifest.runId}/cells/${cell.cellId}/prepared-request.json`,
      ),
    ]);
    if (provider.kind !== "provider_result" || provider.status !== "completed") {
      throw new Error("Report requires a complete provider result for every cell");
    }
    if (prepared.kind !== "prepared_request") {
      throw new Error("Report requires a prepared request for every cell");
    }
    const privateResponse = record(provider.privateResponse, "private provider result");
    const response = record(privateResponse.response, "provider response");
    const receipt = record(privateResponse.receipt, "provider receipt");
    const usage = record(response.usage, "provider usage");
    const inputDetails = record(usage.input_tokens_details, "provider input token details");
    const outputDetails = nullableRecord(
      usage.output_tokens_details,
      "provider output token details",
    );
    const selection = reportSelection(checkpoint);
    const inputTokens = requiredNumber(usage.input_tokens, "input tokens");
    const cachedInputTokens = requiredNumber(
      inputDetails.cached_tokens,
      "cached input tokens",
    );
    const outputTokens = requiredNumber(usage.output_tokens, "output tokens");
    const estimate = estimateProviderUsageForSnapshot({
      modelSnapshot: manifest.modelSnapshot,
      serviceTier: manifest.requestedServiceTier,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    });
    if (
      estimate.status !== "estimated"
      || estimate.pricingSourceId !== manifest.pricingSourceId
      || estimate.rateCardVersion !== manifest.rateCardVersion
    ) {
      throw new Error("Report usage cannot be priced against the approved rate card");
    }
    const requestHash = requiredString(prepared.requestHash, "prepared request hash");
    if (
      provider.requestHash !== requestHash
      || receipt.requestDigest !== requestHash
    ) {
      throw new Error("Report request fingerprints do not match");
    }
    return {
      actorLineage: cell.actorLineage,
      requestCanonical: canonicalJson(prepared.privateRequest),
      reportCell: {
      cellId: cell.cellId,
      attemptOrdinal: cell.ordinal,
      arm: cell.arm,
      repetition: cell.repetition,
      turn: cell.turn,
      actorId: cell.actorId,
      firstCall: cell.firstCall,
      controlReturnTurn: cell.controlReturnTurn,
      responseStatus: "completed",
      requestHash,
      commonPrefixChars: 0,
      responseId: nullableString(receipt.responseId) ?? nullableString(response.id),
      requestId: nullableString(receipt.requestId),
      elapsedMs: requiredNumber(receipt.elapsedMs, "provider elapsed time"),
      requestedServiceTier: manifest.requestedServiceTier,
      effectiveServiceTier: requiredString(
        response.service_tier,
        "effective service tier",
      ),
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens: outputDetails
        ? requiredNumber(outputDetails.reasoning_tokens, "reasoning tokens")
        : 0,
      costUsd: estimate.estimatedCostUsd,
      costStatus: "estimated",
      selection: selection.summary,
      evidence: cell.arm === "control"
        ? []
        : evidenceForCell(
            selection.items,
            evidenceCard.items,
            cell.turn,
            sourceIds,
          ),
      } satisfies PromptThreadReportCell,
    };
  }));
  const previousRequestByLineage = new Map<string, string>();
  return loaded.map(({ actorLineage, requestCanonical, reportCell }) => {
    const previous = previousRequestByLineage.get(actorLineage);
    previousRequestByLineage.set(actorLineage, requestCanonical);
    return {
      ...reportCell,
      commonPrefixChars: previous
        ? commonPrefixLength(previous, requestCanonical)
        : 0,
    };
  });
}

function commonPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}

function evidenceForCell(
  selectionItems: readonly Record<string, unknown>[],
  citations: readonly PromptThreadEvidenceCitation[],
  turn: number,
  sourceIds: ReadonlyMap<string, string>,
): PromptThreadReportCell["evidence"] {
  const applicable = citations
    .filter((citation) => citation.applicableTurns.includes(turn));
  if (applicable.length === 0) return [];
  const reasonBySourceId = new Map<string, PromptThreadSelectionReason>();
  for (const item of selectionItems) {
    const sequenceSourceId = requiredString(item.sourceId, "selection source ID");
    const sequence = sequenceSourceId.split(":")[1];
    const sourceId = sequence ? sourceIds.get(sequence) : undefined;
    if (!sourceId) throw new Error("Selection explanation source is unavailable in the case");
    reasonBySourceId.set(
      sourceId,
      selectionReason(requiredString(item.terminalReason, "selection reason")),
    );
  }
  return applicable.map((citation) => {
      const reason = reasonBySourceId.get(citation.sourceId);
      if (!reason) {
        throw new Error(`Approved evidence ${citation.sourceId} is unavailable for turn ${turn}`);
      }
      return {
        sourceId: citation.sourceId,
        label: citation.classification,
        reason,
      };
    });
}

function reportSelection(
  checkpoint: ContinuationCheckpointArtifact,
): {
  items: Record<string, unknown>[];
  summary: PromptThreadReportCell["selection"];
} {
  const selection = record(
    checkpoint.privateState.selectionExplanation,
    "selection explanation",
  );
  if (!Array.isArray(selection.items)) {
    throw new Error("Selection explanation has no items");
  }
  const laneSummary = record(selection.laneSummary, "selection lane summary");
  const budget = record(selection.budget, "selection budget");
  return {
    items: selection.items.map((item) => record(item, "selection explanation item")),
    summary: {
      protectedCount: requiredNumber(laneSummary.protectedCount, "protected lane count"),
      hotCount: requiredNumber(laneSummary.hotCount, "hot lane count"),
      authorizedHistoryCount: requiredNumber(
        laneSummary.authorizedHistoryCount,
        "authorized history count",
      ),
      selectedHistoryCount: requiredNumber(
        laneSummary.selectedHistoryCount,
        "selected history count",
      ),
      envelopeChars: requiredNumber(budget.envelopeChars, "context envelope characters"),
      historyBudgetChars: requiredNumber(
        budget.historyBudgetChars,
        "history budget characters",
      ),
      protectedChars: requiredNumber(budget.protectedChars, "protected characters"),
      hotChars: requiredNumber(budget.hotChars, "hot characters"),
      historyChars: requiredNumber(budget.historyChars, "history characters"),
    },
  };
}

function sourceIdBySequence(privateData: JsonObject): Map<string, string> {
  const starting = record(privateData.startingState, "starting state");
  if (!Array.isArray(starting.historyCatalog)) {
    throw new Error("Case has no history catalog for report mapping");
  }
  const mapping = new Map<string, string>();
  for (const candidate of starting.historyCatalog) {
    const item = record(candidate, "history catalog item");
    if (item.sequence === null) continue;
    mapping.set(
      String(item.sequence),
      requiredString(item.sourceId, "history source ID"),
    );
  }
  return mapping;
}

function selectionReason(value: string): PromptThreadSelectionReason {
  if (value === "selected_history") return "selected";
  if (value === "history_disabled") return "policy_disabled";
  if (value === "seed_miss") return "zero_overlap";
  if (value === "budget_excluded") return "budget_exhausted";
  throw new Error(`Unsupported selection reason ${value}`);
}

async function assertCompletedRun(
  workspace: PrivateWorkspace,
  manifest: PromptThreadPanelManifest,
): Promise<void> {
  const inspection = await inspectRunRecovery(workspace, manifest.runId);
  const latest = new Map<string, string>();
  for (const transition of inspection.transitions) {
    latest.set(transition.cellId, transition.stage);
  }
  if (
    inspection.invalidReason
    || manifest.cells.length !== 28
    || manifest.cells.some((cell) => latest.get(cell.cellId) !== "completed")
  ) {
    throw new Error("Blind review requires a complete valid 28-cell panel");
  }
}

async function readCheckpoint(
  workspace: PrivateWorkspace,
  runId: string,
  cellId: string,
): Promise<ContinuationCheckpointArtifact> {
  const artifact = parseArtifact(await readArtifact(
    workspace,
    `runs/${runId}/cells/${cellId}/continuation-checkpoint.json`,
  ));
  if (artifact.kind !== "continuation_checkpoint") {
    throw new Error("Expected a continuation checkpoint");
  }
  return artifact;
}

function packetPairTokens(packet: BlindPacketArtifact): string[] {
  return (packet.pairs as unknown as PromptThreadBlindPair[])
    .map((pair) => pair.pairToken);
}

function requireBranch(
  branches: readonly BlindConversationBranch[],
  repetition: number,
  arm: "baseline" | "candidate",
): BlindConversationBranch {
  const matches = branches.filter(
    (branch) => branch.repetition === repetition && branch.arm === arm,
  );
  if (matches.length !== 1 || matches[0]!.turns.length !== 4) {
    throw new Error(`Blind review requires one complete ${arm} branch for pair ${repetition}`);
  }
  return matches[0]!;
}

function assertBlindPacketSafe(packet: BlindPacketArtifact): void {
  const forbiddenKeys = new Set([
    "arm",
    "commit",
    "revision",
    "model",
    "cache",
    "cost",
    "control",
    "thinking",
    "reasoningcontext",
    "provider",
    "inputtokens",
    "outputtokens",
    "cachedinputtokens",
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        throw new Error(`Blind packet contains forbidden metadata key: ${key}`);
      }
      visit(child);
    }
  };
  visit(packet);
}

function assertSingleDecision(
  artifact: ReturnType<typeof parseArtifact>,
  packet: BlindPacketArtifact,
  pairToken: string,
): { pairToken: string; choice: BlindChoice; reasons?: BlindDecisionReasons } {
  if (
    artifact.kind !== "blind_decisions"
    || artifact.packetHash !== hashCanonicalJson(packet)
    || !artifact.locked
    || artifact.decisions.length !== 1
  ) {
    throw new Error("Stored blind decision is invalid or stale");
  }
  const decision = record(artifact.decisions[0], "blind decision");
  if (decision.pairToken !== pairToken || !isBlindChoice(decision.choice)) {
    throw new Error("Stored blind decision has a foreign token or choice");
  }
  const reasons = nullableRecord(decision.reasons, "blind decision reasons");
  return {
    pairToken,
    choice: decision.choice,
    ...(reasons && { reasons: reasons as BlindDecisionReasons }),
  };
}

function parseMappings(
  key: UnblindingKeyArtifact,
): Map<string, PromptThreadBlindMapping> {
  const mappings = new Map<string, PromptThreadBlindMapping>();
  for (const candidate of key.mappings) {
    const mapping = record(candidate, "unblinding mapping");
    if (
      typeof mapping.pairToken !== "string"
      || !isArm(mapping.aArm)
      || !isArm(mapping.bArm)
      || mapping.aArm === mapping.bArm
      || typeof mapping.repetition !== "number"
    ) {
      throw new Error("Unblinding mapping is invalid");
    }
    mappings.set(mapping.pairToken, mapping as unknown as PromptThreadBlindMapping);
  }
  return mappings;
}

function decisionPath(runId: string, pairToken: string): string {
  if (!/^pair-[a-f0-9]{24}$/u.test(pairToken)) {
    throw new Error("Blind pair token is not path-safe");
  }
  return `runs/${runId}/blind-decisions/${pairToken}.json`;
}

function cleanReasons(reasons: BlindDecisionReasons): BlindDecisionReasons {
  return Object.fromEntries(
    Object.entries(reasons)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => [key, value!.trim()]),
  ) as BlindDecisionReasons;
}

function isBlindChoice(value: unknown): value is BlindChoice {
  return value === "A"
    || value === "B"
    || value === "no_preference"
    || value === "insufficient_evidence";
}

function isArm(value: unknown): value is "baseline" | "candidate" {
  return value === "baseline" || value === "candidate";
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nullableRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  return value === null || value === undefined ? null : record(value, label);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableInteger(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}
