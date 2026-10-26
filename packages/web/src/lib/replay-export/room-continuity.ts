import type {ExportCue} from "./cues";
import {werewolfPortraitRoom} from "../../components/games/werewolf/werewolf-room-presentation";

/** Context is computed from selected pictures, never mutable React render history. */
export function exportRoomContext(cue: ExportCue | undefined) {
  if (!cue) return null;
  const p = cue.picture;
  const room = p.kind === "thinking" ? p.room && {roomNumber:p.room.number,roomLabel:p.room.label,participants:p.room.players}
    : p.kind === "werewolf" && !p.scene ? werewolfPortraitRoom(p.cue)
    : p.kind === "influence" && p.beat?.kind === "portrait-room" ? p.beat : null;
  if (!room) return null;
  return {key:JSON.stringify([room.roomNumber,room.roomLabel,room.participants.map(player => player.id)]),
    actorId:p.kind === "thinking" ? p.actor.id : cue.speech?.speakerId ?? null};
}
export function exportPreviousSpeaker(current: ExportCue, previous?: ExportCue): string | null {
  const room = exportRoomContext(current), before = exportRoomContext(previous);
  if (room) return before?.key === room.key ? before.actorId : null;
  return previous?.picture.kind === "thinking" ? previous.picture.actor.id : previous?.speech?.speakerId ?? null;
}
