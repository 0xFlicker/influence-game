import {test,expect} from 'bun:test';
import {completedCurrentWerewolfFixture} from '@influence/engine/fixtures/werewolf-results';
import {projectWerewolfProductionWatch,projectWerewolfProductionProvenance} from '@influence/engine/werewolf/watch';
import {buildWerewolfProductionSources} from '@influence/engine/production-moments/werewolf-source';
import {assembleProductionCatalog,productionMomentKey} from '@influence/engine/production-moments';
import {werewolfMomentCues} from '../components/games/werewolf/werewolf-watch-model';
import {werewolfFollowPosition} from '../components/games/werewolf/werewolf-follow-position';

test('every current Werewolf playback cue maps to its canonical audience action',async()=>{
 const id='current-follow-contract',events=await completedCurrentWerewolfFixture(id,11);
 for(const audience of ['mystery','omniscient'] as const){
  const projection=projectWerewolfProductionWatch(events,audience),provenance=projectWerewolfProductionProvenance(events,audience);
  const catalog=assembleProductionCatalog({gameId:id,gameKind:'werewolf',audience,sources:buildWerewolfProductionSources({gameId:id,audience,moments:projection.moments,provenance,thoughts:[],opening:true})});
  for(const moment of projection.moments)for(const cue of werewolfMomentCues(moment)){
   const p=werewolfFollowPosition(cue,audience);if(p?.kind!=='werewolf')throw new Error('Missing Werewolf position');
   const sequence=provenance.find(row=>row.cursor===p.cursor)!.eventSequence;
   expect(catalog.moments.some(m=>m.id===productionMomentKey(id,{kind:'werewolf-event',eventSequence:sequence},p.part))).toBe(true);
  }
 }
});
