import { canonicalJson, hashCanonicalJson } from "@influence/prompt-lab-protocol";
import {
  assertRetrospectiveInput, assertRetrospectiveInputBinding, assertRetrospectiveRequest, createRetrospectiveDefinition, prepareRetrospectiveRequest,
  RETROSPECTIVE_MAX_SPEECH_CHARACTERS, RetrospectiveContractError,
  retrospectiveSpeechArtifact,
  type RetrospectiveDefinitionV1, type RetrospectiveInputV1, type RetrospectiveRequestV1,
  type RetrospectiveStateV1,
} from "./retrospective";
import { assertWerewolfRetrospectivePerspective, type WerewolfRetrospectivePerspective } from "./werewolf/retrospective-perspective";
import { exactStructuredOutputRegistry } from "./structured-output";

/** Private game-setup snapshot. Never put the whole roster's strategies in a prompt. */
export interface RetrospectiveSpeaker {
  id: string;
  name: string;
  personality: string;
  backstory: string;
  strategy: string;
  werewolfPerspective?: WerewolfRetrospectivePerspective;
}

export interface FrozenRetrospectiveGame {
  input: RetrospectiveInputV1;
  definition: RetrospectiveDefinitionV1;
  speakers: RetrospectiveSpeaker[];
}

/** Advisory context budget for size observability, never admission or suspension.
 * Supply every effective primary/fallback model; no tokenizer count is claimed.
 */
export interface RetrospectiveModelCapacity {
  modelId: string;
  /** null means no reliable capacity estimate; never an admission gate. */
  maxContextBytes: number | null;
}

export interface RetrospectiveCapacityPolicy {
  /** From the sealed effective manifest, independently of advisory estimates. */
  effectiveModelIds: readonly string[];
  models: readonly RetrospectiveModelCapacity[];
}

export class RetrospectiveContextCapacityError extends RetrospectiveContractError {
  readonly reason = "capacity_unavailable" as const;
  constructor() {
    super("Retrospective requires a valid sealed runtime inventory");
    this.name = "RetrospectiveContextCapacityError";
  }
}

export interface RetrospectiveSpeakerContext {
  version: 1;
  request: RetrospectiveRequestV1;
  self: RetrospectiveSpeaker;
  game: RetrospectiveInputV1;
  priorStatements: Array<{ eventSequence: number; ordinal: number; actorId: string; speech: string }>;
}

/** The only model-facing roster object is self; copy by allowlist, not object spread. */
function speakerSnapshot(speaker: RetrospectiveSpeaker): RetrospectiveSpeaker {
  if ([speaker.id, speaker.name, speaker.personality].some(value => typeof value !== "string" || !value.trim())
    || typeof speaker.backstory !== "string" || typeof speaker.strategy !== "string") {
    throw new RetrospectiveContractError("Invalid frozen retrospective character");
  }
  if (speaker.werewolfPerspective !== undefined) assertWerewolfRetrospectivePerspective(speaker.werewolfPerspective);
  return { id: speaker.id, name: speaker.name, personality: speaker.personality,
    backstory: speaker.backstory, strategy: speaker.strategy,
    ...(speaker.werewolfPerspective === undefined ? {} : { werewolfPerspective: structuredClone(speaker.werewolfPerspective) }) };
}

export function freezeRetrospectiveGame(
  input: RetrospectiveInputV1, speakerIds: readonly string[], speakers: readonly RetrospectiveSpeaker[],
  previousDefinition: RetrospectiveDefinitionV1 | null,
  capacities: RetrospectiveCapacityPolicy,
): FrozenRetrospectiveGame {
  const definition = createRetrospectiveDefinition(input, speakerIds);
  if (previousDefinition && canonicalJson(previousDefinition) !== canonicalJson(definition)) {
    throw new RetrospectiveContractError("Retrospective source/order differs from the already frozen definition");
  }
  if (speakers.length !== speakerIds.length || new Set(speakers.map(speaker => speaker.id)).size !== speakers.length
    || speakerIds.some(id => !speakers.some(speaker => speaker.id === id))) {
    throw new RetrospectiveContractError("Frozen retrospective characters must match the original roster");
  }
  if (input.dialogue.some(quote => !speakerIds.includes(quote.actorId)
    || quote.audiencePlayerIds?.some(id => !speakerIds.includes(id)))) {
    throw new RetrospectiveContractError("Retrospective quote identity/audience is outside the original roster");
  }
  const frozen = { input: structuredClone(input), definition: structuredClone(previousDefinition ?? definition),
    speakers: speakers.map(speakerSnapshot) };
  preflightRetrospectiveContext(frozen, capacities);
  return frozen;
}

/** Bind the entire outcome account and exact accepted speech prefix to the next slot. */
export function materializeRetrospectiveContext(
  frozen: FrozenRetrospectiveGame, state: RetrospectiveStateV1,
): RetrospectiveSpeakerContext {
  assertRetrospectiveInputBinding(frozen.input, state.definition);
  if (state.definition.definitionHash !== frozen.definition.definitionHash) {
    throw new RetrospectiveContractError("Retrospective state belongs to a different frozen game");
  }
  const request = prepareRetrospectiveRequest(state);
  const speaker = frozen.speakers.find(speaker => speaker.id === request.actorId);
  if (!speaker) throw new RetrospectiveContractError("Retrospective speaker has no frozen character");
  return { version: 1, request, self: speakerSnapshot(speaker), game: structuredClone(frozen.input),
    priorStatements: state.statements.map(({ eventSequence, ordinal, actorId, speech }) => ({ eventSequence, ordinal, actorId, speech })) };
}

/** Canonical serialization is shared by capacity admission and the eventual invocation. */
export function serializeRetrospectiveContext(context: RetrospectiveSpeakerContext): string {
  return canonicalJson(context);
}

/** Recheck the model-facing request and exact predecessor text before dispatch. */
export function assertRetrospectiveSpeakerContext(context: RetrospectiveSpeakerContext): void {
  const exact = (value: unknown, keys: string[]) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
  if (!exact(context, ["version", "request", "self", "game", "priorStatements"])
    || !exact(context.self, ["id", "name", "personality", "backstory", "strategy", ...(context.self?.werewolfPerspective === undefined ? [] : ["werewolfPerspective"])])) {
    throw new RetrospectiveContractError("Invalid retrospective speaker context shape");
  }
  assertRetrospectiveRequest(context.request);
  assertRetrospectiveInput(context.game);
  speakerSnapshot(context.self);
  if (context.version !== 1
    || context.self.id !== context.request.actorId || context.game.outcome.gameId !== context.request.gameId
    || hashCanonicalJson(context.game) !== context.request.inputHash || !Array.isArray(context.priorStatements)) {
    throw new RetrospectiveContractError("Retrospective speaker context does not match its frozen request");
  }
  const references = context.priorStatements.map(statement => {
    if (!exact(statement, ["eventSequence", "ordinal", "actorId", "speech"])
      || statement.eventSequence <= context.game.outcome.eventSequence
      || exactStructuredOutputRegistry.decodeAcceptedValue(retrospectiveSpeechArtifact, { speech: statement.speech }).status !== "valid") {
      throw new RetrospectiveContractError("Invalid retrospective predecessor context");
    }
    const { eventSequence, ordinal, actorId, speech } = statement;
    return { eventSequence, ordinal, actorId, speechHash: hashCanonicalJson({ speech }) };
  });
  if (canonicalJson(references) !== canonicalJson(context.request.priorStatements)) {
    throw new RetrospectiveContractError("Retrospective predecessor speech differs from its accepted references");
  }
}

export function preflightRetrospectiveContext(
  frozen: FrozenRetrospectiveGame, policy: RetrospectiveCapacityPolicy,
): Array<{ modelId: string; actorId: string; requiredBytes: number; availableBytes: number | null }> {
  const capacities = policy.models;
  if (!policy.effectiveModelIds.length || policy.effectiveModelIds.some(id => typeof id !== "string" || !id.trim())
    || !capacities.length || capacities.some(capacity => typeof capacity.modelId !== "string" || !capacity.modelId.trim()
    || (capacity.maxContextBytes !== null && (!Number.isSafeInteger(capacity.maxContextBytes) || capacity.maxContextBytes < 1)))
    || new Set(capacities.map(capacity => capacity.modelId)).size !== capacities.length
    || policy.effectiveModelIds.some(id => !capacities.some(capacity => capacity.modelId === id))
    || capacities.some(capacity => !policy.effectiveModelIds.includes(capacity.modelId))) {
    throw new RetrospectiveContextCapacityError();
  }
  assertRetrospectiveInputBinding(frozen.input, frozen.definition);
  const receipts = [];
  for (const [ordinal, actorId] of frozen.definition.speakerIds.entries()) {
    const self = frozen.speakers.find(speaker => speaker.id === actorId);
    if (!self) throw new RetrospectiveContractError("Retrospective speaker has no frozen character");
    // Six JSON UTF-8 bytes per Unicode code point bounds even escaped controls.
    // Empty placeholders reserve metadata at the largest legal sequence width;
    // never tokenize repeated placeholder text and mistake it for a worst case.
    const priorStatements = frozen.definition.speakerIds.slice(0, ordinal).map((id, index) => ({
      eventSequence: Number.MAX_SAFE_INTEGER, ordinal: index, actorId: id, speech: "",
    }));
    const priorReferences = priorStatements.map(({ speech: _speech, ...reference }) => ({ ...reference, speechHash: hashCanonicalJson({ speech: "" }) }));
    const context: RetrospectiveSpeakerContext = { version: 1, self: speakerSnapshot(self), game: frozen.input, priorStatements,
      request: { version: 1, gameId: frozen.definition.outcome.gameId, definitionHash: frozen.definition.definitionHash,
        inputHash: frozen.definition.inputHash, actorId, ordinal, priorStatements: priorReferences,
        priorStatementsHash: hashCanonicalJson(priorReferences) } };
    const requiredBytes = new TextEncoder().encode(serializeRetrospectiveContext(context)).byteLength
      + ordinal * RETROSPECTIVE_MAX_SPEECH_CHARACTERS * 6;
    for (const capacity of capacities) {
      // Size is observability only. An estimated budget must never suspend play.
      receipts.push({ modelId: capacity.modelId, actorId, requiredBytes, availableBytes: capacity.maxContextBytes });
    }
  }
  return receipts;
}

/** Each canonical event has an explicit account entry, including quiet phases. */
export function appendRetrospectiveSection(
  sections: RetrospectiveInputV1["sections"], phase: string, sequence: number, summary: string,
): void {
  const previous = sections.at(-1);
  const line = `[event ${sequence}] ${summary}`;
  if (previous?.phase === phase) {
    previous.throughEventSequence = sequence;
    previous.summary += `\n${line}`;
  } else sections.push({ phase, fromEventSequence: sequence, throughEventSequence: sequence, summary: line });
}
