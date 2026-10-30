import {expect,test} from 'bun:test';
import {influenceFollowPartial} from '../game-follow-influence';
import {Phase} from '../types';
import type {CanonicalGameEvent} from '../canonical-events';
const base={gameId:'follow',sequence:20,round:1,phase:Phase.FORMAT_RESOLVE,timestamp:'2026-10-29T00:00:00.000Z',source:'engine' as const,visibility:'system' as const,sourcePointers:[]};
test('Two Names introduction and nominees precede the override draw',()=>{
 const event={...base,type:'format.two_names_setup',payloadVersion:1,payload:{empoweredId:'a',initialNomineeIds:['b','c'],overrideHolderId:'d'}} satisfies CanonicalGameEvent;
 const intro=influenceFollowPartial(event,[{kind:'influence-presentation',presentation:{kind:'two_names_empowered_intro'}}]);
 expect(intro).toEqual([{empoweredId:'a'}]);
 const names=influenceFollowPartial(event,[{kind:'influence-presentation',presentation:{kind:'two_names_initial_names'}}]);
 expect(names).toEqual([{empoweredId:'a',initialNomineeIds:['b','c']}]);
});
test('format tally does not include the later deciding choice or elimination',()=>{
 const event={...base,type:'format.resolved',payloadVersion:2,payload:{formatId:'majority_elimination',empoweredId:'a',eliminatedId:'b',resolutionKind:'clear',tiedPlayerIds:['b','c'],tiebreakerId:'a',aggregate:{capability:'sealed_elim',totals:{b:2,c:2},eligiblePlayerIds:['a','b','c','d']}}} satisfies CanonicalGameEvent;
 const tally=influenceFollowPartial(event,[{kind:'influence-presentation',presentation:{kind:'format_aggregate'}}]);
 expect(JSON.stringify(tally)).not.toMatch(/eliminatedId|chosenPlayerId|tiebreakerId/);
 expect(influenceFollowPartial(event,[{kind:'influence-presentation',presentation:{kind:'format_deciding_vote'}}])).toEqual([{tiebreakerId:'a',chosenPlayerId:'b'}]);
});
