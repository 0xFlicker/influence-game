import type { GameRunnerOptions } from "@influence/engine";
import { visualRoomForPhase, type AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { VisualCastMember } from "@influence/engine/visual-scene-plan";
import type { DrizzleDB } from "../db/index.js";
import { assertOwnerActive } from "./game-ownership.js";
import { readGameExecutionState } from "./game-turn-commit.js";
import { stableJson } from "./stable-hash.js";
import { readCurrentVisualScene, readVisualArtifact } from "./visual-scene-store.js";

const CONVERSATIONAL_METHODS = new Set([
  "getLobbyMessage", "sendRoomMessage", "takeMingleTurn", "getAccusation", "getDefense",
  "getOpeningStatement", "getJuryQuestion", "getJuryAnswer", "getClosingArgument", "getPlea",
]);

export class VisualTurnNotReady extends Error {
  constructor(readonly gameId: string, readonly roomId: string, message: string) {
    super(message);
    this.name = "VisualTurnNotReady";
  }
}

/** A scene boundary prepares images separately; this reader can never generate or charge. */
export function createVisualTurnContextReader(db: DrizzleDB, input: {
  gameId: string; ownerEpoch: string; frozenCast: readonly VisualCastMember[];
}): NonNullable<GameRunnerOptions["prepareVisualTurn"]> {
  const frozenCast = new Map(input.frozenCast.map((member) => [member.id, structuredClone(member)]));
  if (frozenCast.size !== input.frozenCast.length) throw new Error("Duplicate frozen visual profile");
  return async ({ context, method, committedHeads, committedCursor }) => {
    if (context.gameId !== input.gameId) throw new Error("Visual context belongs to another game");
    const self = frozenCast.get(context.selfId);
    if (!self) throw new Error("Missing frozen visual profile");
    const assertCurrentBoundary = async () => {
      await assertOwnerActive(db, input.gameId, input.ownerEpoch);
      const execution = await readGameExecutionState(db, input.gameId);
      if (!execution || execution.ownerEpoch !== input.ownerEpoch
        || stableJson(execution.heads) !== stableJson(committedHeads)
        || stableJson(execution.cursor) !== stableJson(committedCursor)) throw new Error("Visual context durable boundary changed");
    };
    await assertCurrentBoundary();
    const profile = { performanceInstructions: self.performanceInstructions };
    const roomId = CONVERSATIONAL_METHODS.has(method)
      ? visualRoomForPhase(context.phase, context.currentRoomId, context.endgameStage) : null;
    if (!roomId) return profile;
    let participantIds: string[];
    if (roomId.startsWith("mingle-")) {
      if (committedCursor.kind !== "mingle" || committedCursor.progress.phase !== context.phase
        || committedCursor.progress.currentBeat !== context.mingleBeat) {
        throw new VisualTurnNotReady(input.gameId, roomId, "Mingle movement must commit before preparing its scene");
      }
      const allocation = committedCursor.progress.currentAllocation;
      const room = allocation?.rooms.find((entry) => entry.roomId === context.currentRoomId);
      if (!room) throw new VisualTurnNotReady(input.gameId, roomId, "Mingle room has no committed assignment");
      participantIds = room.playerIds;
    } else {
      participantIds = [...new Set([...context.alivePlayers.map((player) => player.id), ...(roomId === "finals" ? (context.jury ?? []).map((member) => member.playerId) : [])])];
    }
    if (!participantIds.includes(context.selfId)) throw new Error("Visual actor is outside the room audience");
    const scene = await readCurrentVisualScene(db, input.gameId, roomId);
    if (!scene || scene.status !== "ready" || !scene.imageArtifactId || !scene.annotatedArtifactId || !scene.anchors
      || scene.boundarySequence > committedHeads.turnSequence) {
      throw new VisualTurnNotReady(input.gameId, roomId, "The current room scene is not ready");
    }
    if (stableJson([...participantIds].sort()) !== stableJson(scene.plan.cast.map((member) => member.id).sort())) {
      throw new VisualTurnNotReady(input.gameId, roomId, "The scene does not match the committed room occupants");
    }
    for (const member of scene.plan.cast) {
      if (stableJson(member) !== stableJson(frozenCast.get(member.id))) throw new Error("Scene contains a changed visual profile");
    }
    const [clean, annotated] = await Promise.all([
      readVisualArtifact(db, input.gameId, scene.imageArtifactId),
      readVisualArtifact(db, input.gameId, scene.annotatedArtifactId),
    ]);
    await assertCurrentBoundary();
    const accepted: AcceptedVisualScene = {
      id: scene.id, roomId, version: scene.boundarySequence,
      imageUrl: `data:image/png;base64,${clean.toString("base64")}`,
      annotatedImageUrl: `data:image/png;base64,${annotated.toString("base64")}`,
      participantIds, anchors: scene.anchors,
    };
    return { ...profile, room: { scene: accepted, cues: [] } };
  };
}
