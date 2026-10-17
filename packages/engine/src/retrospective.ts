import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { RETROSPECTIVE_MAX_SPEECH_CHARACTERS } from "./retrospective-budget";
export { RETROSPECTIVE_MAX_SPEECH_CHARACTERS } from "./retrospective-budget";
import { MAX_NEW_GAME_PLAYERS } from "./types";
import {
  createExactStructuredOutputArtifact,
  validateExactStructuredValue,
  type StructuredDomainDecodeResult,
} from "./structured-output";

export const RETROSPECTIVE_CONTRACT_VERSION = 1 as const;
export const RETROSPECTIVE_PROMPT_VERSION = "retrospective.v1" as const;

/** Exact canonical outcome event, distinct from the eventual final event head. */
export interface RetrospectiveOutcomeSource {
  gameId: string;
  gameKind: "influence" | "werewolf";
  eventSequence: number;
  eventHash: string;
}

/** Private, immutable input. Facts and quoted, untrusted dialogue stay separate. */
export interface RetrospectiveInputV1 {
  version: 1;
  outcome: RetrospectiveOutcomeSource;
  sections: Array<{
    phase: string;
    fromEventSequence: number;
    throughEventSequence: number;
    summary: string;
  }>;
  dialogue: Array<{
    /** Canonical event or owning-turn boundary anchoring this quote in the account. */
    eventSequence: number;
    source: { kind: "canonical_event" | "transcript_entry"; sequence: number };
    actorId: string;
    scope: "public" | "mingle" | "huddle" | "whisper" | "pack" | "alliance";
    /** null means the source does not disclose the original audience. */
    audiencePlayerIds: string[] | null;
    text: string;
  }>;
}

export interface RetrospectiveDefinitionV1 {
  version: 1;
  promptVersion: typeof RETROSPECTIVE_PROMPT_VERSION;
  outcome: RetrospectiveOutcomeSource;
  inputHash: string;
  speakerIds: string[];
  definitionHash: string;
}

export interface RetrospectiveStatementReferenceV1 {
  eventSequence: number;
  ordinal: number;
  actorId: string;
  speechHash: string;
}

/** Prepared before dispatch; actor/order/context never come from model prose. */
export interface RetrospectiveRequestV1 {
  version: 1;
  gameId: string;
  definitionHash: string;
  inputHash: string;
  actorId: string;
  ordinal: number;
  priorStatements: RetrospectiveStatementReferenceV1[];
  priorStatementsHash: string;
}

export interface RetrospectiveSpeechV1 { speech: string }

export interface RetrospectiveStatementV1 extends RetrospectiveSpeechV1 {
  version: 1;
  definitionHash: string;
  actorId: string;
  ordinal: number;
  priorStatementsHash: string;
  requestHash: string;
  providerLogicalCallId: string;
}

export interface RetrospectiveCompletionV1 {
  version: 1;
  definitionHash: string;
  statementCount: number;
  statementsHash: string;
}

export type RetrospectiveRecordV1 =
  | { kind: "started"; payload: RetrospectiveDefinitionV1 }
  | { kind: "statement"; payload: RetrospectiveStatementV1 }
  | { kind: "completed"; payload: RetrospectiveCompletionV1 };

/** A projection of canonical records, never a second mutable speech store. */
export interface RetrospectiveStateV1 {
  definition: RetrospectiveDefinitionV1;
  startedAtEventSequence: number;
  statements: Array<RetrospectiveStatementV1 & { eventSequence: number }>;
  completedAtEventSequence: number | null;
}

const id = { type: "string", minLength: 1, pattern: "\\S" };
const hash = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const sequence = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const ordinal = { type: "integer", minimum: 0, maximum: MAX_NEW_GAME_PLAYERS - 1 };
// No `pattern` keyword: some provider routers (Katana/xAI) fail or drop
// strict tool calls carrying it. Nonblank speech is enforced semantically
// in decodeSpeech, which runs for both live payloads and accepted replay.
const speech = { type: "string", minLength: 1, maxLength: RETROSPECTIVE_MAX_SPEECH_CHARACTERS };
const version = { const: RETROSPECTIVE_CONTRACT_VERSION };

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const outcomeSchema = objectSchema({
  gameId: id, gameKind: { enum: ["influence", "werewolf"] }, eventSequence: sequence, eventHash: hash,
});
const definitionSchema = objectSchema({
  version, promptVersion: { const: RETROSPECTIVE_PROMPT_VERSION }, outcome: outcomeSchema,
  inputHash: hash, speakerIds: { type: "array", minItems: 1, maxItems: MAX_NEW_GAME_PLAYERS, uniqueItems: true, items: id },
  definitionHash: hash,
});
const statementSchema = objectSchema({
  version, definitionHash: hash, actorId: id, ordinal, priorStatementsHash: hash,
  requestHash: hash, providerLogicalCallId: id, speech,
});
const completionSchema = objectSchema({
  version, definitionHash: hash, statementCount: { type: "integer", minimum: 1, maximum: MAX_NEW_GAME_PLAYERS },
  statementsHash: hash,
});
const referenceSchema = objectSchema({ eventSequence: sequence, ordinal, actorId: id, speechHash: hash });
const requestSchema = objectSchema({
  version, gameId: id, definitionHash: hash, inputHash: hash, actorId: id, ordinal,
  priorStatements: { type: "array", maxItems: MAX_NEW_GAME_PLAYERS - 1, items: referenceSchema }, priorStatementsHash: hash,
});
const inputSchema = objectSchema({
  version, outcome: outcomeSchema,
  sections: { type: "array", minItems: 1, items: objectSchema({
    phase: id, fromEventSequence: sequence, throughEventSequence: sequence, summary: id,
  }) },
  dialogue: { type: "array", items: objectSchema({ eventSequence: sequence,
    source: objectSchema({ kind: { enum: ["canonical_event", "transcript_entry"] }, sequence }), actorId: id,
    scope: { enum: ["public", "mingle", "huddle", "whisper", "pack", "alliance"] },
    audiencePlayerIds: { anyOf: [{ type: "null" }, { type: "array", uniqueItems: true, items: id }] }, text: id }) },
});

export class RetrospectiveContractError extends Error {
  constructor(message: string) { super(message); this.name = "RetrospectiveContractError"; }
}

function assertShape<T>(schema: Readonly<Record<string, unknown>>, value: unknown, label: string): asserts value is T {
  const result = validateExactStructuredValue(schema, value, label);
  if (result.status === "invalid") throw new RetrospectiveContractError(result.message);
}

export function assertRetrospectiveInput(value: unknown): asserts value is RetrospectiveInputV1 {
  assertShape<RetrospectiveInputV1>(inputSchema, value, "Retrospective input");
  let next = 1;
  for (const section of value.sections) {
    if (section.fromEventSequence !== next || section.throughEventSequence < next) {
      throw new RetrospectiveContractError("Retrospective coverage must be contiguous from the first event");
    }
    next = section.throughEventSequence + 1;
  }
  if (next !== value.outcome.eventSequence + 1 || value.dialogue.some(entry => entry.eventSequence > value.outcome.eventSequence
    || entry.source.kind === "canonical_event" && entry.source.sequence !== entry.eventSequence)) {
    throw new RetrospectiveContractError("Retrospective input must cover exactly the original outcome prefix");
  }
}

export function assertRetrospectiveDefinition(value: unknown): asserts value is RetrospectiveDefinitionV1 {
  assertShape<RetrospectiveDefinitionV1>(definitionSchema, value, "Retrospective definition");
  const { definitionHash, ...body } = value;
  if (definitionHash !== hashCanonicalJson(body)) throw new RetrospectiveContractError("Retrospective definition hash does not match its frozen inputs/order");
}

export function createRetrospectiveDefinition(input: RetrospectiveInputV1, speakerIds: readonly string[]): RetrospectiveDefinitionV1 {
  assertRetrospectiveInput(input);
  const body = { version: RETROSPECTIVE_CONTRACT_VERSION, promptVersion: RETROSPECTIVE_PROMPT_VERSION,
    outcome: structuredClone(input.outcome), inputHash: hashCanonicalJson(input), speakerIds: [...speakerIds] };
  const definition = { ...body, definitionHash: hashCanonicalJson(body) };
  assertRetrospectiveDefinition(definition);
  return definition;
}

export function assertRetrospectiveInputBinding(input: unknown, definition: RetrospectiveDefinitionV1): asserts input is RetrospectiveInputV1 {
  assertRetrospectiveInput(input);
  assertRetrospectiveDefinition(definition);
  if (hashCanonicalJson(input) !== definition.inputHash || hashCanonicalJson(input.outcome) !== hashCanonicalJson(definition.outcome)) {
    throw new RetrospectiveContractError("Retrospective input does not match the frozen definition");
  }
}

export function assertRetrospectiveRecordPayload(kind: RetrospectiveRecordV1["kind"], value: unknown): void {
  if (kind === "started") assertRetrospectiveDefinition(value);
  else if (kind === "statement") {
    assertShape<RetrospectiveStatementV1>(statementSchema, value, "Retrospective statement");
    if (!/\S/.test(value.speech)) throw new RetrospectiveContractError("Retrospective speech must not be blank");
  }
  else assertShape<RetrospectiveCompletionV1>(completionSchema, value, "Retrospective completion");
}

export function assertRetrospectiveRequest(value: unknown): asserts value is RetrospectiveRequestV1 {
  assertShape<RetrospectiveRequestV1>(requestSchema, value, "Retrospective request");
  if (value.ordinal !== value.priorStatements.length || value.priorStatements.some((prior, index) => prior.ordinal !== index)
    || new Set([...value.priorStatements.map(prior => prior.actorId), value.actorId]).size !== value.ordinal + 1
    || value.priorStatements.some((prior, index) => index > 0 && prior.eventSequence <= value.priorStatements[index - 1]!.eventSequence)
    || value.priorStatementsHash !== hashCanonicalJson(value.priorStatements)) {
    throw new RetrospectiveContractError("Retrospective request requires the exact ordered prior-statement prefix");
  }
}

function statementReferences(state: RetrospectiveStateV1): RetrospectiveStatementReferenceV1[] {
  return state.statements.map(({ eventSequence, ordinal, actorId, speech }) => ({
    eventSequence, ordinal, actorId, speechHash: hashCanonicalJson({ speech }),
  }));
}

export function prepareRetrospectiveRequest(state: RetrospectiveStateV1): RetrospectiveRequestV1 {
  const ordinal = state.statements.length;
  const actorId = state.definition.speakerIds[ordinal];
  if (state.completedAtEventSequence !== null || !actorId) throw new RetrospectiveContractError("Retrospective has no unfinished statement slot");
  const priorStatements = statementReferences(state);
  return { version: 1, gameId: state.definition.outcome.gameId, definitionHash: state.definition.definitionHash,
    inputHash: state.definition.inputHash, actorId, ordinal, priorStatements,
    priorStatementsHash: hashCanonicalJson(priorStatements) };
}

export function retrospectiveCompletionProof(state: RetrospectiveStateV1): RetrospectiveCompletionV1 {
  if (state.statements.length !== state.definition.speakerIds.length) throw new RetrospectiveContractError("Retrospective completion requires the whole original roster");
  return { version: 1, definitionHash: state.definition.definitionHash,
    statementCount: state.statements.length, statementsHash: hashCanonicalJson(statementReferences(state)) };
}

/** Game adapters provide outcome evidence and the original roster from their own authority. */
export function applyRetrospectiveRecord(
  previous: RetrospectiveStateV1 | null,
  record: RetrospectiveRecordV1,
  boundary: { outcome: RetrospectiveOutcomeSource | null; rosterIds: readonly string[]; eventSequence: number },
): RetrospectiveStateV1 {
  assertRetrospectiveRecordPayload(record.kind, record.payload);
  if (!boundary.outcome || !Number.isSafeInteger(boundary.eventSequence) || boundary.eventSequence <= boundary.outcome.eventSequence) {
    throw new RetrospectiveContractError("Retrospective records require an earlier canonical outcome");
  }
  if (record.kind === "started") {
    if (previous) throw new RetrospectiveContractError("Retrospective definition is already frozen");
    const { speakerIds, outcome } = record.payload;
    if (hashCanonicalJson(outcome) !== hashCanonicalJson(boundary.outcome)) throw new RetrospectiveContractError("Retrospective outcome source does not match canonical authority");
    if (new Set(boundary.rosterIds).size !== boundary.rosterIds.length || speakerIds.length !== boundary.rosterIds.length
      || speakerIds.some(actorId => !boundary.rosterIds.includes(actorId))) {
      throw new RetrospectiveContractError("Retrospective order must contain every original contestant exactly once");
    }
    return { definition: structuredClone(record.payload), startedAtEventSequence: boundary.eventSequence,
      statements: [], completedAtEventSequence: null };
  }
  if (!previous || previous.completedAtEventSequence !== null) throw new RetrospectiveContractError("Retrospective is not accepting further records");
  const lastSequence = previous.statements.at(-1)?.eventSequence ?? previous.startedAtEventSequence;
  if (boundary.eventSequence <= lastSequence) throw new RetrospectiveContractError("Retrospective event sequence must advance");
  if (hashCanonicalJson(boundary.outcome) !== hashCanonicalJson(previous.definition.outcome)
    || record.payload.definitionHash !== previous.definition.definitionHash) throw new RetrospectiveContractError("Retrospective frozen definition cannot change");
  if (record.kind === "statement") {
    const request = prepareRetrospectiveRequest(previous);
    if (record.payload.actorId !== request.actorId || record.payload.ordinal !== request.ordinal
      || record.payload.priorStatementsHash !== request.priorStatementsHash || record.payload.requestHash !== hashCanonicalJson(request)) {
      throw new RetrospectiveContractError("Retrospective statement does not match the next prepared slot/prefix");
    }
    if (previous.statements.some(statement => statement.providerLogicalCallId === record.payload.providerLogicalCallId)) {
      throw new RetrospectiveContractError("Retrospective provider acceptance cannot author two statements");
    }
    return { ...structuredClone(previous), statements: [...structuredClone(previous.statements), { ...structuredClone(record.payload), eventSequence: boundary.eventSequence }] };
  }
  if (hashCanonicalJson(record.payload) !== hashCanonicalJson(retrospectiveCompletionProof(previous))) {
    throw new RetrospectiveContractError("Retrospective completion proof does not match accepted statements");
  }
  return { ...structuredClone(previous), completedAtEventSequence: boundary.eventSequence };
}

function decodeSpeech(value: unknown): StructuredDomainDecodeResult<RetrospectiveSpeechV1> {
  const result = validateExactStructuredValue(speechSchema, value, "Retrospective speech");
  if (result.status === "invalid") return result;
  if (!/\S/.test((value as RetrospectiveSpeechV1).speech)) {
    return { status: "invalid", message: "Retrospective speech must not be blank" };
  }
  return { status: "valid", value: value as RetrospectiveSpeechV1 };
}

const speechSchema = objectSchema({ speech });
export const retrospectiveSpeechArtifact = createExactStructuredOutputArtifact<RetrospectiveSpeechV1, RetrospectiveSpeechV1>({
  action: "retrospective-statement", name: "submit_retrospective", schema: speechSchema,
  decodeProviderPayload: decodeSpeech, decodeAcceptedValue: decodeSpeech, acceptedValueUsesProviderSchema: true,
});
