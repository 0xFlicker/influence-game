import { Phase, replayCanonicalEvents } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";

/** The full validated event head, rather than an outcome or caller result, seals execution. */
export async function assertInfluenceRetrospectiveCompletion(db: Pick<DrizzleDB, "select">, gameId: string, finalSequence: number) {
  const persisted = await getPersistedGameEvents(db, gameId);
  if (persisted.status !== "complete" || persisted.lastTrustedSequence !== finalSequence) throw new Error("Retrospective completion requires the complete committed event head");
  const projection = replayCanonicalEvents(persisted.events.map(event => event.envelope));
  if (!projection.retrospectiveOutcomeSource || !projection.retrospective
    || projection.retrospective.completedAtEventSequence === null || projection.phase !== Phase.END) {
    throw new Error("Retrospective completion requires every original contestant's accepted statement and the final END boundary");
  }
  return projection;
}
