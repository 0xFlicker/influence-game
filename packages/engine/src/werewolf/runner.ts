import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { seededRandom } from "../seeded-random";
import { ProviderUnavailableError } from "../provider-execution";
import { observeWerewolf, type WerewolfObservation } from "./observation";
import { nextWerewolfStep, replayWerewolf, validateWerewolfAction, werewolfActionPlans, werewolfEvent } from "./rules";
import type { WerewolfDecision, WerewolfEvent, WerewolfRequest, WerewolfState } from "./types";

export interface WerewolfAgent {
  decide(input: { gameId: string; actionSlot: number; request: WerewolfRequest; observation: WerewolfObservation; signal?: AbortSignal }): Promise<WerewolfDecision>;
}

export interface WerewolfStore {
  read(): Promise<WerewolfEvent[]>;
  /** Persist exact legal action and observation before requesting a model decision. */
  prepare?(state: WerewolfState, request: WerewolfRequest, sequence?: number): Promise<void>;
  /** Compare the committed sequence and current owner fence in the same transaction. */
  append(event: WerewolfEvent): Promise<void>;
}

export function werewolfFallback(state: WerewolfState, request: WerewolfRequest): WerewolfDecision {
  if (!request.legalTargetIds.length) return { kind: "speech", cue: null, text: null };
  const random = seededRandom(hashCanonicalJson({ seed: state.seed, purpose: "fallback", sequence: state.sequence + 1 }));
  const choices = [...request.legalTargetIds].sort();
  return { kind: "target", targetId: choices[Math.floor(random() * choices.length)]!, thinking: "" };
}

/** Concurrent pack ballots use one frozen observation. Private commitments recover separately;
 * the deterministic reveal publishes the complete batch as one public entry. */
export async function advanceWerewolf(store: WerewolfStore, agent: WerewolfAgent, signal?: AbortSignal): Promise<WerewolfState> {
  signal?.throwIfAborted();
  const state = replayWerewolf(await store.read());
  const step = nextWerewolfStep(state);
  if (step.kind === "complete") return state;
  if (step.kind === "action" && step.request.action === "attack") {
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
        if (!(error instanceof ProviderUnavailableError)) throw error;
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
      if (!(error instanceof ProviderUnavailableError)) throw error;
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
  while (!state.outcome) state = await advanceWerewolf(store, agent, signal);
  return state;
}
