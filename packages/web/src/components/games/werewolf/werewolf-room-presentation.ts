import type {VisualPresentationBeat} from "@/app/games/[slug]/components/visual-presentation";
import {werewolfCueMoment, type WerewolfWatchCue} from "./werewolf-watch-model";
import {WEREWOLF_ROOMS} from "./werewolf-rooms";

/** Shared audience-safe room framing for the viewer, Studio and offline exports. */
export function werewolfPortraitRoom(cue: WerewolfWatchCue): Extract<VisualPresentationBeat, {kind:"portrait-room"}> | null {
  const moment = werewolfCueMoment(cue), entry = cue.moment.entry;
  if (!moment.actor || !moment.spoken || moment.retrospective || cue.ballot || cue.nightAction ||
    !(entry.kind === "discussion" || entry.kind === "conversation" || entry.kind === "proposal" || entry.kind === "speech" && moment.pack)) return null;
  return {kind:"portrait-room",roomNumber:null,
    roomLabel:moment.pack ? `Night ${cue.moment.snapshot.day} · Pack conversation` : `Day ${cue.moment.snapshot.day} · Village conversation`,
    participants:cue.moment.snapshot.players.filter(player => player.alive && (!moment.pack || player.role === "werewolf"))
      .map(player => ({id:player.id,name:player.name,avatarUrl:player.avatarUrl,personaKey:player.personaKey,persona:""})),
    speech:{id:cue.key,playerId:moment.actor.id,speaker:moment.speaker,text:moment.text}};
}
export function werewolfBackdrop(cue: WerewolfWatchCue) {
  return cue.nightAction?.kind === "protect" ? WEREWOLF_ROOMS.doctor : cue.nightAction?.kind === "investigate" ? WEREWOLF_ROOMS.seer
    : werewolfCueMoment(cue).pack ? WEREWOLF_ROOMS.pack : WEREWOLF_ROOMS.village;
}
