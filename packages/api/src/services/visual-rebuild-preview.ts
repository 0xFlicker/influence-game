import { eq } from "drizzle-orm";
import { GameState } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { planFinalsScene } from "./visual-finals-plan.js";
import { sha256StableJson } from "./stable-hash.js";

/** Read-only preview; the control transaction recomputes it before granting repair. */
export async function previewFinalsRebuild(db: Pick<DrizzleDB, "select">, gameId: string, sceneId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  const [execution] = await db.select().from(schema.gameExecutionStates).where(eq(schema.gameExecutionStates.gameId, gameId));
  const [scene] = await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.id, sceneId));
  const [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  if (!game || game.status !== "suspended" || !execution || !scene || scene.gameId !== gameId || !assets) throw new Error("Rebuild requires a suspended game with saved assets and a current scene");
  const pause = JSON.parse(game.config).visualPause;
  if (pause?.boundarySequence !== execution.committedTurnSequence || scene.boundarySequence !== execution.committedTurnSequence
    || scene.afterDialogueSequence !== execution.dialogueHeadSequence) throw new Error("Only an unused scene at the suspended boundary can be rebuilt");
  if (scene.roomId !== "finals" || !["judgment_opening", "judgment_jury_questions", "judgment_closing"].includes(String(execution.xstateSnapshot.value))) throw new Error("Canonical plan rebuild is available for the current Finals scene");
  const persisted = await getPersistedGameEvents(db, gameId);
  if (persisted.status !== "complete" || persisted.lastTrustedSequence !== execution.eventHeadSequence
    || persisted.persistedHead?.eventHash !== execution.eventHeadHash) throw new Error("Committed canonical evidence is unavailable for rebuilding");
  const events = persisted.events.map((entry) => entry.envelope);
  if (events.some((event) => event.type === "visual.cue_recorded" && event.payload.sceneId === scene.id)) throw new Error("A scene used by accepted dialogue cannot be rebuilt");
  const state = GameState.fromCanonicalEvents(events);
  const plan = planFinalsScene(state, assets.cast, assets.backgrounds.finals ?? null, scene);
  const expectedParticipants = plan.cast.map(({ id, name }) => ({ id, name }));
  const sceneParticipants = scene.plan.cast.map(({ id, name }) => ({ id, name }));
  const missingIds = expectedParticipants.filter((p) => !sceneParticipants.some((s) => s.id === p.id)).map((p) => p.id);
  const extraIds = sceneParticipants.filter((p) => !expectedParticipants.some((s) => s.id === p.id)).map((p) => p.id);
  return { sceneId, roomId: scene.roomId, boundarySequence: scene.boundarySequence, expectedRevision: scene.renderRevision,
    expectedParticipants, sceneParticipants, missingIds, extraIds, plan, planHash: sha256StableJson(plan),
    previewHash: sha256StableJson({ sceneId, revision: scene.renderRevision, heads: [execution.committedTurnSequence, execution.eventHeadHash, execution.dialogueHeadSequence], plan }),
  };
}
