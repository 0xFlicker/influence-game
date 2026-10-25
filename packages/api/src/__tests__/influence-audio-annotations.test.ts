import {afterEach, beforeEach, expect, test} from "bun:test";
import {eq} from "drizzle-orm";
import {providerAcceptedDecisionId, type GameTurnIntentV1} from "@influence/engine";
import {compileAudioDelivery} from "@influence/engine/audio-delivery";
import {schema} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {seedProductionStudioFixture} from "./production-studio-fixtures.js";
import {readAudioSource} from "../services/audio-source.js";
import {storeJson} from "../services/payload-storage.js";
import {sha256StableJson} from "../services/stable-hash.js";
import {insertOwner} from "./durable-run-test-utils.js";
import {createInitialGameExecutionStateV1} from "../services/game-turn-commit.js";
const priorSecret = process.env.JWT_SECRET;
beforeEach(() => {process.env.JWT_SECRET = "audio-annotations-test-only";});
afterEach(() => {if (priorSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = priorSecret;});

test("durable Influence audio binds accepted decision IDs across a shared event watermark", async () => {
  const db = await setupTestDB(), fixture = await seedProductionStudioFixture(db), gameId = fixture.influence.id;
  const ownerEpoch = await insertOwner(db, gameId, {status:"closed"});
  const state = createInitialGameExecutionStateV1({gameId,ownerEpoch,xstateSnapshot:{value:"lobby"},cursor:{version:1,kind:"phase_enter",actor:"lobby"}});
  const intent: GameTurnIntentV1 = {version:1,gameId,turnId:"audio-turn",turnSequence:1,seed:"audio",baseHeads:state.heads,
    branch:{version:1,kind:"engine",action:"round_start"},actorIds:[],targetIds:[],handles:[],participantIds:[],providerSubcalls:[]};
  const hash = sha256StableJson(intent), committedAt = new Date().toISOString();
  await db.insert(schema.gameTurns).values({id:intent.turnId,gameId,turnSequence:1,plannedOwnerEpoch:ownerEpoch,committedOwnerEpoch:ownerEpoch,
    baseEventSequence:0,baseDialogueSequence:0,basePublicationSequence:0,intent:await storeJson(intent),intentHash:hash,effectHash:hash,status:"committed",committedAt,
    commitResult:await storeJson({version:1,gameId,turnId:intent.turnId,turnSequence:1,intentHash:hash,effectHash:hash,committedAt,state,canonicalEvents:[],dialogueSequences:[],publications:[],alreadyCommitted:false})});
  const rows = (await db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, gameId)))
    .filter(row => row.entrySequence === 1 || row.entrySequence === 2).sort((a,b) => a.entrySequence! - b.entrySequence!);
  expect(rows).toHaveLength(2);
  const text = "We should compare notes.", thinking = "The same words can carry a different intent.";
  for (const [index,row] of rows.entries()) {
    const attempt = `accepted-audio-${index}`;
    await db.update(schema.transcripts).set({text, thinking, firstDurableEventSequence: rows[0]!.firstDurableEventSequence,
      safeContext: {...row.safeContext, version: 1, decisionId: providerAcceptedDecisionId(attempt)}}).where(eq(schema.transcripts.id, row.id));
    const fields = [{path:["message"],delivery:compileAudioDelivery(index ? `<loud>${text}</loud>` : `<soft>${text}</soft>`, "speech")},
      {path:["thinking"],delivery:compileAudioDelivery(index ? `<higher-pitch>${thinking}</higher-pitch>` : `<soft>${thinking}</soft>`, "thinking")}];
    await db.insert(schema.providerLogicalCalls).values({id:`audio-call-${index}`, gameId, actorId:row.fromPlayerId, actorName:"Atlas", actorRole:"player", action:"lobby-message",
      semanticCoordinate:{version:1,kind:"durable_turn",turnId:"audio-turn",subcallSlot:index+1}, semanticCoordinateHash:`sha256:slot-${index}`,
      gameTurnId:"audio-turn", gameTurnSubcallSlot:index+1, gameTurnCommittedAt:new Date().toISOString(),
      acceptedAttemptId:attempt, acceptedCatalogId:"openai:gpt-6-sol", acceptedValue:await storeJson({text}), acceptedValueSha256:sha256StableJson({text}),
      acceptedAt:new Date().toISOString(), audioDelivery:await storeJson({version:1,fields})});
  }
  const source = await readAudioSource(db, gameId);
  for (const [index,row] of rows.entries()) {
    const lines = source.lines.filter(line => line.watch?.public?.kind === "influence" && line.watch.public.transcriptId === String(row.id));
    expect(lines).toHaveLength(2);
    expect(lines.find(line => line.context === "speech")?.synthesisText).toBe(compileAudioDelivery(index ? `<loud>${text}</loud>` : `<soft>${text}</soft>`, "speech").synthesisText);
    expect(lines.find(line => line.context === "thinking")?.synthesisText).toBe(compileAudioDelivery(index ? `<higher-pitch>${thinking}</higher-pitch>` : `<soft>${thinking}</soft>`, "thinking").synthesisText);
  }
  // A reserved/accepted attempt without atomic turn commit is never publication authority.
  await db.update(schema.providerLogicalCalls).set({gameTurnCommittedAt:null}).where(eq(schema.providerLogicalCalls.id,"audio-call-1"));
  const uncommitted = await readAudioSource(db, gameId);
  expect(uncommitted.lines.find(line => line.watch?.public?.kind === "influence" && line.watch.public.transcriptId === String(rows[1]!.id) && line.context === "speech")?.synthesisText).toBe(compileAudioDelivery(text,"speech").synthesisText);
}, 30_000);
