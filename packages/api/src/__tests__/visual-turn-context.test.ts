import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { Phase, type GameExecutionStateV1, type PhaseContext } from "@influence/engine";
import { planVisualScene, type VisualCastMember } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { createVisualTurnContextReader } from "../services/visual-turn-context.js";
import { readVisualOperationEvents } from "../services/visual-diagnostics.js";
import { acceptVisualScene, prepareVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
let db: DrizzleDB;
let gameId: string;
let ownerEpoch: string;
let state: GameExecutionStateV1;
let cast: VisualCastMember[];
let artifact: string;
let context: PhaseContext;
beforeEach(async () => {
  db = await setupTestDB();
  gameId = await insertGame(db, { status: "in_progress" });
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  ownerEpoch = await insertOwner(db, gameId, { expiresAt: "2099-01-01T00:00:00.000Z" });
  state = createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } });
  await initializeGameExecutionAuthority(db, state);
  artifact = await storeVisualArtifact(db, gameId, await sharp({ create: { width: 256, height: 256, channels: 3, background: "#dedede" } }).png().toBuffer());
  cast = [{ id: "p1", name: "Arden", referenceArtifactId: artifact, performanceInstructions: "Quiet delivery" }];
  context = { gameId, selfId: "p1", selfName: "Arden", round: 1, phase: Phase.LOBBY, alivePlayers: [{ id: "p1", name: "Arden" }], publicMessages: [], mingleMessages: [] };
});
const args = () => ({ context, method: "getLobbyMessage", turnId: "turn-1", committedHeads: state.heads, committedCursor: state.cursor });
const reader = () => createVisualTurnContextReader(db, { gameId, ownerEpoch, frozenCast: cast });
async function readyScene() {
  const planned = await prepareVisualScene(db, { gameId, boundarySequence: 0, plan: planVisualScene({ roomId: "lobby", backgroundArtifactId: artifact, cast }) });
  return acceptVisualScene(db, { sceneId: planned.id, planHash: planned.planHash, imageArtifactId: artifact, anchors: [{ playerId: "p1", label: 1, confidence: "clear", head: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 } }] });
}

test("supplies accepted annotated pixels and frozen performance instructions", async () => {
  const scene = await readyScene();
  const result = await reader()(args());
  expect(result.performanceInstructions).toBe("Quiet delivery");
  expect(result.room?.scene.id).toBe(scene.id);
  expect(result.room?.scene.annotatedImageUrl).toStartWith("data:image/png;base64,");
  expect(result.room?.scene.participantIds).toEqual(["p1"]);
});

test("portrait and ballot turns need no room image; conversations use canonical text when images are unavailable", async () => {
  for (const method of ["getIntroduction", "getVotes", "getDiaryEntry", "getLastMessage", "getJuryVote"]) {
    expect(await reader()({ ...args(), method })).toEqual({ performanceInstructions: "Quiet delivery" });
  }
  expect((await reader()(args())).observableRoom?.participantIds).toEqual(["p1"]);
  expect((await reader()(args())).room).toBeUndefined();
  await readyScene();
  const changed = await reader()({ ...args(), context: { ...context, alivePlayers: [...context.alivePlayers, { id: "p2", name: "Mira" }] } });
  expect(changed.room).toBeUndefined();
  expect(changed.observableRoom?.participantIds).toEqual(["p1", "p2"]);
  const diagnostic = (await readVisualOperationEvents(db, gameId)).find((row) => row.evidence?.context?.reason === "participants");
  expect(diagnostic?.evidence?.context).toMatchObject({
    agentId: "p1", roomId: "lobby", renderRevision: 0,
    expectedParticipants: [{ id: "p1", name: "Arden" }, { id: "p2", name: "Mira" }],
    sceneParticipants: [{ id: "p1", name: "Arden" }], missingIds: ["p2"], extraIds: [],
  });
});

test("rejects stale ownership and changed committed heads before returning scene context", async () => {
  await readyScene();
  expect((await reader()({ ...args(), committedHeads: { ...state.heads, turnSequence: 1 } })).room).toBeUndefined();
  await db.update(schema.gameRunOwners).set({ status: "revoked" }).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
  expect((await reader()(args())).room).toBeUndefined();
});

test("Mingle imagery cannot use uncommitted scratch movement", async () => {
  expect((await reader()({ ...args(), method: "takeMingleTurn", context: { ...context, phase: Phase.FORMAT_MINGLE, currentRoomId: 1, mingleBeat: 1, roomMates: ["Arden"] } })).room).toBeUndefined();
});

test("a close group image carries the full canonical room and explicit visible identities", async () => {
  cast.push({ ...cast[0]!, id: "p2", name: "Mira" }, { ...cast[0]!, id: "p3", name: "Nova" });
  context.alivePlayers = cast.map(({ id, name }) => ({ id, name }));
  const plan = planVisualScene({ roomId: "lobby", backgroundArtifactId: artifact, cast });
  const planned = await prepareVisualScene(db, { gameId, boundarySequence: 0, plan });
  const anchor = { playerId: "p2", label: 1, confidence: "clear" as const, head: { x: .2, y: .2, width: .1, height: .1 } };
  await acceptVisualScene(db, { sceneId: planned.id, planHash: planned.planHash, imageArtifactId: artifact, anchors: [], shots: {
    mode: "groups", overview: null, groups: [{ imageArtifactId: artifact, annotatedArtifactId: artifact, participantIds: ["p1", "p2"], visibleParticipantIds: ["p2"], anchors: [anchor], pointers: [{ playerId: "p1", x: .5, y: .5 }] }],
  } });
  const result = await reader()(args());
  expect(result.room?.scene.participantIds).toEqual(["p1", "p2", "p3"]);
  expect(result.room?.scene.visibleParticipantIds).toEqual(["p2"]);
  expect(result.room?.scene.anchors).toEqual([anchor]);
  expect(result.room?.scene.annotatedImageUrl).toStartWith("data:image/png;base64,");
  expect(result.observableRoom?.participantIds).toEqual(["p1", "p2", "p3"]);
});


test("published corrections affect future context, preserve original pixels and respect Require visuals", async () => {
  const { controlVisualMedia } = await import("../services/visual-media-repair.js");
  const scene = await readyScene();
  const before = await reader()(args());
  const saved = await controlVisualMedia(db, gameId, "operator", { action: "review", requestId: "review", expectedVersion: 0, sceneId: scene.id,
    review: { expectedRevision: scene.renderRevision, planHash: scene.planHash, mode: "scene", shots: [{ sourceId: `artifact:${artifact}`, role: "overview", participantIds: ["p1"], visibleParticipantIds: [], anchors: [], pointers: [{ playerId: "p1", x: .7, y: .7 }] }] } });
  expect(saved.accepted).toBe(true);
  expect((await reader()(args())).room).toEqual(before.room);
  await controlVisualMedia(db, gameId, "operator", { action: "publish", requestId: "publish", expectedVersion: 1, sceneId: scene.id, versionId: saved.versionId!, expectedPublication: 0 });
  const corrected = await reader()(args());
  expect(corrected.room?.scene.visibleParticipantIds).toEqual([]);
  expect(corrected.room?.scene.anchors).toEqual([]);
  expect((await db.select().from(schema.visualScenes))[0]?.anchors).toEqual(scene.anchors);
  const strict = createVisualTurnContextReader(db, { gameId, ownerEpoch, requireVisuals: true, frozenCast: cast });
  expect((await strict(args())).room).toBeUndefined();
});
