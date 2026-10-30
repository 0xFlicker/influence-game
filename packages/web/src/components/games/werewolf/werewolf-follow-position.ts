import type {GameFollowPosition} from '@influence/engine/game-follow';
import type {ProductionMomentPart} from '@influence/engine/production-moments';
import {werewolfCueMoment} from './werewolf-watch-model';
import {werewolfPlaybackPolicy} from './werewolf-opening';
import type {PresentationDirector} from '@/components/watch/watch-director';
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

/** A quiet gap inside the night -> day announcement is not a commentary break.
 * Use canonical cue kinds and the recorded director clock, never caption text. */
export function werewolfCommentaryReady(director:Pick<PresentationDirector<WerewolfPlaybackCue>,'getActiveCue'|'getSnapshot'|'getElapsedBaseMs'>):boolean {
  const cue=director.getActiveCue();
  if(!cue||isOpeningCue(cue)||cue.reprise)return true;
  if(cue.moment.entry.kind==='night'&&!cue.nightAction)return false;
  if(!werewolfCueMoment(cue).house)return true;
  const speech=werewolfPlaybackPolicy.speech(cue);
  return !speech||director.getSnapshot().waitingAtTail||director.getElapsedBaseMs()>=speech.hideAtMs;
}

export function werewolfPlaybackConcluded(cue:WerewolfPlaybackCue|null,status:string|undefined):boolean {
  return status==='completed'&&!!cue&&!isOpeningCue(cue)&&cue.reprise===true;
}
