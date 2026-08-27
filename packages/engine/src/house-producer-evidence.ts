import { createHash } from "node:crypto";
import type {
  HouseConfidence,
  HouseCoveredWindow,
  HouseEvidenceBundle,
  HouseGameplaySummaryContext,
  HouseGameplaySummaryResult,
  HouseProducerBrief,
  HouseProducerClaimKind,
  HouseProducerClaimSelection,
  HouseProducerDisclosure,
  HouseProducerFocusItem,
  HouseProducerFocusKind,
  HouseProducerHypothesis,
  HouseProducerHypothesisKind,
  HouseProducerHypothesisStatus,
  HouseProducerOpenQuestion,
  HouseProducerQuestionAngle,
  HouseProducerQuestionKind,
  HouseStrategyBiblePacket,
  HouseStrategyBibleUpdateContext,
  HouseStrategyBibleUpdateResult,
} from "./game-runner.types";
import {
  validateExactStructuredValue,
  type StructuredDomainDecodeResult,
} from "./structured-output";
import type { Phase, UUID } from "./types";

export type HouseProducerEvidenceAuthority =
  | "canonical_projection"
  | "accepted_speech"
  | "accepted_diary";

export type HouseProducerEvidencePrivacy = "viewer_safe" | "house_private";

export type HouseProducerEvidenceKind =
  | "roster_snapshot"
  | "round_snapshot"
  | "player_statement"
  | "diary_statement"
  | "room_assignment";

export interface HouseProducerEvidenceSource {
  /** Stable receipt handle derived from typed source identity; never positional. */
  alias: string;
  kind: HouseProducerEvidenceKind;
  authority: HouseProducerEvidenceAuthority;
  privacy: HouseProducerEvidencePrivacy;
  subjectPlayerIds: UUID[];
  relatedPlayerIds: UUID[];
  /** Engine-rendered bounded description. It is evidence display, never parsed. */
  summary: string;
}

export interface HouseProducerEvidenceFrontier {
  round: number;
  phase: Phase;
  canonicalHead: number;
  playerNamesById: ReadonlyMap<UUID, string>;
  catalog: Array<Omit<HouseProducerEvidenceSource, "summary"> & { summary: string }>;
  /** Runner-private typed snapshot used by validation and deterministic rendering. */
  sourceValuesByAlias: ReadonlyMap<string, HouseProducerEvidenceSource>;
}

export interface HouseDiaryProducerEvidenceInput {
  round: number;
  phase: Phase;
  canonicalHead: number;
  playerId: UUID;
  players: Array<{ id: UUID; name: string; status: "alive" | "eliminated" }>;
  recentMessages: Array<{ fromPlayerId: UUID; from: string; text: string; phase: Phase }>;
  previousDiaryEntries: Array<{ round: number; question: string; answer: string }>;
  playerMessages: Array<{ text: string; phase: Phase }>;
  roundSummary: string;
}

const HYPOTHESIS_KINDS = [
  "alliance_coordination",
  "alliance_fracture",
  "vote_coordination",
  "promise_or_commitment",
  "player_trajectory",
  "strategic_tension",
  "story_arc",
] as const satisfies readonly HouseProducerHypothesisKind[];

const HYPOTHESIS_STATUSES = [
  "emerging",
  "active",
  "weakening",
  "resolved",
  "retired",
] as const satisfies readonly HouseProducerHypothesisStatus[];

const CONFIDENCES = ["low", "medium", "high"] as const satisfies readonly HouseConfidence[];

const QUESTION_KINDS = [
  "trust_test",
  "coordination_test",
  "commitment_test",
  "conflict_test",
  "trajectory_test",
  "consequence_test",
] as const satisfies readonly HouseProducerQuestionKind[];

const FOCUS_KINDS = [
  "trust",
  "coordination",
  "commitment",
  "conflict",
  "trajectory",
  "consequence",
] as const satisfies readonly HouseProducerFocusKind[];

const DISCLOSURES = [
  "safe_to_reference",
  "private_only",
] as const satisfies readonly HouseProducerDisclosure[];

const CLAIM_KINDS = [
  "game_state",
  "round_outcome",
  "player_statement",
  "diary_statement",
  "room_assignment",
] as const satisfies readonly HouseProducerClaimKind[];

const PLAYER_ID_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  uniqueItems: true,
  items: { type: "string", minLength: 1 },
} as const;

const RELATED_PLAYER_ID_ARRAY_SCHEMA = {
  type: "array",
  maxItems: 8,
  uniqueItems: true,
  items: { type: "string", minLength: 1 },
} as const;

const SOURCE_ALIAS_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 40 },
} as const;

export const HOUSE_STRATEGY_BIBLE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...HYPOTHESIS_KINDS] },
          status: { type: "string", enum: [...HYPOTHESIS_STATUSES] },
          confidence: { type: "string", enum: [...CONFIDENCES] },
          subjectPlayerIds: PLAYER_ID_ARRAY_SCHEMA,
          relatedPlayerIds: RELATED_PLAYER_ID_ARRAY_SCHEMA,
          sourceAliases: SOURCE_ALIAS_ARRAY_SCHEMA,
        },
        required: ["kind", "status", "confidence", "subjectPlayerIds", "relatedPlayerIds", "sourceAliases"],
        additionalProperties: false,
      },
    },
    openQuestions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...QUESTION_KINDS] },
          subjectPlayerIds: PLAYER_ID_ARRAY_SCHEMA,
          relatedPlayerIds: RELATED_PLAYER_ID_ARRAY_SCHEMA,
          sourceAliases: SOURCE_ALIAS_ARRAY_SCHEMA,
        },
        required: ["kind", "subjectPlayerIds", "relatedPlayerIds", "sourceAliases"],
        additionalProperties: false,
      },
    },
    interpretation: { type: ["string", "null"], maxLength: 2_000 },
    thinking: { type: ["string", "null"], maxLength: 2_000 },
  },
  required: ["hypotheses", "openQuestions", "interpretation", "thinking"],
  additionalProperties: false,
};

export const HOUSE_LONG_FORM_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...CLAIM_KINDS] },
          sourceAlias: { type: "string", minLength: 1, maxLength: 40 },
        },
        required: ["kind", "sourceAlias"],
        additionalProperties: false,
      },
    },
    analysis: { type: ["string", "null"], maxLength: 2_000 },
    thinking: { type: ["string", "null"], maxLength: 2_000 },
  },
  required: ["claims", "analysis", "thinking"],
  additionalProperties: false,
};

export const HOUSE_PRODUCER_BRIEF_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    focusItems: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...FOCUS_KINDS] },
          subjectPlayerId: { type: "string", minLength: 1 },
          relatedPlayerIds: RELATED_PLAYER_ID_ARRAY_SCHEMA,
          sourceAliases: SOURCE_ALIAS_ARRAY_SCHEMA,
          confidence: { type: "string", enum: [...CONFIDENCES] },
          disclosure: { type: "string", enum: [...DISCLOSURES] },
        },
        required: ["kind", "subjectPlayerId", "relatedPlayerIds", "sourceAliases", "confidence", "disclosure"],
        additionalProperties: false,
      },
    },
    questionAngles: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...QUESTION_KINDS] },
          focusItemIds: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 20 },
          },
          subjectPlayerId: { type: "string", minLength: 1 },
          relatedPlayerIds: RELATED_PLAYER_ID_ARRAY_SCHEMA,
        },
        required: ["kind", "focusItemIds", "subjectPlayerId", "relatedPlayerIds"],
        additionalProperties: false,
      },
    },
    producerNote: { type: ["string", "null"], maxLength: 1_200 },
    thinking: { type: ["string", "null"], maxLength: 2_000 },
  },
  required: ["focusItems", "questionAngles", "producerNote", "thinking"],
  additionalProperties: false,
};

function bounded(value: string, max = 480): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function playerMaps(players: readonly { id: UUID; name: string }[]): {
  namesById: Map<UUID, string>;
  idsByName: Map<string, UUID>;
} {
  const namesById = new Map<UUID, string>();
  const idsByName = new Map<string, UUID>();
  for (const player of players) {
    if (!player.id || !player.name.trim() || namesById.has(player.id) || idsByName.has(player.name)) {
      throw new Error("House producer evidence requires a distinct typed player roster.");
    }
    namesById.set(player.id, player.name);
    idsByName.set(player.name, player.id);
  }
  return { namesById, idsByName };
}

function addSource(
  sources: HouseProducerEvidenceSource[],
  stableIdentity: unknown,
  value: Omit<HouseProducerEvidenceSource, "alias">,
): void {
  const digest = createHash("sha256")
    .update(JSON.stringify(stableIdentity))
    .digest("hex")
    .slice(0, 20);
  const alias = `P-${digest}`;
  const existing = sources.find((source) => source.alias === alias);
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify({ alias, ...value })) return;
    throw new Error(`House producer evidence receipt collision for ${alias}.`);
  }
  sources.push({ alias, ...value });
}

function roundSnapshotSummary(evidence: HouseEvidenceBundle): string {
  const facts = evidence.roundFacts;
  const outcome = facts.eliminatedName ?? facts.autoEliminatedName;
  const format = facts.selectedFormatName ?? facts.selectedFormatId;
  return bounded([
    `Round ${facts.round}`,
    facts.empoweredName ? `${facts.empoweredName} was empowered` : null,
    format ? `${format} was the locked format` : null,
    facts.councilCandidates ? `Council candidates were ${facts.councilCandidates.join(" and ")}` : null,
    outcome ? `${outcome} was eliminated` : null,
  ].filter((value): value is string => value !== null).join("; "));
}

export function compileHouseProducerEvidence(
  evidence: HouseEvidenceBundle,
): HouseProducerEvidenceFrontier {
  const { namesById, idsByName } = playerMaps(evidence.players);
  const sources: HouseProducerEvidenceSource[] = [];
  addSource(sources, {
    kind: "roster_snapshot",
    canonicalHead: evidence.canonicalHead,
    players: evidence.players.map((player) => ({ id: player.id, status: player.status })),
  }, {
    kind: "roster_snapshot",
    authority: "canonical_projection",
    privacy: "viewer_safe",
    subjectPlayerIds: evidence.players.map((player) => player.id),
    relatedPlayerIds: [],
    summary: bounded(`Alive: ${evidence.alivePlayers.join(", ") || "none"}. Eliminated: ${evidence.eliminatedPlayers.join(", ") || "none"}.`),
  });
  addSource(sources, {
    kind: "round_snapshot",
    canonicalHead: evidence.canonicalHead,
    round: evidence.roundFacts.round,
    facts: evidence.roundFacts,
  }, {
    kind: "round_snapshot",
    authority: "canonical_projection",
    privacy: "house_private",
    subjectPlayerIds: evidence.players.map((player) => player.id),
    relatedPlayerIds: [],
    summary: roundSnapshotSummary(evidence),
  });

  for (const entry of evidence.recentTranscript.slice(-24)) {
    if (entry.scope === "system" || entry.scope === "thinking" || entry.scope === "diary") continue;
    const speakerPlayerId = entry.speakerPlayerId;
    if (!speakerPlayerId || !namesById.has(speakerPlayerId) || !Number.isInteger(entry.entrySequence)) continue;
    addSource(sources, {
      kind: "player_statement",
      entrySequence: entry.entrySequence,
      speakerPlayerId,
    }, {
      kind: "player_statement",
      authority: "accepted_speech",
      privacy: entry.scope === "public" ? "viewer_safe" : "house_private",
      subjectPlayerIds: [speakerPlayerId],
      relatedPlayerIds: [],
      summary: bounded(`${namesById.get(speakerPlayerId)} said: “${entry.text}”`),
    });
  }

  for (const entry of evidence.recentDiaryEntries.slice(-12)) {
    if (!namesById.has(entry.agentId)) {
      throw new Error(`House producer diary evidence references unknown player ${entry.agentId}.`);
    }
    addSource(sources, {
      kind: "diary_statement",
      round: entry.round,
      precedingPhase: entry.precedingPhase,
      agentId: entry.agentId,
      question: entry.question,
      answer: entry.answer,
    }, {
      kind: "diary_statement",
      authority: "accepted_diary",
      privacy: "house_private",
      subjectPlayerIds: [entry.agentId],
      relatedPlayerIds: [],
      summary: bounded(`${entry.agentName} answered “${entry.answer}” after being asked “${entry.question}”`),
    });
  }

  for (const allocation of evidence.roomAllocations.slice(-8)) {
    const playerIds = allocation.rooms.flatMap((room) => room.players.map((name) => idsByName.get(name))).filter((id): id is UUID => id !== undefined);
    addSource(sources, {
      kind: "room_assignment",
      round: allocation.round,
      rooms: allocation.rooms.map((room) => ({
        roomId: room.roomId,
        playerIds: room.players.map((name) => idsByName.get(name) ?? name),
      })),
      excluded: allocation.excluded.map((name) => idsByName.get(name) ?? name),
    }, {
      kind: "room_assignment",
      authority: "canonical_projection",
      privacy: "house_private",
      subjectPlayerIds: [...new Set(playerIds)],
      relatedPlayerIds: [],
      summary: bounded(`Round ${allocation.round} rooms: ${allocation.rooms.map((room) => `Room ${room.roomId}: ${room.players.join(", ") || "empty"}`).join("; ")}`),
    });
  }

  return frontier(evidence.round, evidence.phase, evidence.canonicalHead, namesById, sources);
}

export function compileHouseDiaryProducerEvidence(
  input: HouseDiaryProducerEvidenceInput,
): HouseProducerEvidenceFrontier {
  const { namesById } = playerMaps(input.players);
  if (!namesById.has(input.playerId)) {
    throw new Error(`House producer brief references unknown interviewee ${input.playerId}.`);
  }
  const sources: HouseProducerEvidenceSource[] = [];
  addSource(sources, {
    kind: "roster_snapshot",
    canonicalHead: input.canonicalHead,
    round: input.round,
    phase: input.phase,
    intervieweeId: input.playerId,
    players: input.players.map((player) => ({ id: player.id, status: player.status })),
  }, {
    kind: "roster_snapshot",
    authority: "canonical_projection",
    privacy: "viewer_safe",
    subjectPlayerIds: input.players.map((player) => player.id),
    relatedPlayerIds: [],
    summary: bounded(`Round ${input.round} after ${input.phase}; interviewee ${namesById.get(input.playerId)}. ${input.roundSummary}`),
  });
  for (const message of input.recentMessages.slice(-8)) {
    if (!namesById.has(message.fromPlayerId)) {
      throw new Error(`House producer brief message references unknown player ${message.fromPlayerId}.`);
    }
    addSource(sources, {
      kind: "player_statement",
      fromPlayerId: message.fromPlayerId,
      phase: message.phase,
      text: message.text,
    }, {
      kind: "player_statement",
      authority: "accepted_speech",
      privacy: "viewer_safe",
      subjectPlayerIds: [message.fromPlayerId],
      relatedPlayerIds: [],
      summary: bounded(`${message.from} said: “${message.text}”`),
    });
  }
  for (const entry of input.previousDiaryEntries.slice(-4)) {
    addSource(sources, {
      kind: "diary_statement",
      playerId: input.playerId,
      round: entry.round,
      question: entry.question,
      answer: entry.answer,
    }, {
      kind: "diary_statement",
      authority: "accepted_diary",
      privacy: "house_private",
      subjectPlayerIds: [input.playerId],
      relatedPlayerIds: [],
      summary: bounded(`${namesById.get(input.playerId)} answered “${entry.answer}” after being asked “${entry.question}”`),
    });
  }
  for (const message of input.playerMessages.slice(-5)) {
    addSource(sources, {
      kind: "player_statement",
      fromPlayerId: input.playerId,
      phase: message.phase,
      text: message.text,
    }, {
      kind: "player_statement",
      authority: "accepted_speech",
      privacy: "viewer_safe",
      subjectPlayerIds: [input.playerId],
      relatedPlayerIds: [],
      summary: bounded(`${namesById.get(input.playerId)} said: “${message.text}”`),
    });
  }
  return frontier(input.round, input.phase, input.canonicalHead, namesById, sources);
}

function frontier(
  round: number,
  phase: Phase,
  canonicalHead: number,
  playerNamesById: Map<UUID, string>,
  sources: HouseProducerEvidenceSource[],
): HouseProducerEvidenceFrontier {
  const sourceValuesByAlias = new Map(sources.map((source) => [source.alias, source]));
  return {
    round,
    phase,
    canonicalHead,
    playerNamesById,
    catalog: sources.map((source) => ({ ...source })),
    sourceValuesByAlias,
  };
}

function record(value: unknown, label: string): StructuredDomainDecodeResult<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { status: "valid", value: value as Record<string, unknown> }
    : { status: "invalid", message: `${label} must be an object.` };
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

function distinctKnownPlayers(
  value: unknown,
  frontierValue: HouseProducerEvidenceFrontier,
  allowEmpty: boolean,
): UUID[] | null {
  const ids = stringArray(value);
  if (!ids || (!allowEmpty && ids.length === 0) || new Set(ids).size !== ids.length) return null;
  return ids.every((id) => frontierValue.playerNamesById.has(id)) ? ids : null;
}

function knownSources(
  value: unknown,
  frontierValue: HouseProducerEvidenceFrontier,
): HouseProducerEvidenceSource[] | null {
  const aliases = stringArray(value);
  if (!aliases || aliases.length === 0 || new Set(aliases).size !== aliases.length) return null;
  const sources = aliases.map((alias) => frontierValue.sourceValuesByAlias.get(alias));
  return sources.every((source) => source !== undefined)
    ? sources as HouseProducerEvidenceSource[]
    : null;
}

function supportsHypothesis(kind: HouseProducerHypothesisKind, sources: readonly HouseProducerEvidenceSource[]): boolean {
  if (kind === "vote_coordination") return sources.some((source) => source.kind === "round_snapshot");
  if (kind === "promise_or_commitment") return sources.some((source) => source.kind === "player_statement" || source.kind === "diary_statement");
  if (kind === "alliance_coordination" || kind === "alliance_fracture" || kind === "strategic_tension") {
    return sources.some((source) => source.kind === "player_statement" || source.kind === "diary_statement" || source.kind === "room_assignment");
  }
  return true;
}

function acceptedInterpretation(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bounded(value, 2_000) : undefined;
}

export function decodeHouseStrategyBibleProvider(
  value: unknown,
  context: HouseStrategyBibleUpdateContext,
  evidence: HouseProducerEvidenceFrontier,
): StructuredDomainDecodeResult<HouseStrategyBibleUpdateResult> {
  const decoded = record(value, "House Strategy Bible");
  if (decoded.status === "invalid") return decoded;
  const hypothesesInput = decoded.value.hypotheses;
  const questionsInput = decoded.value.openQuestions;
  if (!Array.isArray(hypothesesInput) || !Array.isArray(questionsInput)) {
    return { status: "invalid", message: "House Strategy Bible requires typed hypothesis and question arrays." };
  }
  const hypotheses: HouseProducerHypothesis[] = [];
  for (const [index, item] of hypothesesInput.entries()) {
    const decodedItem = record(item, "House hypothesis");
    if (decodedItem.status === "invalid") return decodedItem;
    const candidate = decodedItem.value;
    const subjects = distinctKnownPlayers(candidate.subjectPlayerIds, evidence, false);
    const related = distinctKnownPlayers(candidate.relatedPlayerIds, evidence, true);
    const sources = knownSources(candidate.sourceAliases, evidence);
    if (!HYPOTHESIS_KINDS.includes(candidate.kind as HouseProducerHypothesisKind) || !HYPOTHESIS_STATUSES.includes(candidate.status as HouseProducerHypothesisStatus) || !CONFIDENCES.includes(candidate.confidence as HouseConfidence) || !subjects || !related || !sources) {
      return { status: "invalid", message: "House hypothesis contains unknown identities, enums, or source receipts." };
    }
    if (subjects.some((id) => related.includes(id)) || !supportsHypothesis(candidate.kind as HouseProducerHypothesisKind, sources)) {
      return { status: "invalid", message: "House hypothesis source authority or player roles do not support its typed kind." };
    }
    hypotheses.push({
      id: `H${index + 1}`,
      kind: candidate.kind as HouseProducerHypothesisKind,
      status: candidate.status as HouseProducerHypothesisStatus,
      confidence: candidate.confidence as HouseConfidence,
      subjectPlayerIds: subjects,
      relatedPlayerIds: related,
      sourceAliases: sources.map((source) => source.alias),
    });
  }
  const openQuestions: HouseProducerOpenQuestion[] = [];
  for (const [index, item] of questionsInput.entries()) {
    const decodedItem = record(item, "House open question");
    if (decodedItem.status === "invalid") return decodedItem;
    const candidate = decodedItem.value;
    const subjects = distinctKnownPlayers(candidate.subjectPlayerIds, evidence, false);
    const related = distinctKnownPlayers(candidate.relatedPlayerIds, evidence, true);
    const sources = knownSources(candidate.sourceAliases, evidence);
    if (!QUESTION_KINDS.includes(candidate.kind as HouseProducerQuestionKind) || !subjects || !related || !sources || subjects.some((id) => related.includes(id))) {
      return { status: "invalid", message: "House open question contains unknown identities, kind, or source receipts." };
    }
    openQuestions.push({
      id: `Q${index + 1}`,
      kind: candidate.kind as HouseProducerQuestionKind,
      subjectPlayerIds: subjects,
      relatedPlayerIds: related,
      sourceAliases: sources.map((source) => source.alias),
    });
  }
  const packet: HouseStrategyBiblePacket = {
    revisionId: `house/v2:${evidence.canonicalHead}:${context.round}:${context.phase}`,
    previousRevisionId: context.previousPacket?.revisionId ?? null,
    updatedAtRound: context.round,
    updatedAtPhase: context.phase,
    coveredWindow: { ...context.coveredWindow },
    hypotheses,
    openQuestions,
    ...(acceptedInterpretation(decoded.value.interpretation) && { interpretation: acceptedInterpretation(decoded.value.interpretation) }),
  };
  return {
    status: "valid",
    value: {
      packet,
      ...(acceptedInterpretation(decoded.value.thinking) && { thinking: acceptedInterpretation(decoded.value.thinking) }),
    },
  };
}

function equalWindow(left: HouseCoveredWindow, right: HouseCoveredWindow): boolean {
  return left.fromRound === right.fromRound
    && left.toRound === right.toRound
    && left.fromPhase === right.fromPhase
    && left.toPhase === right.toPhase;
}

export function decodeAcceptedHouseStrategyBible(
  value: unknown,
  context: HouseStrategyBibleUpdateContext,
  evidence: HouseProducerEvidenceFrontier,
): StructuredDomainDecodeResult<HouseStrategyBibleUpdateResult> {
  const decoded = record(value, "Accepted House Strategy Bible result");
  if (decoded.status === "invalid") return decoded;
  if (!hasOnlyKeys(decoded.value, ["packet", "thinking"])) {
    return { status: "invalid", message: "Accepted House Strategy Bible result contains unsupported fields." };
  }
  const packetDecoded = record(decoded.value.packet, "Accepted House Strategy Bible packet");
  if (packetDecoded.status === "invalid") return packetDecoded;
  if (!hasOnlyKeys(packetDecoded.value, [
    "revisionId",
    "previousRevisionId",
    "updatedAtRound",
    "updatedAtPhase",
    "coveredWindow",
    "hypotheses",
    "openQuestions",
    "interpretation",
  ])) {
    return { status: "invalid", message: "Accepted House Strategy Bible packet contains unsupported fields." };
  }
  const packet = packetDecoded.value as unknown as HouseStrategyBiblePacket;
  if (
    packet.revisionId !== `house/v2:${evidence.canonicalHead}:${context.round}:${context.phase}`
    || packet.previousRevisionId !== (context.previousPacket?.revisionId ?? null)
    || packet.updatedAtRound !== context.round
    || packet.updatedAtPhase !== context.phase
    || !packet.coveredWindow
    || !equalWindow(packet.coveredWindow, context.coveredWindow)
  ) {
    return { status: "invalid", message: "Accepted House Strategy Bible revision or covered window does not match the current boundary." };
  }
  const providerShape = {
    hypotheses: Array.isArray(packet.hypotheses)
      ? packet.hypotheses.map(({ id: _id, ...hypothesis }) => hypothesis)
      : packet.hypotheses,
    openQuestions: Array.isArray(packet.openQuestions)
      ? packet.openQuestions.map(({ id: _id, ...question }) => question)
      : packet.openQuestions,
    interpretation: packet.interpretation ?? null,
    thinking: decoded.value.thinking ?? null,
  };
  const exact = validateExactStructuredValue(
    HOUSE_STRATEGY_BIBLE_SCHEMA,
    providerShape,
    "Accepted House Strategy Bible provider projection",
  );
  if (exact.status === "invalid") return exact;
  const replayed = decodeHouseStrategyBibleProvider(providerShape, context, evidence);
  if (replayed.status === "invalid") return replayed;
  return JSON.stringify(replayed.value.packet) === JSON.stringify(packet)
    ? { status: "valid", value: { ...replayed.value, ...(typeof decoded.value.thinking === "string" && { thinking: decoded.value.thinking }) } }
    : { status: "invalid", message: "Accepted House Strategy Bible domain value is not canonical." };
}

function claimMatchesSource(kind: HouseProducerClaimKind, source: HouseProducerEvidenceSource): boolean {
  return (kind === "game_state" && source.kind === "roster_snapshot")
    || (kind === "round_outcome" && source.kind === "round_snapshot")
    || (kind === "player_statement" && source.kind === "player_statement")
    || (kind === "diary_statement" && source.kind === "diary_statement")
    || (kind === "room_assignment" && source.kind === "room_assignment");
}

export function renderHouseProducerClaims(
  claims: readonly HouseProducerClaimSelection[],
  evidence: HouseProducerEvidenceFrontier,
): string {
  return claims.map((claim) => evidence.sourceValuesByAlias.get(claim.sourceAlias)?.summary ?? "").filter(Boolean).join(" ");
}

export function decodeHouseLongFormProvider(
  value: unknown,
  context: HouseGameplaySummaryContext,
  evidence: HouseProducerEvidenceFrontier,
): StructuredDomainDecodeResult<HouseGameplaySummaryResult> {
  const decoded = record(value, "House long-form summary");
  if (decoded.status === "invalid") return decoded;
  if (!Array.isArray(decoded.value.claims)) {
    return { status: "invalid", message: "House long-form summary requires typed claims." };
  }
  const claims: HouseProducerClaimSelection[] = [];
  const seenAliases = new Set<string>();
  for (const item of decoded.value.claims) {
    const decodedItem = record(item, "House long-form claim");
    if (decodedItem.status === "invalid") return decodedItem;
    const kind = decodedItem.value.kind as HouseProducerClaimKind;
    const alias = decodedItem.value.sourceAlias;
    const source = typeof alias === "string" ? evidence.sourceValuesByAlias.get(alias) : undefined;
    if (!CLAIM_KINDS.includes(kind) || !source || !claimMatchesSource(kind, source) || seenAliases.has(alias as string)) {
      return { status: "invalid", message: "House long-form claim has a stale, duplicated, or authority-mismatched receipt." };
    }
    seenAliases.add(alias as string);
    claims.push({ kind, sourceAlias: alias as string });
  }
  return {
    status: "valid",
    value: {
      summary: renderHouseProducerClaims(claims, evidence),
      kind: context.kind,
      packetRevisionId: context.packet?.revisionId ?? null,
      coveredWindow: { ...context.coveredWindow },
      claims,
      ...(acceptedInterpretation(decoded.value.analysis) && { analysis: acceptedInterpretation(decoded.value.analysis) }),
      ...(acceptedInterpretation(decoded.value.thinking) && { thinking: acceptedInterpretation(decoded.value.thinking) }),
    },
  };
}

export function decodeAcceptedHouseLongForm(
  value: unknown,
  context: HouseGameplaySummaryContext,
  evidence: HouseProducerEvidenceFrontier,
): StructuredDomainDecodeResult<HouseGameplaySummaryResult> {
  const decoded = record(value, "Accepted House long-form summary");
  if (decoded.status === "invalid") return decoded;
  if (!hasOnlyKeys(decoded.value, [
    "summary",
    "kind",
    "packetRevisionId",
    "coveredWindow",
    "claims",
    "analysis",
    "thinking",
  ])) {
    return { status: "invalid", message: "Accepted House long-form summary contains unsupported fields." };
  }
  if (decoded.value.kind !== context.kind || decoded.value.packetRevisionId !== (context.packet?.revisionId ?? null) || !decoded.value.coveredWindow || !equalWindow(decoded.value.coveredWindow as HouseCoveredWindow, context.coveredWindow)) {
    return { status: "invalid", message: "Accepted House long-form boundary does not match the current context." };
  }
  const providerShape = {
    claims: decoded.value.claims,
    analysis: decoded.value.analysis ?? null,
    thinking: decoded.value.thinking ?? null,
  };
  const exact = validateExactStructuredValue(
    HOUSE_LONG_FORM_SUMMARY_SCHEMA,
    providerShape,
    "Accepted House long-form provider projection",
  );
  if (exact.status === "invalid") return exact;
  const replayed = decodeHouseLongFormProvider(providerShape, context, evidence);
  if (replayed.status === "invalid") return replayed;
  return replayed.value.summary === decoded.value.summary
    ? replayed
    : { status: "invalid", message: "Accepted House long-form rendering is not canonical." };
}

function supportsFocus(kind: HouseProducerFocusKind, sources: readonly HouseProducerEvidenceSource[]): boolean {
  if (kind === "coordination") return sources.some((source) => source.kind === "player_statement" || source.kind === "diary_statement" || source.kind === "room_assignment");
  if (kind === "commitment") return sources.some((source) => source.kind === "player_statement" || source.kind === "diary_statement");
  if (kind === "consequence") return sources.some((source) => source.kind === "roster_snapshot" || source.kind === "round_snapshot");
  return true;
}

export function decodeHouseProducerBriefProvider(
  value: unknown,
  playerId: UUID,
  playerName: string,
  packetRevisionId: string | null,
  evidence: HouseProducerEvidenceFrontier,
): StructuredDomainDecodeResult<HouseProducerBrief> {
  const decoded = record(value, "House producer brief");
  if (decoded.status === "invalid") return decoded;
  if (!Array.isArray(decoded.value.focusItems) || !Array.isArray(decoded.value.questionAngles)) {
    return { status: "invalid", message: "House producer brief requires typed focus and question-angle arrays." };
  }
  const focusItems: HouseProducerFocusItem[] = [];
  for (const [index, item] of decoded.value.focusItems.entries()) {
    const decodedItem = record(item, "House producer focus item");
    if (decodedItem.status === "invalid") return decodedItem;
    const candidate = decodedItem.value;
    const related = distinctKnownPlayers(candidate.relatedPlayerIds, evidence, true);
    const sources = knownSources(candidate.sourceAliases, evidence);
    const subjectPlayerId = candidate.subjectPlayerId;
    const disclosure = candidate.disclosure as HouseProducerDisclosure;
    const kind = candidate.kind as HouseProducerFocusKind;
    if (!FOCUS_KINDS.includes(kind) || subjectPlayerId !== playerId || !related || !sources || related.includes(subjectPlayerId) || !CONFIDENCES.includes(candidate.confidence as HouseConfidence) || !DISCLOSURES.includes(disclosure) || !supportsFocus(kind, sources)) {
      return { status: "invalid", message: "House producer focus item contains unsupported identity, authority, or enum values." };
    }
    if (disclosure === "safe_to_reference" && sources.some((source) => source.privacy !== "viewer_safe")) {
      return { status: "invalid", message: "Safe-to-reference producer focus may not cite private evidence." };
    }
    focusItems.push({
      id: `F${index + 1}`,
      kind,
      subjectPlayerId,
      relatedPlayerIds: related,
      sourceAliases: sources.map((source) => source.alias),
      confidence: candidate.confidence as HouseConfidence,
      disclosure,
    });
  }
  const focusById = new Map(focusItems.map((item) => [item.id, item]));
  const questionAngles: HouseProducerQuestionAngle[] = [];
  for (const item of decoded.value.questionAngles) {
    const decodedItem = record(item, "House producer question angle");
    if (decodedItem.status === "invalid") return decodedItem;
    const candidate = decodedItem.value;
    const focusItemIds = stringArray(candidate.focusItemIds);
    const related = distinctKnownPlayers(candidate.relatedPlayerIds, evidence, true);
    const subjectPlayerId = candidate.subjectPlayerId;
    const selectedFocus = focusItemIds?.map((id) => focusById.get(id));
    const focusPlayerIds = new Set(selectedFocus?.flatMap((focus) =>
      focus ? [focus.subjectPlayerId, ...focus.relatedPlayerIds] : [],
    ));
    if (!QUESTION_KINDS.includes(candidate.kind as HouseProducerQuestionKind) || !focusItemIds || focusItemIds.length === 0 || !selectedFocus?.every((focus) => focus?.disclosure === "safe_to_reference") || subjectPlayerId !== playerId || !related || related.includes(subjectPlayerId) || related.some((id) => !focusPlayerIds.has(id))) {
      return { status: "invalid", message: "House producer question angle must reference known viewer-safe focus items and players." };
    }
    questionAngles.push({
      kind: candidate.kind as HouseProducerQuestionKind,
      focusItemIds,
      subjectPlayerId,
      relatedPlayerIds: related,
    });
  }
  return {
    status: "valid",
    value: {
      playerName,
      playerId,
      packetRevisionId,
      focusItems,
      questionAngles,
      ...(acceptedInterpretation(decoded.value.producerNote) && { producerNote: acceptedInterpretation(decoded.value.producerNote) }),
      ...(acceptedInterpretation(decoded.value.thinking) && { thinking: acceptedInterpretation(decoded.value.thinking) }),
    },
  };
}

export function decodeAcceptedHouseProducerBrief(
  value: unknown,
  playerId: UUID,
  playerName: string,
  packetRevisionId: string | null,
  evidence: HouseProducerEvidenceFrontier,
): StructuredDomainDecodeResult<HouseProducerBrief> {
  const decoded = record(value, "Accepted House producer brief");
  if (decoded.status === "invalid") return decoded;
  if (!hasOnlyKeys(decoded.value, [
    "playerName",
    "playerId",
    "packetRevisionId",
    "focusItems",
    "questionAngles",
    "producerNote",
    "thinking",
  ])) {
    return { status: "invalid", message: "Accepted House producer brief contains unsupported fields." };
  }
  if (decoded.value.playerId !== playerId || decoded.value.playerName !== playerName || decoded.value.packetRevisionId !== packetRevisionId) {
    return { status: "invalid", message: "Accepted House producer brief identity or packet revision is stale." };
  }
  const providerShape = {
    focusItems: Array.isArray(decoded.value.focusItems)
      ? decoded.value.focusItems.map(({ id: _id, ...item }) => item)
      : decoded.value.focusItems,
    questionAngles: decoded.value.questionAngles,
    producerNote: decoded.value.producerNote ?? null,
    thinking: decoded.value.thinking ?? null,
  };
  const exact = validateExactStructuredValue(
    HOUSE_PRODUCER_BRIEF_SCHEMA,
    providerShape,
    "Accepted House producer brief provider projection",
  );
  if (exact.status === "invalid") return exact;
  const replayed = decodeHouseProducerBriefProvider(providerShape, playerId, playerName, packetRevisionId, evidence);
  if (replayed.status === "invalid") return replayed;
  return JSON.stringify(replayed.value) === JSON.stringify(decoded.value)
    ? replayed
    : { status: "invalid", message: "Accepted House producer brief domain value is not canonical." };
}

export function deterministicHouseLongFormFallback(
  context: HouseGameplaySummaryContext,
  evidence: HouseProducerEvidenceFrontier,
  providerKind?: string,
): HouseGameplaySummaryResult {
  const first = evidence.catalog.find((source) => source.kind === "roster_snapshot")
    ?? evidence.catalog[0];
  const claims: HouseProducerClaimSelection[] = first
    ? [{ kind: first.kind === "round_snapshot" ? "round_outcome" : "game_state", sourceAlias: first.alias }]
    : [];
  return {
    summary: renderHouseProducerClaims(claims, evidence),
    kind: context.kind,
    packetRevisionId: context.packet?.revisionId ?? null,
    coveredWindow: { ...context.coveredWindow },
    claims,
    ...(providerKind && {
      fallback: { source: "engine" as const, reason: "provider_exhausted" as const, providerKind },
    }),
  };
}

export function deterministicHouseProducerBriefFallback(
  playerId: UUID,
  playerName: string,
  packetRevisionId: string | null,
  providerKind: string,
): HouseProducerBrief {
  return {
    playerId,
    playerName,
    packetRevisionId,
    focusItems: [],
    questionAngles: [],
    fallback: { source: "engine", reason: "provider_exhausted", providerKind },
  };
}

export function renderHouseProducerQuestionAngles(
  brief: HouseProducerBrief,
  playerNamesById: ReadonlyMap<UUID, string>,
): string[] {
  return brief.questionAngles.map((angle) => {
    const subject = playerNamesById.get(angle.subjectPlayerId) ?? angle.subjectPlayerId;
    const related = angle.relatedPlayerIds.map((id) => playerNamesById.get(id) ?? id);
    const relation = related.length > 0 ? ` with ${related.join(", ")}` : "";
    switch (angle.kind) {
      case "trust_test": return `Probe ${subject}'s trust${relation}.`;
      case "coordination_test": return `Probe whether ${subject}'s coordination${relation} held.`;
      case "commitment_test": return `Probe a commitment involving ${subject}${relation}.`;
      case "conflict_test": return `Probe conflict involving ${subject}${relation}.`;
      case "trajectory_test": return `Probe how ${subject}'s position${relation} is changing.`;
      case "consequence_test": return `Probe what the latest canonical consequence changes for ${subject}${relation}.`;
    }
  });
}
