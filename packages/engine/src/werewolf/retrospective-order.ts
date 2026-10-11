import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { seededRandom } from "../seeded-random";
import type { WerewolfState } from "./types";

/** Dedicated local RNG; never advances the gameplay opening ring or cursor. */
export function werewolfRetrospectiveSpeakerIds(state: WerewolfState): string[] {
  if (!state.retrospectiveOutcomeSource) throw new Error("Werewolf retrospective order requires its canonical outcome");
  const deaths = state.history.flatMap(entry => entry.kind === "night" && entry.result.killedId ? [entry.result.killedId]
    : entry.kind === "vote" && entry.result.eliminatedId ? [entry.result.eliminatedId] : []);
  const survivors = [...state.aliveIds];
  const draw = seededRandom(hashCanonicalJson({ purpose: "retrospective-survivors.v1", gameId: state.gameId,
    seed: state.seed, outcomeHash: state.retrospectiveOutcomeSource.eventHash }));
  for (let index = survivors.length - 1; index > 0; index--) {
    const other = Math.floor(draw() * (index + 1));
    [survivors[index], survivors[other]] = [survivors[other]!, survivors[index]!];
  }
  return [...deaths, ...survivors];
}
