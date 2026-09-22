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
