import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { recordVisualOperationEvent, readVisualOperationEvents, visualFailureEvidence } from "./visual-diagnostics.js";
import { visualFailurePolicy, VisualPreparationBlocked } from "./visual-policy.js";
import { GameState, selectActiveJury, type GameRunnerOptions, type DurableGameTurnSnapshotV1, type CanonicalGameEvent } from "@influence/engine";
import { planVisualScene, sameVisualArrangement, type VisualPlacement } from "@influence/engine/visual-scene-plan";
import type { VisualRoomId } from "@influence/engine/visual-mode";
import type { DrizzleDB } from "../db/index.js";
import { prepareVisualGameAssets } from "./visual-game-assets.js";
import { visualExecutionBoundaryGuard } from "./visual-execution-boundary.js";
import { prepareCommittedMingleScenes } from "./visual-mingle-boundary.js";
import { prepareVisualScene, readCurrentVisualScene } from "./visual-scene-store.js";
import { renderVisualSceneBestEffort } from "./visual-best-effort.js";
import { createVisualTurnContextReader } from "./visual-turn-context.js";
import { planFinalsScene } from "./visual-finals-plan.js";

export function createVisualGameRuntime(db: DrizzleDB, gameId: string, ownerEpoch: string): Pick<GameRunnerOptions, "prepareVisualBoundary" | "prepareVisualTurn"> {
  let readContext = createVisualTurnContextReader(db, { gameId, ownerEpoch, frozenCast: [] });
  let latestSnapshot: DurableGameTurnSnapshotV1 | undefined;
  let requireVisuals = false;
  return {
    prepareVisualBoundary: async (snapshot: DurableGameTurnSnapshotV1) => {
      latestSnapshot = snapshot;
      const [game] = await db.select({ config: schema.games.config }).from(schema.games).where(eq(schema.games.id, gameId));
      requireVisuals = visualFailurePolicy(JSON.parse(game?.config ?? "{}")) === "require_visuals";
      const { execution } = snapshot;
      const guard = visualExecutionBoundaryGuard(db, { gameId, ownerEpoch, heads: execution.heads, cursor: execution.cursor });
      const prepare = async () => {
      try {
        const assets = await prepareVisualGameAssets(db, gameId, guard);
        readContext = createVisualTurnContextReader(db, { gameId, ownerEpoch, frozenCast: assets.cast });
        if (requireVisuals && (assets.cast.some((member) => member.portraitFallback === true) || Object.keys(assets.backgrounds).length < Object.keys(VISUAL_ROOMS).length)) throw new Error("Required character references or room backgrounds are unavailable");
        if (execution.cursor.kind === "mingle") {
          await prepareCommittedMingleScenes(db, { snapshot, frozenCast: assets.cast, backgrounds: assets.backgrounds, requireVisuals });
          return;
        }
        const coordinate = execution.xstateSnapshot.value;
        const state = GameState.fromCanonicalEvents(snapshot.canonicalEvents);
        const roomId: VisualRoomId | null = coordinate === "lobby" || coordinate === "reckoning_lobby" || coordinate === "reckoning_plea" ? "lobby"
          : ["tribunal_lobby", "tribunal_accusation", "tribunal_defense"].includes(String(coordinate)) ? "tribunal"
          : ["judgment_opening", "judgment_jury_questions", "judgment_closing"].includes(String(coordinate)) ? "finals" : null;
        if (!roomId) return;
        const ids = [...new Set([...state.getAlivePlayerIds(), ...(roomId === "finals" ? selectActiveJury(state.jury, state.getAllPlayers().length).map((member) => member.playerId) : [])])];
        const cast = ids.map((id) => {
          const member = assets.cast.find((entry) => entry.id === id);
          if (!member) throw new Error("Scene participant lacks a frozen reference");
          return member;
        });
        const previous = await readCurrentVisualScene(db, gameId, roomId);
        const roles: Record<string, VisualPlacement["role"]> = {};
        if (roomId === "finals") for (const id of ids) roles[id] = state.getAlivePlayerIds().includes(id) ? "finalist" : "juror";
        if (roomId === "tribunal") {
          const accused = snapshot.canonicalEvents.filter((event) => event.type === "endgame.speech_recorded" && event.round === state.round && event.payload.speechKind === "accusation");
          for (const event of accused) if (event.type === "endgame.speech_recorded" && event.payload.targetId) roles[event.payload.targetId] = "addressing";
        }
        const cues = snapshot.canonicalEvents.filter((event): event is Extract<CanonicalGameEvent, { type: "visual.cue_recorded" }> => event.type === "visual.cue_recorded" && event.payload.sceneId === previous?.id)
          .map((event) => ({ playerId: event.payload.playerId, cue: event.payload.cue }));
        const plan = roomId === "finals" ? planFinalsScene(state, assets.cast, assets.backgrounds.finals ?? null, previous ?? undefined) : planVisualScene({ roomId, backgroundArtifactId: assets.backgrounds[roomId] ?? null, cast, roles, previous: previous?.plan,
          allianceGroups: state.getHuddleEligibleAlliances().map((alliance) => alliance.memberIds), cues });
        if (previous?.status === "ready" && sameVisualArrangement(previous.plan, plan)) {
          if (requireVisuals && previous.anchors?.length !== plan.cast.length) throw new Error("Required agent annotations are unavailable");
          return;
        }
        await guard();
        const scene = await prepareVisualScene(db, { gameId, boundarySequence: execution.heads.turnSequence, afterDialogueSequence: execution.heads.dialogueSequence, plan, assertBoundary: guard });
        const accepted = await renderVisualSceneBestEffort(db, scene, guard);
        if (!accepted && !requireVisuals) await recordVisualOperationEvent(db, gameId, `${scene.id}:boundary:${execution.heads.turnSequence}:portraits`, { sceneId: scene.id, boundarySequence: execution.heads.turnSequence, kind: "presentation", outcome: "portraits", message: "Best effort: scene unavailable; continue dialogue using portraits and text context" });
        if (requireVisuals && (!accepted || accepted.anchors?.length !== plan.cast.length)) throw new Error("Required scene or verified agent annotations are unavailable");
      } catch (error) {
        await recordVisualOperationEvent(db, gameId, `boundary:${execution.heads.turnSequence}:preparation-failure`, {
          boundarySequence: execution.heads.turnSequence, kind: "failure", outcome: "failed", message: "Visual boundary preparation failed",
        }, visualFailureEvidence(error, "internal"));
        if (requireVisuals) throw new VisualPreparationBlocked(error instanceof Error ? error.message : "Visual preparation failed", snapshot);
        await recordVisualOperationEvent(db, gameId, `boundary:${execution.heads.turnSequence}:portraits`, { boundarySequence: execution.heads.turnSequence, kind: "presentation", outcome: "portraits", message: "Best effort: preparation unavailable; continue with portraits and text context" });
      }
      };
      await prepare();
      const recorded = new Set(snapshot.canonicalEvents.flatMap((event) => event.type === "visual.operation_recorded" ? [event.payload.id] : []));
      return (await readVisualOperationEvents(db, gameId)).filter((row) => !recorded.has(row.id)).map((row) => row.event);
    },
    prepareVisualTurn: async (input) => {
      if (!readContext) return { performanceInstructions: "" };
      try {
        const context = await readContext(input);
        if (requireVisuals && context.observableRoom && !context.room && latestSnapshot) throw new VisualPreparationBlocked("Required annotated room imagery could not be supplied to the agent", latestSnapshot);
        return context;
      } catch (error) {
        await recordVisualOperationEvent(db, gameId, `turn:${input.turnId}:${input.context.selfId}:context-failure`, {
          boundarySequence: input.committedHeads.turnSequence, kind: "failure", outcome: "failed", message: "Agent visual context unavailable",
        }, visualFailureEvidence(error, "internal"));
        if (requireVisuals && latestSnapshot) throw error instanceof VisualPreparationBlocked ? error : new VisualPreparationBlocked("Required agent imagery is unavailable", latestSnapshot);
        return { performanceInstructions: "" };
      }
    },
  };
}
