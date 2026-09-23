import { recordVisualOperationEvent } from "./visual-diagnostics.js";
import { computeMingleRoomCount, mingleWindowRooms, GameState, type CanonicalGameEvent, type DurableGameTurnSnapshotV1 } from "@influence/engine";
import { and, eq, inArray } from "drizzle-orm";
import { mingleVisualRoom, type VisualRoomId } from "@influence/engine/visual-mode";
import { sameVisualArrangement, planVisualScene, type VisualCastMember } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { visualExecutionBoundaryGuard } from "./visual-execution-boundary.js";
import { renderVisualSceneBestEffort } from "./visual-best-effort.js";
import { prepareVisualScene, readCurrentVisualScene, type StoredVisualScene } from "./visual-scene-store.js";

/** Prepare all rooms from an accepted allocation, never from proposed agent movement. */
export async function prepareCommittedMingleScenes(db: DrizzleDB, input: {
  snapshot: DurableGameTurnSnapshotV1;
  frozenCast: readonly VisualCastMember[];
  backgrounds: Readonly<Partial<Record<VisualRoomId, string>>>;
  signal?: AbortSignal;
  requireVisuals?: boolean;
}): Promise<StoredVisualScene[]> {
  const { execution, canonicalEvents } = structuredClone(input.snapshot);
  if (execution.cursor.kind !== "mingle") return [];
  const window = execution.cursor.progress.window;
  if (!window || window.nextBeat > window.beats) return [];
  const rooms = mingleWindowRooms(window);
  const state = GameState.fromCanonicalEvents(canonicalEvents);
  if (state.gameId !== execution.gameId) throw new Error("Mingle visual roster belongs to another game");
  const alive = state.getAlivePlayerIds();
  const expectedRoomCount = computeMingleRoomCount(alive.length);
  const roomIds = rooms.map((room) => room.roomId).sort((a, b) => a - b);
  const occupants = rooms.flatMap((room) => room.playerIds);
  if (!expectedRoomCount || roomIds.length !== expectedRoomCount
    || roomIds.some((id, index) => id !== index + 1)
    || new Set(occupants).size !== occupants.length
    || occupants.length !== alive.length || occupants.some((id) => !alive.includes(id))
    || Object.keys(window.roomByPlayerId).length !== alive.length
    || rooms.some((room) => room.playerIds.some((id) => window.roomByPlayerId[id] !== room.roomId))) {
    throw new Error("Mingle scene allocation does not match canonical participants and positions");
  }
  const cast = new Map(input.frozenCast.map((member) => [member.id, structuredClone(member)]));
  if (cast.size !== input.frozenCast.length) throw new Error("Duplicate frozen visual profile");
  const backgrounds = { ...input.backgrounds };
  // Validate the entire batch before reserving or paying for any room.
  for (const id of alive) {
    const member = cast.get(id);
    if (!member || member.name !== state.getPlayerName(id) || !member.referenceArtifactId.trim()) throw new Error("Missing or mismatched frozen Mingle profile");
  }
  const assertBoundary = visualExecutionBoundaryGuard(db, {
    gameId: execution.gameId, ownerEpoch: execution.ownerEpoch, heads: execution.heads, cursor: execution.cursor,
  });
  await assertBoundary();
  const artifactIds = [...new Set([
    ...alive.map((id) => cast.get(id)!.referenceArtifactId),
    ...roomIds.flatMap((id) => backgrounds[mingleVisualRoom(id)] ? [backgrounds[mingleVisualRoom(id)]!] : []),
  ])];
  const artifacts = await db.select({ id: schema.visualArtifacts.id }).from(schema.visualArtifacts)
    .where(and(eq(schema.visualArtifacts.gameId, execution.gameId), inArray(schema.visualArtifacts.id, artifactIds)));
  if (artifacts.length !== artifactIds.length) throw new Error("Mingle batch references unavailable frozen artifacts");
  const result: StoredVisualScene[] = [];
  for (const room of [...rooms].sort((a, b) => a.roomId - b.roomId)) {
    input.signal?.throwIfAborted();
    await assertBoundary();
    const roomId = mingleVisualRoom(room.roomId);
    const previous = await readCurrentVisualScene(db, execution.gameId, roomId);
    const plan = planVisualScene({ roomId, backgroundArtifactId: backgrounds[roomId] ?? null,
      cast: room.playerIds.map((id) => cast.get(id)!), previous: previous?.plan,
      allianceGroups: state.getHuddleEligibleAlliances().map((alliance) => alliance.memberIds),
      cues: canonicalEvents.filter((event): event is Extract<CanonicalGameEvent, { type: "visual.cue_recorded" }> => event.type === "visual.cue_recorded" && event.payload.sceneId === previous?.id)
        .map((event) => ({ playerId: event.payload.playerId, cue: event.payload.cue })),
    });
    if (previous?.status === "ready" && sameVisualArrangement(previous.plan, plan)) {
      if (input.requireVisuals && previous.anchors?.length !== plan.cast.length) throw new Error("Required Mingle annotations are unavailable");
      result.push(previous); continue;
    }
    if (!plan.cast.length && !plan.backgroundArtifactId) continue;
    const scene = await prepareVisualScene(db, { gameId: execution.gameId, boundarySequence: execution.heads.turnSequence, afterDialogueSequence: execution.heads.dialogueSequence, plan, assertBoundary });
    const accepted = await renderVisualSceneBestEffort(db, scene, assertBoundary);
    if (input.requireVisuals && (!accepted || accepted.anchors?.length !== plan.cast.length)) throw new Error(`Required imagery for ${roomId} is unavailable`);
    if (!accepted) await recordVisualOperationEvent(db, execution.gameId, `${scene.id}:boundary:${execution.heads.turnSequence}:portraits`, { sceneId: scene.id, boundarySequence: execution.heads.turnSequence, kind: "presentation", outcome: "portraits", message: `Best effort: ${roomId} uses portraits and text context` });
    if (accepted) result.push(accepted);
  }
  await assertBoundary();
  return result;
}
