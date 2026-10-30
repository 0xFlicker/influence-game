import type {GameFollowPosition} from '@influence/engine/game-follow';
import type {ProductionMomentPart} from '@influence/engine/production-moments';
import {isOpeningCue,type WerewolfPlaybackCue} from './werewolf-opening';

export function werewolfFollowPosition(cue:WerewolfPlaybackCue|null|undefined,audience:'mystery'|'omniscient'):GameFollowPosition|null {
  if(!cue)return null;
  if(isOpeningCue(cue))return {kind:'werewolf',audience,cursor:0,part:{kind:'opening'}};
  let part:ProductionMomentPart;
  // The closing reprise follows the last retrospective speech at the same cursor.
  if(cue.reprise)part={kind:'speech'};
  else if(cue.nightDecision&&cue.nightAction&&cue.nightAction.kind!=='hunt')part={kind:'night-speech',action:cue.nightAction.kind};
  else if(cue.nightAction)part={kind:cue.nightAction.kind};
  else if(cue.ballot)part=cue.ballot.complete?{kind:'tally'}:{kind:'ballot',voterId:cue.ballot.current.voterId,purpose:'day',revote:false,juryTiebreaker:false};
  else switch(cue.moment.entry.kind){
    case 'phase':part={kind:'scene'};break;
    case 'vote':case 'night':part={kind:'outcome'};break;
    case 'pack_vote':part={kind:'pack_vote'};break;
    case 'result':part={kind:'result'};break;
    default:part={kind:'speech'};
  }
  return {kind:'werewolf',audience,cursor:cue.moment.cursor,part};
}
