import type {ProductionMoment} from "@influence/engine/production-moments";
import {werewolfHouseSpeech,werewolfNightHouseSpeech} from "@influence/engine/werewolf/house-speech";
import type {EditorialSource} from "./production-editorial-source.js";
/** Accepted text bindings only. Prose never establishes source identity or facts. */
export function productionMomentContent(source:EditorialSource,moment:ProductionMoment):{text:string|null;actorName:string|null;speakerId:string|null} {
  if ("window" in source) {
    const position=source.window.moments.find(row=>row.cursor===moment.order.anchor);
    const sequence="eventSequence" in moment.source ? moment.source.eventSequence : 0;
    const actorName=source.window.players.find(row=>row.id===moment.actorId)?.name ?? null;
    let text:string|null|undefined;
    let speakerId=moment.actorId ?? null;
    if (moment.kind === "thinking") text=source.thoughts.find(row=>row.eventSequence===sequence && row.actorId===moment.actorId)?.thinking;
    else if (moment.part.kind === "night-speech") {
      const part=moment.part;
      const action=position?.night?.actions.find(row=>row.kind===part.action && "actorId" in row && row.actorId===moment.actorId);
      if (action && action.kind !== "hunt") text=action.speech?.text;
    } else if (moment.kind === "speech" || moment.kind === "ballot") {
      const entry=position?.entry;
      if (entry?.kind === "discussion") text=entry.contribution.unavailable ? null : entry.contribution.text;
      else if (entry && "text" in entry && !("unavailable" in entry && entry.unavailable)) text=entry.text;
    } else if (position) {
      speakerId=null;
      const action=position.night?.actions.find(row=>row.kind===moment.part.kind);
      if (action && ["protect","investigate","hunt"].includes(moment.part.kind)) text=werewolfNightHouseSpeech(action,position.snapshot.players);
      else if (["scene","outcome","result","pack_vote"].includes(moment.part.kind)) text=werewolfHouseSpeech(position.entry,position.snapshot.players,position.snapshot.rulesVersion);
    }
    return {text:text?.trim() ? text:null,actorName,speakerId};
  }
  const ref=moment.source;
  const frame=ref.kind === "influence-event" ? source.frames.find(row=>row.sequence===ref.eventSequence):undefined;
  const presentation=moment.part.kind === "influence-presentation" ? moment.part.presentation:null;
  const action=presentation?.kind === "empower_ballot" ? presentation.revote ? "empower-revote":"vote"
    : presentation?.kind === "format_roll_call" ? "format-ballot"
    : presentation?.kind === "endgame_ballot" ? frame?.phase === "JURY_VOTE" ? "jury-vote" : presentation.juryTiebreaker ? "tribunal-jury-tiebreaker-vote":"endgame-elimination-vote":null;
  let message=ref.kind === "influence-transcript" ? source.messages.find(row=>String(row.id)===ref.transcriptId)
    : action ? source.messages.find(row=>row.round===frame?.round && row.decisionSpeech?.actorId===moment.actorId && row.decisionSpeech?.action===action):undefined;
  const original=message;
  if (message?.acceptedBallot && moment.kind !== "thinking") {
    const ballot=message.acceptedBallot,receipt=message.entrySequence;
    message=source.messages.find(row=>row.round===original!.round && row.phase===original!.phase && row.decisionSpeech?.actorId===ballot.voterId && receipt!==undefined && row.decisionSpeech.receiptEntrySequence===receipt);
  }
  const event=frame?.viewerDecisionEvent;
  const text=moment.kind === "thinking" ? ref.kind === "influence-event"
    ? source.acceptedThoughts.find(row=>row.eventSequence===ref.eventSequence && row.actorId===moment.actorId)?.thinking : message?.thinking
    : event?.type === "format.two_names_plea_recorded" && presentation?.kind === "two_names_plea" && event.payload.status === "accepted" ? event.payload.text
    : ["speech","scene","ballot"].includes(moment.kind) ? message?.text:undefined;
  return {text:text?.trim() ? text:null,actorName:source.game.players.find(row=>row.id===moment.actorId)?.name ?? null,speakerId:moment.actorId ?? null};
}
