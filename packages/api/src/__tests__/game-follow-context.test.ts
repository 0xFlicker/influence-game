import {sha256StableJson} from '../services/stable-hash.js';
import {storeFields} from '../services/payload-storage.js';
import {beforeEach,expect,test} from 'bun:test';
import {schema,type DrizzleDB} from '../db/index.js';
import {setupTestDB} from './test-utils.js';
import {completedCurrentWerewolfFixture} from '@influence/engine/fixtures/werewolf-results';
import {projectWerewolfProductionWatch,projectWerewolfProductionProvenance} from '@influence/engine/werewolf/watch';
import {buildWerewolfProductionSources} from '@influence/engine/production-moments/werewolf-source';
import {assembleProductionCatalog,type ProductionMomentPart} from '@influence/engine/production-moments';
import {readGameFollowContext,loadInfluenceFollowData,projectInfluenceFollow} from '../services/game-follow-context.js';
import {seedFormatAwareGameViewerFixtures} from '../e2e/format-aware-game-viewer-fixture.js';
import {eq} from 'drizzle-orm';
let db:DrizzleDB;
beforeEach(async()=>{db=await setupTestDB();});
async function werewolf(){
 const id='follow-werewolf';const events=await completedCurrentWerewolfFixture(id,11);
 await db.insert(schema.games).values({id,slug:id,gameKind:'werewolf',status:'completed',startedAt:'2026-09-01T00:00:00.000Z',config:'{"visibility":"public"}'});
 await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
 const first=events.find(e=>e.type==='werewolf.action_accepted'&&e.payload.action==='introduce')!;
 if(first.type!=='werewolf.action_accepted')throw new Error('Missing introduction');
 const value={...first.payload.decision,thinking:'SECRET_ACCEPTED_THINKING'};
 await db.insert(schema.providerLogicalCalls).values(await storeFields({id:'follow-thought',gameId:id,actorId:first.payload.actorId,actorName:'Player',actorRole:'player',action:'werewolf.introduce',semanticCoordinate:{version:1,kind:'werewolf_action',eventSequence:first.sequence},semanticCoordinateHash:'fixture',acceptedAttemptId:'fixture',acceptedCatalogId:'fixture',acceptedValue:value,acceptedValueSha256:sha256StableJson(value),acceptedAt:new Date().toISOString()}, {acceptedValue:'json-gzip'}));
 const read=(audience:'mystery'|'omniscient',cursor:number,part:ProductionMomentPart)=>readGameFollowContext(db,id,{kind:'werewolf',audience,cursor,part});
 return {id,events,read};
}
test('Mystery never carries role fields or thinking; omniscient thinking is independent of display preferences',async()=>{
 const f=await werewolf();
 for(const audience of ['mystery','omniscient'] as const){
  const projection=projectWerewolfProductionWatch(f.events,audience);
  const last=projection.moments.at(-1)!;
  const knowledge=await f.read(audience,last.cursor,{kind:last.entry.kind==='result'?'result':'speech'});
  expect(knowledge.roster.length).toBeGreaterThan(0);
  if(audience==='mystery'){expect(knowledge.thinking).toEqual([]);expect(JSON.stringify(knowledge)).not.toMatch(/"role":|SECRET_/);}
  else {expect(knowledge.thinking.length).toBeGreaterThan(0);expect(JSON.stringify(knowledge.thinking)).toContain('SECRET_ACCEPTED_THINKING');}
 }
});
test('each staged night action exposes only reached actions and investigation speech does not expose its result',async()=>{
 const f=await werewolf();const projection=projectWerewolfProductionWatch(f.events,'omniscient');
 const night=projection.moments.find(m=>m.night?.actions.some(a=>a.kind==='investigate'))!;
 const provenance=projectWerewolfProductionProvenance(f.events,'omniscient');
 const catalog=assembleProductionCatalog({gameId:f.id,gameKind:'werewolf',audience:'omniscient',sources:buildWerewolfProductionSources({gameId:f.id,audience:'omniscient',moments:projection.moments,provenance,thoughts:[],opening:true})});
 const seq=provenance.find(p=>p.cursor===night.cursor)!.eventSequence;
 const parts=catalog.moments.filter(m=>m.source.kind==='werewolf-event'&&m.source.eventSequence===seq);
 for(const moment of parts){
  const k=await f.read('omniscient',night.cursor,moment.part);const current=JSON.stringify(k.current);
  if(moment.part.kind==='protect'||moment.part.kind==='night-speech')expect(current).not.toContain('"isWolf"');
  if(moment.part.kind!=='outcome'){expect(JSON.stringify(k.state)).not.toContain(`"cursor":${night.cursor}`);expect(JSON.stringify(k.history)).not.toContain(`"cursor":${night.cursor}`);}
 }
 const complete=await f.read('omniscient',night.cursor,{kind:'outcome'});
 expect(JSON.stringify(complete.history)).toContain('My investigate choice tonight.');
 await expect(f.read('mystery',night.cursor,{kind:'investigate'})).rejects.toThrow();
});
test('current public ballot includes only the committed voter prefix',async()=>{
 const f=await werewolf();const ballot=projectWerewolfProductionWatch(f.events,'omniscient').moments.find(m=>m.entry.kind==='ballot')!;
 if(ballot.entry.kind!=='ballot')throw new Error('Missing public ballot');
 const k=await f.read('omniscient',ballot.cursor,{kind:'ballot',voterId:ballot.entry.actorId,purpose:'day',revote:false,juryTiebreaker:false});
 expect(JSON.stringify(k.history)).toContain(ballot.entry.actorId);
 expect(k.history.filter(row=>JSON.stringify(row).includes('"kind":"ballot"')).length).toBe(1);
});
test('a later canonical suffix cannot change an earlier Mystery context',async()=>{
 const f=await werewolf();const projection=projectWerewolfProductionWatch(f.events,'mystery');
 const m=projection.moments.find(m=>m.entry.kind==='conversation')!;const p={kind:'speech'} as const;
 const before=await f.read('mystery',m.cursor,p);
 const seq=projectWerewolfProductionProvenance(f.events,'mystery').find(p=>p.cursor===m.cursor)!.eventSequence;
 const {gt,and}=await import('drizzle-orm');
 await db.delete(schema.werewolfEvents).where(and(eq(schema.werewolfEvents.gameId,f.id),gt(schema.werewolfEvents.sequence,seq)));
 expect(await f.read('mystery',m.cursor,p)).toEqual(before);
});
test('Influence reveals accepted ballots individually and withholds the aggregate result',async()=>{
 await seedFormatAwareGameViewerFixtures(db);
 const [game]=await db.select().from(schema.games).where(eq(schema.games.slug,'dark-coral-horn'));
 const id=game!.id;const data=await loadInfluenceFollowData(db,game!);const events=data.events;
 const first=data.catalog.moments.find(m=>m.part.kind==='influence-presentation'&&m.part.presentation.kind==='format_roll_call')!;
 expect(first).toBeDefined();
 const firstVote=events.find(e=>e.type==='format.ballot_cast')!;
 const futureVote=events.filter(e=>e.type==='format.ballot_cast')[1]!;
 for(const [event,label] of [[firstVote,'CURRENT_THINKING'],[futureVote,'FUTURE_THINKING']] as const)
  await db.insert(schema.gameCognitiveArtifacts).values(await storeFields({id:label,gameId:id,eventSequence:event.sequence,artifactType:'thinking' as const,actorRole:'player' as const,action:'vote',payloadByteLength:100,payload:{thinking:label}}, {payload:'json-gzip'}));
 const refreshed=await loadInfluenceFollowData(db,game!);
 const k=projectInfluenceFollow(refreshed,{kind:'influence',source:first.source,part:first.part});
 expect(JSON.stringify(k.thinking)).toContain('CURRENT_THINKING');expect(JSON.stringify(k.thinking)).not.toContain('FUTURE_THINKING');
 const exposed=k.history.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.kind==='event').map(row=>JSON.stringify(row));
 expect(exposed.some(row=>row.includes('"type":"format.resolved"'))).toBe(false);
 const ballots=exposed.filter(row=>row.includes('"type":"format.ballot_cast"'));
 expect(ballots.length).toBe(1);
 // Exercise the full canonical format fixture, not just its first voter.
 for(const moment of refreshed.catalog.moments){
  if(moment.source.kind!=='influence-event'||moment.part.kind!=='influence-presentation'||moment.part.presentation.kind!=='format_roll_call')continue;
  const sequence=moment.source.eventSequence;
  const resolution=events.find(e=>e.sequence===sequence);
  if(resolution?.type!=='format.resolved')throw new Error('Roll call must resolve a canonical format');
  const context=projectInfluenceFollow(refreshed,{kind:'influence',source:moment.source,part:moment.part});
  const released=context.history.flatMap(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.kind==='event'?[JSON.stringify(row.event)]:[]);
  const reachedVoters=refreshed.catalog.moments.slice(0,refreshed.catalog.moments.indexOf(moment)+1).flatMap(m=>m.source.kind==='influence-event'&&m.source.eventSequence===resolution.sequence&&m.part.kind==='influence-presentation'&&m.part.presentation.kind==='format_roll_call'?[m.part.presentation.voterId]:[]);
  for(const vote of events.filter(e=>(e.type==='format.ballot_cast'||e.type==='format.ballot_forfeited')&&e.round===resolution.round)){
   if(vote.type!=='format.ballot_cast'&&vote.type!=='format.ballot_forfeited')continue;
   expect(released.includes(JSON.stringify(vote))).toBe(reachedVoters.includes(vote.payload.voterId));
  }
  expect(released.includes(JSON.stringify(resolution))).toBe(false);
 }
});
