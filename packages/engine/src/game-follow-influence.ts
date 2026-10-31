import type {CanonicalGameEvent} from './canonical-events';
import type {ProductionMomentPart} from './production-moments';
import {followJson,type FollowJson} from './game-follow';

/** Facts released inside a composite canonical event. Never ship its complete
 * outcome merely because the first ballot/action in that event is playing. */
export function influenceFollowPartial(event:CanonicalGameEvent,parts:readonly ProductionMomentPart[]):FollowJson[] {
 const facts:FollowJson[]=[];
 for(const part of parts){
  if(part.kind!=='influence-presentation')continue;
  const p=part.presentation;
  if(event.type==='format.selected')facts.push(followJson(event.payload));
  else if(event.type==='format.two_names_setup'){
   facts.push(followJson({empoweredId:event.payload.empoweredId,
    ...(p.kind!=='two_names_empowered_intro'?{initialNomineeIds:event.payload.initialNomineeIds}:{}),
    ...(p.kind==='two_names_override_draw'?{overrideHolderId:event.payload.overrideHolderId}:{})}));
  }else if(event.type==='vote.empower_tally_resolved'&&p.kind==='ballot_tally')facts.push(followJson({counts:event.payload.counts}));
  else if(event.type==='format.resolved'){
   if(p.kind==='ballot_tally'||p.kind==='format_aggregate')facts.push(followJson({formatId:event.payload.formatId,
    aggregate:event.payload.aggregate,tiedPlayerIds:event.payload.tiedPlayerIds}));
   if(p.kind==='format_tiebreak')facts.push(followJson({tiebreakerId:event.payload.tiebreakerId}));
   if(p.kind==='format_deciding_vote')facts.push(followJson({tiebreakerId:event.payload.tiebreakerId,chosenPlayerId:event.payload.eliminatedId}));
  }else if(event.type==='endgame.elimination_resolved'){
   if(p.kind==='endgame_ballot'&&p.juryTiebreaker)facts.push(followJson({voterId:p.voterId,targetId:event.payload.juryTiebreakerVotes?.[p.voterId]}));
   if(p.kind==='ballot_tally')facts.push(followJson(p.juryTiebreaker?{votes:event.payload.juryTiebreakerVotes}:{tally:event.payload.tally}));
  }else if(event.type==='jury.winner_determined'&&p.kind==='ballot_tally')facts.push(followJson({tally:event.payload.tally,voteCounts:event.payload.voteCounts}));
 }
 return facts;
}
