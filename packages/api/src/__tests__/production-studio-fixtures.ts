import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { Phase } from "@influence/engine";
import { completedWerewolfResultsFixture as werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { seedFormatAwareGameViewerFixtures } from "../e2e/format-aware-game-viewer-fixture.js";
import { getPersistedGameEvents } from "../services/game-event-read-model.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { readInfluenceProductionSource } from "../services/influence-production-source.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { acceptVisualScene, prepareVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { readWerewolfProductionSource } from "../services/werewolf-production-source.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { insertOwner } from "./durable-run-test-utils.js";

/** Provider-free browser/export data. Caller must own an isolated database and
 * lifecycle, or call setupTestDB() before mutations in shared PostgreSQL tests.
 * Local synthetic scene/body images are fixture evidence, never provider output.
 * Authentication uses the caller's configured local JWT_SECRET. */
export async function seedProductionStudioFixture(db: DrizzleDB) {
  const producerId = "studio-fixture-producer", legacyId = "studio-fixture-visual-operator";
  await db.insert(schema.users).values([
    { id: producerId, displayName: "Studio Producer", handle: "studio-fixture-producer" },
    { id: legacyId, displayName: "Studio Visual Operator", handle: "studio-fixture-visual-operator" },
  ]);
  await grantTestAuthority(db, producerId, [], "producer");
  await grantTestAuthority(db, producerId, ["view_admin", "start_game", "manage_postgame_media"], "studio-fixture-production-operator");
  await grantTestAuthority(db, legacyId, ["view_admin", "start_game"], "studio-legacy-visual");
  // Reserve the two original thought/speech entries added below. The shared
  // seed already supplies one complete, canonically linked retrospective tail.
  await seedFormatAwareGameViewerFixtures(db, 3);
  const gameId = "e2e-dark-coral-horn";
  const history = await getPersistedGameEvents(db, gameId), atlas = `${gameId}-atlas`;
  if (history.status !== "complete") throw new Error("Production fixture needs the existing trusted format events");
  const seats = await db.select({ id: schema.gamePlayers.id, persona: schema.gamePlayers.persona }).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  const portraitImage = await readFile(new URL("../../../web/public/avatars/personas/observer.png", import.meta.url));
  const portraitId = await storeVisualArtifact(db, gameId, portraitImage);
  const body = await sharp({ create: { width: 320, height: 560, channels: 4, background: "#443247" } }).composite([{ input: Buffer.from(
    '<svg width="320" height="560"><circle cx="160" cy="105" r="55" fill="#e3bda6"/><rect x="95" y="165" width="130" height="235" rx="30" fill="#e2c29d"/><path d="M110 400L100 545M205 400L215 545" stroke="#ae8596" stroke-width="48"/></svg>') }]).png().toBuffer();
  const bodyId = await storeVisualArtifact(db, gameId, body);
  const sceneImage = await sharp({ create: { width: 1280, height: 720, channels: 4, background: "#211b24" } }).composite([{ input: Buffer.from(
    '<svg width="1280" height="720"><rect x="24" y="24" width="1232" height="672" rx="36" fill="#342a36"/><path d="M80 520H1200" stroke="#71555c" stroke-width="120"/><rect x="80" y="60" width="350" height="200" fill="#403448"/><text x="100" y="110" fill="#f7ddc0" font-family="sans-serif" font-size="28">Local Production Studio fixture</text><circle cx="450" cy="330" r="60" fill="#e3bda6"/><circle cx="800" cy="330" r="60" fill="#cda693"/><path d="M450 400V520M800 400V520" stroke="#ceb591" stroke-width="100"/></svg>') }]).png().toBuffer();
  const sceneId = await storeVisualArtifact(db, gameId, sceneImage);
  const cast = seats.map(seat => ({ id: seat.id, name: (JSON.parse(seat.persona) as { name: string }).name,
    referenceArtifactId: bodyId, portraitFallback: false, headRectangle: { x: .328125, y: .089286, width: .34375, height: .196429 }, performanceInstructions: "Local fixture pose" }));
  await db.insert(schema.visualGameAssets).values({ gameId, profiles: [], cast, portraits: Object.fromEntries(seats.map(seat => [seat.id, portraitId])), status: "ready" });
  const plan = planVisualScene({ roomId: "lobby", backgroundArtifactId: sceneId, cast: cast.slice(0, 2) });
  const planned = await prepareVisualScene(db, { gameId, boundarySequence: 0, afterDialogueSequence: 0, plan });
  const anchors = planned.plan.cast.map((member, index) => ({ playerId: member.id, label: index + 1, confidence: "clear" as const,
    head: { x: index ? .578125 : .3046875, y: .375, width: .09375, height: .166667 } }));
  const accepted = await acceptVisualScene(db, { sceneId: planned.id, planHash: planned.planHash, imageArtifactId: sceneId, anchors,
    verifiedParticipantIds: planned.plan.cast.map(member => member.id) });
  const firstEvent = history.events[0]!.sequence;
  const [speechRow, roomRow] = await db.insert(schema.transcripts).values([
    { gameId, round: 1, phase: Phase.INTRODUCTION, scope: "public", fromPlayerId: atlas, speakerPlayerId: atlas, entrySequence: 1,
      captureVersion: 1, audiencePlayerIds: [], firstDurableEventSequence: firstEvent, safeContext: { version: 1 },
      text: "I will listen closely, remember our commitments, and make each vote count.", thinking: "A promise gives the other contestants a reason to trust me. I should watch whether their next choices match their words.", timestamp: history.events[0]!.envelope.timestamp ? Date.parse(history.events[0]!.envelope.timestamp) - 1 : 1 },
    { gameId, round: 1, phase: Phase.LOBBY, scope: "public", fromPlayerId: atlas, speakerPlayerId: atlas, entrySequence: 2,
      captureVersion: 1, audiencePlayerIds: [], firstDurableEventSequence: firstEvent, safeContext: { version: 1, visualScene: { id: accepted.id, roomId: "lobby" } },
      text: "Vera, let us compare notes before the next round. Which commitment matters most to you?", thinking: "I can ask a direct question without making an accusation. Her answer may reveal which alliance she wants to keep.", timestamp: Date.parse(history.events[0]!.envelope.timestamp) },
  ] satisfies Array<typeof schema.transcripts.$inferInsert>).returning();
  if (!speechRow || !roomRow) throw new Error("Production fixture transcript was not stored");
  const influence = await readInfluenceProductionSource(db, gameId);
  const thought = influence.catalog.moments.find(moment => moment.kind === "thinking" && moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(speechRow.id));
  const speech = influence.catalog.moments.find(moment => moment.kind === "speech" && moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(speechRow.id));
  if (!thought || !speech) throw new Error("Production fixture needs independent thought and speech");
  await db.insert(schema.productionMomentAnnotations).values({ gameId, momentKey: thought.id, tags: { cut: "youtube" }, revision: 1, updatedById: producerId });
  const werewolfId = "studio-fixture-werewolf", wolfEvents = await werewolfResultsFixture("saved", werewolfId, 2);
  await db.insert(schema.games).values({ id: werewolfId, slug: werewolfId, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(wolfEvents.map(event => ({ gameId: werewolfId, sequence: event.sequence, event })));
  const mystery = await readWerewolfProductionSource(db, werewolfId, { audience: "mystery", thinking: false });
  const omniscient = await readWerewolfProductionSource(db, werewolfId, { audience: "omniscient", thinking: true });
  const pausedId = "studio-fixture-paused-influence";
  await db.insert(schema.games).values({ id: pausedId, slug: pausedId, status: "in_progress", config: "{}" });
  const ownerEpoch = await insertOwner(db, pausedId);
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(pausedId));
  await initializeGameExecutionAuthority(db, createInitialGameExecutionStateV1({ gameId: pausedId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } }));
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visualMode: true, visualFailurePolicy: "require_visuals", visualPause: { boundarySequence: 0, reason: "Provider-free fixture awaiting visual repair" } }) }).where(eq(schema.games.id, pausedId));
  const paused = await readInfluenceProductionSource(db, pausedId);
  return { producer: { userId: producerId, token: await createSessionToken(producerId, { roles: ["producer", "studio-fixture-production-operator"], permissions: ["view_admin", "start_game", "manage_postgame_media"] }) },
    legacyVisual: { userId: legacyId, token: await createSessionToken(legacyId, { roles: ["studio-legacy-visual"], permissions: ["view_admin", "start_game"] }) },
    influence: { id: gameId, slug: influence.game.slug, thoughtId: thought.id, speechId: speech.id, roomSpeechId: influence.catalog.moments.find(moment => moment.kind === "speech" && moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(roomRow.id))!.id, sceneId: accepted.id, snapshot: influence.snapshot },
    werewolf: { id: werewolfId, slug: werewolfId, mysterySnapshot: mystery.snapshot, omniscientSnapshot: omniscient.snapshot },
    pausedInfluence: { id: pausedId, slug: pausedId, snapshot: paused.snapshot } };
}
