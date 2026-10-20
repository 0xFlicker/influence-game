import type {InfluenceProductionPresentation,ProductionMomentPart,ProductionSourceReference} from "@influence/engine/production-moments";
import type {PresentationCue} from "../../app/games/[slug]/components/types";
import type {TranscriptEntry} from "../api";

/** Bind explicit cue provenance, never a generated cursor/key or rendered prose. */
export function influenceProductionReference(cue:PresentationCue,findCue:(key:string)=>PresentationCue|undefined,
  messageFor:(cue:PresentationCue)=>TranscriptEntry|undefined):{source:ProductionSourceReference;part:ProductionMomentPart} {
  if (cue.source === "opening") throw new Error("Editorial opening shots have no canonical production reference");
  if (cue.source === "house") {
    const following = findCue(cue.followingCueKey);
    if (!following) throw new Error("House bridge is missing its accepted following presentation");
    const next = influenceProductionReference(following,findCue,messageFor);
    if (next.source.kind === "influence-bridge") throw new Error("Nested House bridge");
    return {source:{kind:"influence-bridge",following:next.source,followingPart:next.part},part:{kind:"bridge"}};
  }
  if (cue.source === "classic") {
    const message = messageFor(cue);
    if (!message) throw new Error("Transcript presentation is missing its accepted source");
    return {source:{kind:"influence-transcript",transcriptId:String(message.id)},part:message.acceptedBallot
      ? {kind:"ballot",voterId:message.acceptedBallot.voterId,purpose:message.acceptedBallot.purpose,juryTiebreaker:false,revote:false}
      : {kind:message.speakerPlayerId || message.fromPlayerId || message.anonymous ? "speech" : "scene"}};
  }
  let presentation:InfluenceProductionPresentation;
  if (cue.source === "endgame") {
    presentation = cue.voteSummary && cue.ballot
      ? {kind:"ballot_tally",purpose:cue.ballot.purpose,revote:false,juryTiebreaker:cue.ballot.juryTiebreaker}
      : cue.ballot ? {kind:"endgame_ballot",voterId:cue.ballot.voterId,juryTiebreaker:cue.ballot.juryTiebreaker}
      : {kind:cue.kind === "endgame_winner" ? "endgame_winner" : "endgame_elimination"};
  } else if (cue.voteSummary) presentation = {kind:"ballot_tally",purpose:cue.visualBallot ? "empower" : "format",revote:cue.visualBallot?.revote ?? false,juryTiebreaker:false};
  else if (cue.visualBallot) presentation = {kind:"empower_ballot",voterId:cue.visualBallot.voterId,revote:cue.visualBallot.revote ?? false};
  else if (cue.kind === "format_roll_call") presentation = {kind:cue.kind,voterId:cue.ballot.voterId};
  else if (cue.kind === "format_selected") presentation = {kind:cue.kind,stage:cue.stage};
  else if (cue.kind === "two_names_mingle_complete") presentation = {kind:cue.kind,window:cue.window};
  else presentation = {kind:cue.kind};
  return {source:{kind:"influence-event",eventSequence:cue.canonicalSequence},part:{kind:"influence-presentation",presentation}};
}
