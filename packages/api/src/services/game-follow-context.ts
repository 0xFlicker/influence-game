import {influenceFollowPartial} from '@influence/engine/game-follow-influence';
import {and,asc,eq,isNotNull} from 'drizzle-orm';
import {type CanonicalGameEvent,replayCanonicalEvents,createEmptyProjection} from '@influence/engine';
import {followJson,followVisibility,type GameFollowPosition,type GameFollowKnowledge,type GameFollowAdapter} from '@influence/engine/game-follow';
import {assembleProductionCatalog,productionMomentKey,type ProductionMoment,type ProductionMomentPart} from '@influence/engine/production-moments';
import {buildInfluenceProductionSources} from '@influence/engine/production-moments/influence-source';
import {buildWerewolfProductionSources} from '@influence/engine/production-moments/werewolf-source';
import {projectWerewolfProductionWatch,projectWerewolfProductionProvenance,walkWerewolfHistory} from '@influence/engine/werewolf/watch';
import {projectWerewolfSnapshot} from '@influence/engine/werewolf/observation';
import {schema,type DrizzleDB} from '../db/index.js';
import {resolveHouseSpectatorGame,HouseInspectionError,type HouseGame} from './house-game-access.js';
import {getPersistedGameEvents} from './game-event-read-model.js';
import {getGameWatchReplayFrames} from './game-watch-state.js';
import {readWerewolfEvents} from './werewolf-games.js';
import {readWerewolfProductionThinking} from './werewolf-thinking.js';
import {loadPayloads} from './payload-storage.js';
import {getGameMcpRules} from '../game-mcp/rules.js';

type ReadDB=Pick<DrizzleDB,'select'>;
function invalid(message:string):never {throw new HouseInspectionError('invalid_input',message);}
function position(value:unknown):GameFollowPosition {
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('A playback position is required');
  const p=value as Record<string,unknown>;
  if(p.kind==='influence' && Object.keys(p).sort().join()==='kind,part,source') {
    const typed=p as unknown as Extract<GameFollowPosition,{kind:'influence'}>;
    try { productionMomentKey('validation',typed.source,typed.part); }
    catch { return invalid('Invalid game playback source or part'); }
    return typed;
  }
  if(p.kind==='werewolf' && Object.keys(p).sort().join()==='audience,cursor,kind,part' && ['mystery','omniscient'].includes(String(p.audience)) && Number.isSafeInteger(p.cursor) && Number(p.cursor)>=0) {
    const typed=p as unknown as Extract<GameFollowPosition,{kind:'werewolf'}>;
    try { productionMomentKey('validation',{kind:'werewolf-event',eventSequence:1},typed.part); }
    catch { return invalid('Invalid Werewolf playback part'); }
    return typed;
  }
  return invalid('Invalid game playback position');
}
function selectedIndex(moments:readonly ProductionMoment[],id:string) {
  const index=moments.findIndex(m=>m.id===id);
  if(index<0)return invalid('Playback position is not an accepted game moment');
  return index;
}
function ballotActor(event:CanonicalGameEvent) {
  switch(event.type) {
    case 'vote.cast':case 'vote.empower_revote_cast':case 'format.ballot_cast':case 'format.ballot_forfeited':case 'endgame.elimination_vote_cast':return event.payload.voterId;
    case 'jury.vote_cast':return event.payload.jurorId;
    default:return null;
  }
}
function momentVoter(part:ProductionMomentPart) {
  if(part.kind==='ballot')return part.voterId;
  if(part.kind==='influence-presentation' && 'voterId' in part.presentation)return part.presentation.voterId;
  return null;
}
function matchesBallot(event:CanonicalGameEvent,part:ProductionMomentPart) {
  if(part.kind!=='influence-presentation')return false;
  const p=part.presentation;
  if(event.type==='vote.cast'||event.type==='vote.empower_revote_cast')return p.kind==='empower_ballot' && Boolean(p.revote)===(event.type==='vote.empower_revote_cast');
  if(event.type==='format.ballot_cast'||event.type==='format.ballot_forfeited')return p.kind==='format_roll_call';
  return p.kind==='endgame_ballot' && !p.juryTiebreaker;
}

export async function loadInfluenceFollowData(db:ReadDB,game:HouseGame) {
  const [history,frames,roster,rows,cognition,committedTurns]=await Promise.all([
    getPersistedGameEvents(db,game.id),getGameWatchReplayFrames(db,game.id,{},true),
    db.select({id:schema.gamePlayers.id,persona:schema.gamePlayers.persona}).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId,game.id)).orderBy(asc(schema.gamePlayers.joinedAt),asc(schema.gamePlayers.id)),
    db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId,game.id)).orderBy(asc(schema.transcripts.timestamp),asc(schema.transcripts.id)),
    loadPayloads(db.select().from(schema.gameCognitiveArtifacts).where(and(eq(schema.gameCognitiveArtifacts.gameId,game.id),eq(schema.gameCognitiveArtifacts.visibilityStatus,'active'),eq(schema.gameCognitiveArtifacts.redactionStatus,'active'),isNotNull(schema.gameCognitiveArtifacts.eventSequence))).orderBy(asc(schema.gameCognitiveArtifacts.eventSequence),asc(schema.gameCognitiveArtifacts.id))),
    db.select({id:schema.gameTurns.id}).from(schema.gameTurns).where(and(eq(schema.gameTurns.gameId,game.id),eq(schema.gameTurns.status,'committed'))),
  ]);
  if(history.status==='invalid')throw new HouseInspectionError('unavailable','Canonical game history failed validation');
  const events=history.events.map(e=>e.envelope);
  const retrospectives=new Map(events.flatMap(e=>e.type==='retrospective.statement_recorded'?e.sourcePointers.filter(p=>p.kind==='transcript_entry').map(p=>[p.sequence,{eventSequence:e.sequence,ordinal:e.payload.ordinal}] as const):[]));
  const committed=new Set(committedTurns.map(turn=>turn.id));
  const messages=rows.filter(r=>(!r.gameTurnId||committed.has(r.gameTurnId)) && r.firstDurableEventSequence!==null && r.firstDurableEventSequence<=history.lastTrustedSequence).map(r=>({
    id:r.id,entrySequence:r.entrySequence,firstDurableEventSequence:r.firstDurableEventSequence,timestamp:r.timestamp,round:r.round,phase:r.phase,scope:r.scope,
    speakerPlayerId:r.speakerPlayerId,fromPlayerId:r.fromPlayerId,toPlayerIds:r.toPlayerIds?JSON.parse(r.toPlayerIds):null,
    text:r.text,thinking:r.thinking,dialogueKind:r.dialogueKind,decisionId:r.safeContext?.decisionId,
    decisionSpeech:r.safeContext?.decisionSpeech,acceptedBallot:r.safeContext?.acceptedBallot,presentationPurpose:r.safeContext?.presentationPurpose,anonymous:r.safeContext?.anonymous,
    retrospectiveSource:r.entrySequence===null?undefined:retrospectives.get(r.entrySequence),
  }));
  const sourceFrames=(frames??[]).map(frame=>{
    const event=events.find(e=>e.sequence===frame.sequence);
    const productionBallot=event?.type==='endgame.elimination_vote_cast'?{kind:'eliminate' as const,voterId:event.payload.voterId}:event?.type==='jury.vote_cast'?{kind:'winner' as const,voterId:event.payload.jurorId}:event?.type==='council.vote_cast'?{kind:'council' as const,voterId:event.payload.voterId}:undefined;
    return {...frame,productionBallot};
  });
  const sources=buildInfluenceProductionSources({gameId:game.id,gameKernel:game.gameKernel==='format'?'format':'classic',frames:sourceFrames,transcripts:messages});
  const catalog=assembleProductionCatalog({gameId:game.id,gameKind:'influence',audience:'public',sources});
  return {game,events,messages,cognition,catalog,roster:roster.map(p=>({...JSON.parse(p.persona),id:p.id}))};
}
export function projectInfluenceFollow(data:Awaited<ReturnType<typeof loadInfluenceFollowData>>,p:Extract<GameFollowPosition,{kind:'influence'}>):GameFollowKnowledge {
  const {game,events,messages,catalog}=data;
  const index=p.source.kind==='opening'&&p.source.gameKind==='influence'&&p.part.kind==='opening'?-1:selectedIndex(catalog.moments,productionMomentKey(game.id,p.source,p.part));
  const current=index<0?null:catalog.moments[index]!;
  const reached=catalog.moments.slice(0,index+1);
  const eventMap=new Map(events.map(e=>[e.sequence,e]));
  const releasedAt=new Map<number,number>();
  for(const [i,m] of catalog.moments.entries()) if(m.source.kind==='influence-event' && m.kind!=='thinking')releasedAt.set(m.source.eventSequence,i);
  for(const event of events) {
    const actor=ballotActor(event);if(!actor)continue;
    const resolutionType=event.type==='jury.vote_cast'?'jury.winner_determined':event.type==='endgame.elimination_vote_cast'?'endgame.elimination_resolved':event.type==='vote.cast'?'vote.empower_tally_resolved':event.type==='vote.empower_revote_cast'?'vote.empowered_set':event.type==='format.ballot_cast'||event.type==='format.ballot_forfeited'?'format.resolved':null;
    const resolution=resolutionType?events.find(candidate=>candidate.sequence>event.sequence&&candidate.round===event.round&&candidate.type===resolutionType):undefined;
    const reveal=catalog.moments.findIndex(m=>m.source.kind==='influence-event' && m.source.eventSequence>event.sequence && eventMap.get(m.source.eventSequence)?.round===event.round && (!resolutionType||m.source.eventSequence===resolution?.sequence) && momentVoter(m.part)===actor && matchesBallot(event,m.part));
    releasedAt.set(event.sequence,reveal<0?Infinity:reveal);
  }
  for(const event of events)if(event.type==='endgame.elimination_resolved'){
    const exit=catalog.moments.findIndex(m=>m.source.kind==='influence-event'&&m.source.eventSequence>event.sequence&&m.part.kind==='influence-presentation'&&m.part.presentation.kind==='endgame_elimination'&&m.actorId===event.payload.eliminated);
    releasedAt.set(event.sequence,exit<0?Infinity:exit);
  }
  for(const message of messages) {
    if(message.firstDurableEventSequence===null)continue;
    const reveal=catalog.moments.findIndex(m=>m.source.kind==='influence-transcript'&&m.source.transcriptId===String(message.id));
    const event=eventMap.get(message.firstDurableEventSequence);
    if(reveal>=0&&event?.sourcePointers.some(pointer=>pointer.kind==='transcript_entry'&&pointer.sequence===message.entrySequence))
      releasedAt.set(event.sequence,Math.max(releasedAt.get(event.sequence)??-1,reveal));
  }
  const reachedTranscripts=new Set(reached.flatMap(m=>m.source.kind==='influence-transcript'?[m.source.transcriptId]:[]));
  let frontier=0;
  for(const m of reached) {
    if(m.source.kind==='influence-event')frontier=Math.max(frontier,m.source.eventSequence);
    if(m.source.kind==='influence-transcript'){const id=m.source.transcriptId;frontier=Math.max(frontier,messages.find(row=>String(row.id)===id)?.firstDurableEventSequence??0);}
  }
  const eligible=(seq:number)=>seq<=frontier && (releasedAt.get(seq)??-1)<=index;
  const releasedEvents=events.filter(e=>eligible(e.sequence));
  const firstUnreleased=events.find(e=>e.sequence<=frontier&&!eligible(e.sequence));
  const stateThrough=firstUnreleased?firstUnreleased.sequence-1:frontier;
  const state=stateThrough?replayCanonicalEvents(events.filter(e=>e.sequence<=stateThrough)):createEmptyProjection(game.id);
  const dialogue=messages.filter(m=>reachedTranscripts.has(String(m.id)) || m.firstDurableEventSequence!==null && eligible(m.firstDurableEventSequence) && !catalog.moments.some(c=>c.source.kind==='influence-transcript'&&c.source.transcriptId===String(m.id)));
  const knownDecisionIds=new Set(dialogue.map(m=>m.decisionId).filter(Boolean));
  const thinking=data.cognition.filter(row=>row.eventSequence!==null && eligible(row.eventSequence) && (!row.decisionId || knownDecisionIds.has(row.decisionId) || !messages.some(m=>m.decisionId===row.decisionId))).map(row=>({id:row.id,eventSequence:row.eventSequence,actorId:row.actorPlayerId,kind:row.artifactType,action:row.action,payload:row.payload}));
  return {schemaVersion:1,game:{id:game.id,slug:game.slug,kind:'influence'},position:p,visibility:'omniscient',rules:followJson(getGameMcpRules('influence')),roster:followJson(data.roster) as GameFollowKnowledge['roster'],
    state:followJson({throughEventSequence:stateThrough,projection:state}),current:followJson({moment:current,facts:current?.source.kind==='influence-event'?influenceFollowPartial(eventMap.get(current.source.eventSequence)!,reached.filter(m=>m.source.kind==='influence-event'&&current.source.kind==='influence-event'&&m.source.eventSequence===current.source.eventSequence).map(m=>m.part)):[]}),history:followJson([...releasedEvents.map(event=>({kind:'event',event})),...dialogue.map(message=>({kind:'dialogue',message}))]) as GameFollowKnowledge['history'],thinking:followJson(thinking) as GameFollowKnowledge['thinking']};
}

export async function readWerewolfFollow(db:ReadDB,game:HouseGame,p:Extract<GameFollowPosition,{kind:'werewolf'}>):Promise<GameFollowKnowledge> {
  const events=await readWerewolfEvents(db,game.id);
  const projection=projectWerewolfProductionWatch(events,p.audience);
  const start=events.find(event=>event.type==='werewolf.started');
  const roster=start?.payload.players.map(({strategy,...player})=>({...player,...(p.audience==='omniscient'?{strategy}:{})}))??[];
  const provenance=projectWerewolfProductionProvenance(events,p.audience);
  const thoughts=p.audience==='omniscient' && p.cursor>0?(await readWerewolfProductionThinking(db,game.id,'omniscient',p.cursor,{includeHidden:true})).entries:[];
  const catalog=assembleProductionCatalog({gameId:game.id,gameKind:'werewolf',audience:p.audience,sources:buildWerewolfProductionSources({gameId:game.id,audience:p.audience,moments:projection.moments,provenance,thoughts:[],opening:true})});
  const sequence=provenance.find(row=>row.cursor===p.cursor)?.eventSequence;
  if(p.cursor>0 && !sequence)return invalid('Unknown Werewolf playback cursor');
  if(p.cursor===0&&p.part.kind!=='opening')return invalid('Opening requires an opening position');
  const index=p.cursor===0?-1:selectedIndex(catalog.moments,productionMomentKey(game.id,{kind:'werewolf-event',eventSequence:sequence!},p.part));
  const reached=catalog.moments.slice(0,index+1);
  const active=projection.moments.find(m=>m.cursor===p.cursor);
  const currentMoments=reached.filter(m=>m.source.kind==='werewolf-event'&&m.source.eventSequence===sequence);
  const complete=!!active && (['speech','discussion','conversation','ballot','proposal','phase','result'].includes(active.entry.kind)||currentMoments.some(m=>['outcome','result','pack_vote'].includes(m.part.kind)));
  const throughCursor=complete?p.cursor:Math.max(0,p.cursor-1);
  const frames=[...walkWerewolfHistory(events,p.audience)];
  const frame=throughCursor?frames.find(f=>f.entry&&f.cursor===throughCursor):frames[0];
  const snapshot=frame?projectWerewolfSnapshot(frame.state,p.audience,throughCursor):null;
  // Mystery never carries role knowledge, including after the game outcome.
  const state=snapshot&&p.audience==='mystery'?{...snapshot,players:snapshot.players.map(({role:_role,...player})=>player)}:snapshot;
  const partial:unknown[]=[];
  if(active&&!complete) for(const m of currentMoments) {
    if(m.part.kind==='ballot' && (active.entry.kind==='vote'||active.entry.kind==='pack_vote'))partial.push({kind:'ballot',ballot:active.entry.result.ballots.find(b=>b.voterId===m.actorId)});
    else if(m.part.kind==='tally'&&active.entry.kind==='vote')partial.push({kind:'tally',ballots:active.entry.result.ballots,totals:active.entry.result.totals,requiredVotes:active.entry.result.requiredVotes});
    else {const kind=m.part.kind==='night-speech'?m.part.action:m.part.kind;const action=active.night?.actions.find(a=>a.kind===kind);if(action)partial.push({kind:'night-action',action:m.part.kind==='night-speech' && action.kind==='investigate'?{kind:action.kind,actorId:action.actorId,targetId:action.targetId,speech:action.speech}:action});}
  }
  const allowedActions=new Set<string>(currentMoments.flatMap(m=>m.part.kind==='night-speech'?[m.part.action]:[m.part.kind]));
  const thinking=thoughts.filter(t=>t.cursor<=throughCursor || t.cursor===p.cursor && (complete || allowedActions.has(t.action==='protect'?'protect':t.action==='investigate'?'investigate':t.action==='attack'?'hunt':t.action==='vote'?'ballot':t.action)) && (t.action!=='vote'||currentMoments.some(m=>m.part.kind==='ballot'&&m.actorId===t.actorId)));
  return {schemaVersion:1,game:{id:game.id,slug:game.slug,kind:'werewolf'},position:p,visibility:followVisibility(p),rules:followJson({rules:getGameMcpRules('werewolf'),config:start?.payload.config}),roster:followJson(roster) as GameFollowKnowledge['roster'],state:followJson(state),current:followJson({cursor:p.cursor,part:p.part,actions:partial}),history:followJson(projection.moments.filter(m=>m.cursor<=throughCursor).map(m=>({cursor:m.cursor,entry:m.entry,...(p.audience==='omniscient'&&m.night?{actions:m.night.actions}:{})}))) as GameFollowKnowledge['history'],thinking:followJson(thinking) as GameFollowKnowledge['thinking']};
}

export async function readGameFollowContext(db:DrizzleDB,id:string,input:unknown) {
  const p=position(input);
  return db.transaction(async tx=>{
    const game=await resolveHouseSpectatorGame(tx,id);
    if(game.gameKind!==p.kind)return invalid('Playback position belongs to another game kind');
    const adapters:{[K in GameFollowPosition['kind']]:GameFollowAdapter<Extract<GameFollowPosition,{kind:K}>>}={
      influence:{read:async position=>projectInfluenceFollow(await loadInfluenceFollowData(tx,game),position)},
      werewolf:{read:position=>readWerewolfFollow(tx,game,position)},
    };
    switch(p.kind){case 'influence':return adapters.influence.read(p);case 'werewolf':return adapters.werewolf.read(p);}
    const unsupported:never=p;return invalid(`Unsupported follow position: ${unsupported}`);
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}
