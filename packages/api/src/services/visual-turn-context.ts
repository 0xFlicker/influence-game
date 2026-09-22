import { recordVisualOperationEvent, visualFailureEvidence } from "./visual-diagnostics.js";
import { and, eq, lte } from "drizzle-orm";
import { optionalPerformanceCue } from "@influence/engine/performance-cue";
import { schema } from "../db/index.js";
import { mingleWindowRooms, type GameRunnerOptions, type PhaseContext } from "@influence/engine";
import { assertVisualAnchors, visualRoomForPhase } from "@influence/engine/visual-mode";
import type { VisualCastMember } from "@influence/engine/visual-scene-plan";
import type { DrizzleDB } from "../db/index.js";
import { visualExecutionBoundaryGuard } from "./visual-execution-boundary.js";
import { stableJson } from "./stable-hash.js";
import { readCurrentVisualScene, readVisualArtifact } from "./visual-scene-store.js";

const CONVERSATIONAL_METHODS = new Set(["getLobbyMessage", "sendRoomMessage", "takeMingleTurn", "getAccusation", "getDefense", "getOpeningStatement", "getJuryQuestion", "getJuryAnswer", "getClosingArgument", "getPlea"]);

/** Explicit text-only context is always supported. This reader never generates or charges. */
export function createVisualTurnContextReader(db: DrizzleDB, input: {
  gameId: string; ownerEpoch: string; frozenCast: readonly VisualCastMember[];
}): NonNullable<GameRunnerOptions["prepareVisualTurn"]> {
  const frozenCast = new Map(input.frozenCast.map((member) => [member.id, structuredClone(member)]));
  if (frozenCast.size !== input.frozenCast.length) throw new Error("Duplicate frozen visual profile");
  return async ({ context, method, turnId, committedHeads, committedCursor }) => {
    if (context.gameId !== input.gameId) throw new Error("Visual context belongs to another game");
    let instructions = frozenCast.get(context.selfId)?.performanceInstructions;
    if (instructions === undefined) {
      const [player] = await db.select({ persona: schema.gamePlayers.persona }).from(schema.gamePlayers).where(and(eq(schema.gamePlayers.gameId, input.gameId), eq(schema.gamePlayers.id, context.selfId)));
      const profile = player ? JSON.parse(player.persona) as Record<string, unknown> : {};
      instructions = typeof profile.performanceInstructions === "string" ? profile.performanceInstructions : "";
    }
    const result: NonNullable<PhaseContext["visual"]> = { performanceInstructions: instructions };
    const roomId = CONVERSATIONAL_METHODS.has(method) ? visualRoomForPhase(context.phase, context.currentRoomId, context.endgameStage) : null;
    if (!roomId) return result;
    let participantIds: string[];
    if (roomId.startsWith("mingle-")) {
      if (committedCursor.kind !== "mingle" || committedCursor.progress.window?.phase !== context.phase || committedCursor.progress.window?.nextBeat !== context.mingleBeat) return result;
      const room = mingleWindowRooms(committedCursor.progress.window).find((entry) => entry.roomId === context.currentRoomId);
      if (!room) return result;
      participantIds = room.playerIds;
    } else participantIds = [...new Set([...context.alivePlayers.map((player) => player.id), ...(roomId === "finals" ? (context.jury ?? []).map((member) => member.playerId) : [])])];
    if (!participantIds.includes(context.selfId)) return result;
    const scene = await readCurrentVisualScene(db, input.gameId, roomId);
    const matches = scene && scene.boundarySequence <= committedHeads.turnSequence && stableJson([...participantIds].sort()) === stableJson(scene.plan.cast.map((member) => member.id).sort());
    const arrangementKey = matches ? scene.id : `${context.round}:${context.phase}:${roomId}:${[...participantIds].sort().join(",")}`;
    const rows = await db.select({ envelope: schema.gameEvents.envelope }).from(schema.gameEvents)
      .where(and(eq(schema.gameEvents.gameId, input.gameId), eq(schema.gameEvents.eventType, "visual.cue_recorded"), lte(schema.gameEvents.sequence, committedHeads.eventSequence))).orderBy(schema.gameEvents.sequence);
    const latest = new Map<string, import("@influence/engine/visual-mode").PerformanceCue>();
    for (const { envelope } of rows) {
      if (envelope.type !== "visual.cue_recorded") continue;
      const payload = envelope.payload as Extract<import("@influence/engine").CanonicalGameEvent, { type: "visual.cue_recorded" }>["payload"];
      const cue = optionalPerformanceCue(payload.cue);
      if (cue !== null && cue !== undefined && payload.roomId === roomId && payload.arrangementKey === arrangementKey && participantIds.includes(payload.playerId)) latest.set(payload.playerId, cue);
    }
    result.observableRoom = { roomId, arrangementKey, participantIds, cues: [...latest].map(([playerId, cue]) => ({ playerId, cue })) };
    if (!matches || scene.status !== "ready" || !scene.imageArtifactId || !scene.annotatedArtifactId || !scene.anchors) return result;
    const assertCurrent = visualExecutionBoundaryGuard(db, { gameId: input.gameId, ownerEpoch: input.ownerEpoch, heads: committedHeads, cursor: committedCursor });
    try {
      await assertCurrent();
      for (const member of scene.plan.cast) if (stableJson(member) !== stableJson(frozenCast.get(member.id))) return result;
      result.presentationScene = { id: scene.id, roomId };
      // Verified composition can be displayed without anchors, but agents get text only.
      assertVisualAnchors(scene.anchors, participantIds);
      const annotated = await readVisualArtifact(db, input.gameId, scene.annotatedArtifactId);
      await assertCurrent();
      result.room = { scene: { id: scene.id, roomId, version: scene.boundarySequence, imageUrl: "", annotatedImageUrl: `data:image/png;base64,${annotated.toString("base64")}`, participantIds, anchors: scene.anchors },
        cues: result.observableRoom.cues.map((entry) => ({ ...entry, sceneId: scene.id, turnId: "observable" })) };
    } catch (error) { await recordVisualOperationEvent(db, input.gameId, `context:${turnId}:${context.selfId}`, { sceneId: scene.id, boundarySequence: committedHeads.turnSequence, kind: "failure", outcome: "failed", message: "Verified imagery could not be loaded into agent context" }, visualFailureEvidence(error, "internal")); }
    return result;
  };
}
