import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { GameState, Phase, projectViewerDecisionEvent } from "@influence/engine";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { appendGameEvents } from "../services/game-events.js";
import { storeJson } from "../services/payload-storage.js";
import { readGamePresentation } from "../services/game-presentation.js";

test("live delivery holds an entire phase, then matches replay with stable speech identities", async () => {
  const db = await setupTestDB();
  const gameId = await insertGame(db, { status: "in_progress" });
  await db.update(schema.games).set({ gameKernel: "format" }).where(eq(schema.games.id, gameId));
  const ownerEpoch = await insertOwner(db, gameId);
  const turnId = randomUUID();
  const hash = `sha256:${"1".repeat(64)}`;
  const object = JSON.stringify(await storeJson({}));
  await db.execute(sql`INSERT INTO game_turns (id,game_id,turn_sequence,status,planned_owner_epoch,committed_owner_epoch,base_event_sequence,base_dialogue_sequence,base_publication_sequence,intent_object,intent_hash,effect_hash,commit_result_object,committed_at)
    VALUES (${turnId},${gameId},1,'committed',${ownerEpoch},${ownerEpoch},0,0,0,${object}::jsonb,${hash},${hash},${object}::jsonb,now()::text)`);
  const state = new GameState([{ id: "a", name: "A" }, { id: "b", name: "B" }], { gameId });
  state.startRound();
  state.recordFormatMenu("a", ["save_or_eliminate", "vote_bomb"]);
  state.recordFormatSelected("a", "save_or_eliminate");
  state.recordPhaseEntered(Phase.FORMAT_MINGLE);
  const before = [...state.getCanonicalEvents()];
  await appendGameEvents(db, { gameId, ownerEpoch, events: before });
  let publicationSequence = 0;
  for (const event of before) {
    if (!projectViewerDecisionEvent(event)) continue;
    publicationSequence++;
    await db.insert(schema.gamePublications).values({gameId,turnId,turnSequence:1,turnPublicationOrdinal:publicationSequence,publicationSequence,kind:"canonical_event",payload:{version:1,kind:"canonical_event",eventSequence:event.sequence},availableAt:"2026-01-01T00:00:00Z"});
  }
  publicationSequence++;
  await db.insert(schema.transcripts).values({gameId,round:1,phase:Phase.FORMAT_MINGLE,fromPlayerId:"a",speakerPlayerId:"a",scope:"mingle",text:"Accepted speech",timestamp:Date.now(),entrySequence:1,firstDurableEventSequence:before.at(-1)!.sequence,audiencePlayerIds:["a","b"],captureVersion:1,dialogueKind:"mingle_speech",safeContext:{version:1},gameTurnId:turnId,gameTurnTranscriptOrdinal:1});
  await db.insert(schema.gamePublications).values({gameId,turnId,turnSequence:1,turnPublicationOrdinal:publicationSequence,publicationSequence,kind:"transcript_entry",payload:{version:1,kind:"transcript_entry",turnId,transcriptOrdinal:1},availableAt:null});
  const open = await readGamePresentation(db, gameId);
  expect(open?.messages).toEqual([]);
  state.recordPhaseEntered(Phase.FORMAT_RESOLVE);
  const boundary = state.getCanonicalEvents().at(-1)!;
  await appendGameEvents(db, {gameId,ownerEpoch,events:[boundary]});
  await db.insert(schema.gamePublications).values({gameId,turnId,turnSequence:1,turnPublicationOrdinal:publicationSequence+1,publicationSequence:publicationSequence+1,kind:"canonical_event",payload:{version:1,kind:"canonical_event",eventSequence:boundary.sequence},availableAt:"2026-01-01T00:00:00Z"});
  expect((await readGamePresentation(db, gameId))?.messages).toEqual([]);
  await db.update(schema.gamePublications).set({availableAt:"2026-01-01T00:00:00Z"}).where(eq(schema.gamePublications.gameId,gameId));
  const live = await readGamePresentation(db,gameId);
  expect(live?.throughSequence).toBe(boundary.sequence-1);
  expect(live?.messages).toMatchObject([{entry:{text:"Accepted speech",entrySequence:1}}]);
  expect(live?.frames.some(frame=>frame.sequence===boundary.sequence)).toBe(false);
  const reload = await readGamePresentation(db,gameId);
  expect(reload).toEqual(live);
  const suffix = await readGamePresentation(db,gameId,live!.throughSequence);
  expect(suffix?.frames).toEqual([]);
  expect(suffix?.messages).toEqual([]);
  await db.update(schema.games).set({status:"suspended"}).where(eq(schema.games.id,gameId));
  expect((await readGamePresentation(db,gameId))?.messages).toEqual(live?.messages);
  await expect(readGamePresentation(db,gameId,9999)).rejects.toThrow("ahead");
  // Every ballot and the empowered tie decision remain withheld while resolve is open.
  state.recordFormatBallot({formatId:"save_or_eliminate", voterId:"a", targetId:"b", polarity:"save"});
  state.recordFormatBallot({formatId:"save_or_eliminate", voterId:"b", targetId:"a", polarity:"save"});
  state.recordFormatResolution({formatId:"save_or_eliminate", empoweredId:"a", eliminatedId:"b", resolutionKind:"clear", tiedPlayerIds:["a","b"], tiebreakerId:"a",
    aggregate:{capability:"sealed_polarity", nets:{a:1,b:1}, savesReceived:{a:1,b:1}, eliminateReceived:{a:0,b:0}}});
  const resolved = state.getCanonicalEvents().filter(event => event.sequence > boundary.sequence);
  await appendGameEvents(db,{gameId,ownerEpoch,events:resolved});
  publicationSequence++;
  for (const event of resolved) {
    publicationSequence++;
    await db.insert(schema.gamePublications).values({gameId,turnId,turnSequence:1,turnPublicationOrdinal:publicationSequence,publicationSequence,kind:"canonical_event",payload:{version:1,kind:"canonical_event",eventSequence:event.sequence},availableAt:"2026-01-01T00:00:00Z"});
  }
  publicationSequence++;
  await db.insert(schema.transcripts).values({gameId,round:1,phase:Phase.FORMAT_RESOLVE,fromPlayerId:"a",speakerPlayerId:"a",scope:"public",text:"I break the tie and choose B.",timestamp:Date.now()+1,entrySequence:2,firstDurableEventSequence:resolved.at(-1)!.sequence,audiencePlayerIds:["a","b"],captureVersion:1,dialogueKind:"public_speech",safeContext:{version:1,decisionSpeech:{actorId:"a",action:"format-tiebreak"}},gameTurnId:turnId,gameTurnTranscriptOrdinal:2});
  await db.insert(schema.gamePublications).values({gameId,turnId,turnSequence:1,turnPublicationOrdinal:publicationSequence,publicationSequence,kind:"transcript_entry",payload:{version:1,kind:"transcript_entry",turnId,transcriptOrdinal:2},availableAt:"2026-01-01T00:00:00Z"});
  const unresolved = await readGamePresentation(db,gameId,live!.throughSequence);
  expect(unresolved?.frames).toEqual([]);
  expect(unresolved?.messages).toEqual([]);
  state.recordPhaseEntered(Phase.LOBBY);
  const closed = state.getCanonicalEvents().at(-1)!;
  await appendGameEvents(db,{gameId,ownerEpoch,events:[closed]});
  publicationSequence++;
  await db.insert(schema.gamePublications).values({gameId,turnId,turnSequence:1,turnPublicationOrdinal:publicationSequence,publicationSequence,kind:"canonical_event",payload:{version:1,kind:"canonical_event",eventSequence:closed.sequence},availableAt:"2026-01-01T00:00:00Z"});
  const resolution = await readGamePresentation(db,gameId,live!.throughSequence);
  expect(resolution?.frames.filter(frame=>frame.eventType === "format.ballot_cast")).toHaveLength(2);
  expect(resolution?.frames.find(frame=>frame.eventType === "format.resolved")?.viewerDecisionEvent).toMatchObject({payload:{tiebreakerId:"a",eliminatedId:"b"}});
  expect(resolution?.messages).toMatchObject([{entry:{text:"I break the tie and choose B.",decisionSpeech:{actorId:"a",action:"format-tiebreak"}}}]);
  const completePrefix = await readGamePresentation(db,gameId);
  expect(completePrefix?.frames).toEqual([...live!.frames,...resolution!.frames]);
  expect(completePrefix?.messages).toEqual([...live!.messages,...resolution!.messages]);
  // No speech or facts may overtake the audio frontier.
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id,gameId));
  await db.update(schema.games).set({config:JSON.stringify({...JSON.parse(game!.config),audioMode:true})}).where(eq(schema.games.id,gameId));
  const heldForAudio = await readGamePresentation(db,gameId);
  expect(heldForAudio?.throughSequence).toBe(0);
  expect(heldForAudio?.messages).toEqual([]);
  await db.update(schema.games).set({config:game!.config,status:"completed"}).where(eq(schema.games.id,gameId));
  expect((await readGamePresentation(db,gameId))?.finished).toBe(true);
  await db.insert(schema.transcripts).values({gameId,round:0,phase:Phase.INTRODUCTION,fromPlayerId:"a",scope:"public",text:"Historical unanchored speech",timestamp:1,captureVersion:null});
  await db.update(schema.games).set({status:"in_progress"}).where(eq(schema.games.id,gameId));
  expect((await readGamePresentation(db,gameId))?.throughSequence).toBe(0);
  await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,gameId));
  const oldComplete = await readGamePresentation(db,gameId);
  expect(oldComplete?.messages.map(row=>row.entry.text)).toContain("Historical unanchored speech");
  // Older completed recordings with no publication ledger use the same DTO and
  // retain their saved dialogue instead of silently producing an empty replay.
  await db.delete(schema.gamePublications).where(eq(schema.gamePublications.gameId,gameId));
  const historical = await readGamePresentation(db,gameId);
  expect(historical?.messages).toEqual(oldComplete?.messages);
  expect(historical?.finished).toBe(true);
  await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,gameId));
  expect(await readGamePresentation(db,gameId)).toBeNull();
});
