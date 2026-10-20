import { createHash } from "node:crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { GameState, huddleSessionId, type DurableGameTurnSnapshotV1 } from "@influence/engine";
import { VISUAL_ROOMS, hasCompleteVisualHeads, type VisualRoomId } from "@influence/engine/visual-mode";
import { planVisualScene, sameVisualArrangement, type VisualCastMember } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { applyPublishedVisualScene, prepareVisualScene, type StoredVisualScene } from "./visual-scene-store.js";
import { visualExecutionBoundaryGuard } from "./visual-execution-boundary.js";
import { renderVisualSceneBestEffort } from "./visual-best-effort.js";

/** Presentation-only room selection. Never changes Mingle occupancy or participant knowledge. */
export async function prepareCommittedHuddleScene(db: DrizzleDB, input: {
  snapshot: DurableGameTurnSnapshotV1; frozenCast: readonly VisualCastMember[];
  backgrounds: Readonly<Partial<Record<VisualRoomId, string>>>; requireVisuals?: boolean;
}): Promise<StoredVisualScene | null> {
  const { execution, canonicalEvents } = input.snapshot;
  if (execution.cursor.kind !== "huddle_conversation") return null;
  const progress = execution.cursor.progress;
  if (!progress.conversation || progress.conversation.ended) return null;
  const state = GameState.fromCanonicalEvents(canonicalEvents);
  const schedule = state.getAllianceHuddleSchedules().find(s => s.id === progress.scheduleIds[progress.index]);
  if (!schedule || schedule.decision !== "scheduled") throw new Error("Missing accepted huddle participants");
  const ids = [...schedule.memberIds].sort();
  const cast = ids.map(id => {
    const member = input.frozenCast.find(m => m.id === id);
    if (!member || member.name !== state.getPlayerName(id)) throw new Error("Huddle visual cast is unavailable");
    return member;
  });
  const guard = visualExecutionBoundaryGuard(db, { gameId: execution.gameId, ownerEpoch: execution.ownerEpoch, heads: execution.heads, cursor: execution.cursor });
  await guard();
  const previous = await db.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, execution.gameId),
    lte(schema.visualScenes.boundarySequence, execution.heads.turnSequence))).orderBy(desc(schema.visualScenes.boundarySequence), schema.visualScenes.id);
  const binding = input.snapshot.transcriptEntries.find(entry => entry.scope === "huddle"
    && entry.dialogueContext?.sessionId === huddleSessionId(schedule.id)
    && entry.dialogueContext.visualScene)?.dialogueContext?.visualScene;
  if (binding) {
    const saved = previous.find(scene => scene.id === binding.id);
    if (!saved || JSON.stringify(saved.plan.cast.map(member => member.id).sort()) !== JSON.stringify(ids))
      throw new Error("Accepted huddle scene binding is unavailable or has different participants");
    const scene = await applyPublishedVisualScene(db, saved);
    await guard();
    if (input.requireVisuals && (!scene || !hasCompleteVisualHeads(scene, ids))) throw new Error("Required bound huddle imagery is unavailable");
    return scene;
  }
  for (const saved of previous) {
    if (!saved.roomId.startsWith("mingle-") || saved.afterDialogueSequence > execution.heads.dialogueSequence
      || JSON.stringify(saved.plan.cast.map(m => m.id).sort()) !== JSON.stringify(ids)) continue;
    const scene = await applyPublishedVisualScene(db, saved);
    if (!scene || scene.status !== "ready") continue;
    const plan = planVisualScene({ roomId: scene.plan.roomId, backgroundArtifactId: input.backgrounds[scene.plan.roomId] ?? null,
      cast, previous: scene.plan, allianceGroups: [ids], cues: scene.plan.cues });
    if (sameVisualArrangement(scene.plan, plan) && (!input.requireVisuals || hasCompleteVisualHeads(scene, ids))) {
      await guard(); return scene;
    }
  }
  const rooms = (Object.keys(VISUAL_ROOMS) as VisualRoomId[]).filter(id => id.startsWith("mingle-"));
  const available = rooms.filter(id => input.backgrounds[id]);
  const choices = available.length ? available : rooms;
  const roomId = choices[createHash("sha256").update(schedule.id).digest().readUInt32BE(0) % choices.length]!;
  const plan = planVisualScene({ roomId, backgroundArtifactId: input.backgrounds[roomId] ?? null, cast, allianceGroups: [ids] });
  const scene = await prepareVisualScene(db, { gameId: execution.gameId, boundarySequence: execution.heads.turnSequence,
    afterDialogueSequence: execution.heads.dialogueSequence, plan, assertBoundary: guard });
  const ready = await renderVisualSceneBestEffort(db, scene, guard, undefined, !input.requireVisuals);
  if (input.requireVisuals && (!ready || !hasCompleteVisualHeads(ready, ids))) throw new Error("Required huddle imagery is unavailable");
  await guard();
  return ready ?? null;
}
