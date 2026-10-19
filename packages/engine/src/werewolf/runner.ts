import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { seededRandom } from "../seeded-random";
import { ProviderUnavailableError, providerLogicalCallId } from "../provider-execution";
import { materializeRetrospectiveContext, type RetrospectiveSpeakerContext, type RetrospectiveCapacityPolicy } from "../retrospective-context";
import { assertRetrospectiveInputBinding, retrospectiveCompletionProof, type RetrospectiveInputV1, type RetrospectiveSpeechV1 } from "../retrospective";
import { compileWerewolfRetrospective, freezeWerewolfRetrospective } from "./retrospective";
import { throwRetrospectiveFailure } from "../retrospective-failure";
import { observeWerewolf, type WerewolfObservation } from "./observation";
import { nextWerewolfStep, replayWerewolf, validateWerewolfAction, werewolfActionPlans, werewolfEvent } from "./rules";
import type { WerewolfDecision, WerewolfEvent, WerewolfRequest, WerewolfState } from "./types";

export interface WerewolfAgent {
  prepareRetrospectiveCapacity(signal?: AbortSignal): Promise<RetrospectiveCapacityPolicy>;
  getRetrospectiveStatement(input: { gameId: string; actionSlot: number; day: number; context: RetrospectiveSpeakerContext; signal?: AbortSignal }): Promise<RetrospectiveSpeechV1>;
  decide(input: { gameId: string; actionSlot: number; request: WerewolfRequest; observation: WerewolfObservation; signal?: AbortSignal }): Promise<WerewolfDecision>;
}

export interface WerewolfStore {
  read(): Promise<WerewolfEvent[]>;
  /** Persist exact legal action and observation before requesting a model decision. */
  prepare?(state: WerewolfState, request: WerewolfRequest, sequence?: number): Promise<void>;
  /** Compare the committed sequence and current owner fence in the same transaction. */
  append(event: WerewolfEvent, retrospectiveInput?: RetrospectiveInputV1): Promise<void>;
  readRetrospectiveInput?(): Promise<RetrospectiveInputV1 | null>;
  prepareRetrospective?(state: WerewolfState, context: RetrospectiveSpeakerContext): Promise<void>;
}

export function werewolfExecutionFinished(state: WerewolfState): boolean {
  return state.outcome !== null && (state.config.rulesVersion === 7
    || state.retrospective !== null && state.retrospective.completedAtEventSequence !== null);
}

/** Dedicated post-outcome stage; no gameplay request, observation or fallback. */
async function advanceRetrospective(store: WerewolfStore, agent: WerewolfAgent, events: WerewolfEvent[], state: WerewolfState, signal?: AbortSignal) {
  if (!state.retrospective) {
    const frozen = await (async () => freezeWerewolfRetrospective({ events, capacities: await agent.prepareRetrospectiveCapacity(signal) }))()
      .catch(error => throwRetrospectiveFailure(error, "initialize", signal));
    signal?.throwIfAborted();
    await store.append(werewolfEvent(state, { type: "werewolf.retrospective_started", payload: frozen.definition }), frozen.input);
  } else if (state.retrospective.statements.length === state.retrospective.definition.speakerIds.length) {
    await store.append(werewolfEvent(state, { type: "werewolf.retrospective_completed", payload: retrospectiveCompletionProof(state.retrospective) }));
  } else {
    const source = compileWerewolfRetrospective(events);
    const input = store.readRetrospectiveInput ? await store.readRetrospectiveInput() : source.input;
    if (!input) throw new Error("Werewolf retrospective has no frozen input");
    assertRetrospectiveInputBinding(input, state.retrospective.definition);
    const context = materializeRetrospectiveContext({ input, definition: state.retrospective.definition, speakers: source.speakers }, state.retrospective);
    await store.prepareRetrospective?.(state, context);
    signal?.throwIfAborted();
    const speech = await agent.getRetrospectiveStatement({ gameId: state.gameId, day: state.day, actionSlot: state.sequence + 1, context, signal })
      .catch(error => throwRetrospectiveFailure(error, "statement", signal));
    signal?.throwIfAborted();
    await store.append(werewolfEvent(state, { type: "werewolf.retrospective_statement_recorded", payload: {
      version: 1, definitionHash: context.request.definitionHash, actorId: context.self.id, ordinal: context.request.ordinal,
      priorStatementsHash: context.request.priorStatementsHash, requestHash: hashCanonicalJson(context.request), speech: speech.speech,
      providerLogicalCallId: providerLogicalCallId(state.gameId, { actor: { id: context.self.id, name: context.self.name, role: "player" },
        action: "retrospective-statement", round: state.day, semantic: { version: 1, kind: "werewolf_action", eventSequence: state.sequence + 1 } }),
    } }));
  }
  return replayWerewolf(await store.read());
}

export function werewolfFallback(state: WerewolfState, request: WerewolfRequest): WerewolfDecision {
  if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
  if (request.action === "vote") return { kind: "target", targetId: null, thinking: "" };
  if (!request.legalTargetIds.length) return { kind: "speech", cue: null, text: null };
  const random = seededRandom(hashCanonicalJson({ seed: state.seed, purpose: "fallback", sequence: state.sequence + 1 }));
  const choices = [...request.legalTargetIds].sort();
  return { kind: "target", targetId: choices[Math.floor(random() * choices.length)]!, thinking: "" };
}

/** Concurrent sealed ballots use one frozen observation. Private commitments recover separately;
 * the deterministic reveal publishes the complete batch as one public entry. */
export async function advanceWerewolf(store: WerewolfStore, agent: WerewolfAgent, signal?: AbortSignal): Promise<WerewolfState> {
  signal?.throwIfAborted();
  const events = await store.read();
  const state = replayWerewolf(events);
  if (werewolfExecutionFinished(state)) return state;
  if (state.outcome) return advanceRetrospective(store, agent, events, state, signal);
  const step = nextWerewolfStep(state);
  if (step.kind === "complete") return state;
  if (step.kind === "action" && (step.request.action === "attack" || step.request.action === "vote")) {
    const plans = werewolfActionPlans(state);
    for (const plan of plans) await store.prepare?.(state, plan.request, plan.sequence);
    signal?.throwIfAborted();
    // Drain every dispatched call before returning on failure; accepted provider
    // results remain journaled for recovery even when this batch cannot commit.
    const decisions = await Promise.allSettled(plans.map(async ({ request, sequence }) => {
      let decision: WerewolfDecision;
      let fallback: "provider_unavailable" | null = null;
      try {
        decision = await agent.decide({ gameId: state.gameId, actionSlot: sequence,
          request, observation: observeWerewolf(state, request.actorId), signal });
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof ProviderUnavailableError) || error.outcome.kind === "circuit_open") throw error;
        decision = werewolfFallback({ ...state, sequence: sequence - 1 }, request);
        fallback = "provider_unavailable";
      }
      const action = { ...request, decision, fallback };
      validateWerewolfAction(request, action);
      return action;
    }));
    signal?.throwIfAborted();
    let committed = state;
    // Validate the whole batch before appending any new commitment.
    for (const decision of decisions) if (decision.status === "rejected") throw decision.reason;
    for (const decision of decisions) {
      if (decision.status !== "fulfilled") throw new Error("Unsettled Werewolf batch decision");
      signal?.throwIfAborted();
      const event = werewolfEvent(committed, { type: "werewolf.action_accepted", payload: decision.value });
      await store.append(event);
      committed = replayWerewolf(await store.read());
    }
    return committed;
  }
  let event: WerewolfEvent;
  if (step.kind === "event") {
    event = werewolfEvent(state, step.event);
  } else {
    await store.prepare?.(state, step.request);
    let decision: WerewolfDecision;
    let fallback: "provider_unavailable" | null = null;
    try {
      decision = await agent.decide({ gameId: state.gameId, actionSlot: state.sequence + 1,
        request: step.request, observation: observeWerewolf(state, step.request.actorId), signal });
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof ProviderUnavailableError) || error.outcome.kind === "circuit_open") throw error;
      decision = werewolfFallback(state, step.request);
      fallback = "provider_unavailable";
    }
    event = werewolfEvent(state, { type: "werewolf.action_accepted", payload: { ...step.request, decision, fallback } });
  }
  signal?.throwIfAborted();
  await store.append(event);
  return replayWerewolf(await store.read());
}

export async function runWerewolf(store: WerewolfStore, agent: WerewolfAgent, signal?: AbortSignal): Promise<WerewolfState> {
  let state = replayWerewolf(await store.read());
  while (!werewolfExecutionFinished(state)) state = await advanceWerewolf(store, agent, signal);
  return state;
}
