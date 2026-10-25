import {werewolfPortraitRoom, werewolfBackdrop} from "../../components/games/werewolf/werewolf-room-presentation";
import type {ExportCue, ExportPicture} from "./cues";
import {compileTiming, type TimingProfile, type CompiledTiming} from "./timing";
import {compileAudio, type AudioSchedule} from "./audio";
import type {CachedAsset} from "./assets";
import {SOLO_READ_START_MS} from "../../app/games/[slug]/components/solo-presentation-timing";

export interface PresentationMoment {
  id: string;
  /** One opening may contain several authored shots; no shot is separately selectable. */
  segments: readonly ExportCue[];
}
export interface CompiledPresentation {
  momentIds: string[];
  moments: {id: string; startFrame: number; contentFrame: number; endFrame: number; sourceOrder: number}[];
  cues: ExportCue[];
  timeline: CompiledTiming[];
  audio: AudioSchedule;
}

/** Extract framing context, never an omitted speech response, into a private thought shot. */
export function thinkingPicture(cue: ExportCue, actorId = cue.speech?.speakerId): Extract<ExportPicture, {kind:"thinking"}> {
  const picture = cue.picture;
  if (!actorId) throw new Error(`Thinking has no accepted actor: ${cue.timing.key}`);
  const sourceElapsedMs = cue.timing.speech?.showAtMs ?? 650;
  if (picture.kind === "werewolf") {
    const actor = picture.cue.moment.snapshot.players.find(player => player.id === actorId);
    if (!actor) throw new Error(`Thinking actor is absent from source roster: ${actorId}`);
    const room = werewolfPortraitRoom(picture.cue);
    return {kind:"thinking",gameKind:"werewolf",actor:{id:actor.id,name:actor.name,persona:"",
      avatarUrl:actor.avatarUrl,fullBodyReferenceUrl:actor.fullBodyReferenceUrl,
      personaKey:actor.personaKey,headRectangle:actor.headRectangle}, roleLabel:picture.cue.moment.snapshot.audience === "omniscient" ? actor.role ?? undefined : undefined,
      // Ballots use the voting set even when their accepted action has village imagery.
      scene:picture.cue.ballot ? null : picture.scene,sourceElapsedMs,backgroundUrl:werewolfBackdrop(picture.cue),
      ...(!picture.scene && room && {room:{number:room.roomNumber,label:room.roomLabel,players:room.participants,backgroundUrl:werewolfBackdrop(picture.cue),floorPerspective:true}})};
  }
  if (picture.kind !== "influence") throw new Error("This presentation cannot own a thought");
  const beat = picture.beat;
  const rosterActor = picture.roster.find(player => player.id === actorId);
  const actor = beat?.kind === "portrait" && beat.player.id === actorId ? beat.player
    : beat?.kind === "portrait-room" ? beat.participants.find(player => player.id === actorId) ?? rosterActor : rosterActor;
  if (!actor) throw new Error(`Thinking actor is absent from source roster: ${actorId}`);
  return {kind:"thinking",gameKind:"influence",actor:{...actor,persona:actor.persona ?? ""},sourceElapsedMs,
    scene:beat?.kind === "scene" ? picture.rooms.find(scene => scene.id === beat.sceneId) ?? null : null,
    ...(beat?.kind === "portrait-room" && {room:{number:beat.roomNumber,label:beat.roomLabel,players:beat.participants}})};
}

export function thinkingSegment(cue: ExportCue, id: string, text: string, actorId?: string): ExportCue {
  if (!text.trim()) throw new Error(`Empty thinking moment: ${id}`);
  const picture = thinkingPicture(cue, actorId);
  return {momentId:id,label:cue.label,source:cue.source,picture,speech:null,music:cue.music,
    timing:{key:id,kind:"thinking",baseDurationMs:1,speech:null,thinking:text,sourceElapsedMs:picture.sourceElapsedMs,...(picture.room && {thinkingEstablishMs:650})}};
}

/** The complete game-owned source is projected before this presentation-only selection. */
export function compilePresentation(input: {
  source: readonly PresentationMoment[];
  selectedIds: readonly string[];
  profile: TimingProfile;
  fps: number;
  assets: Record<string, CachedAsset>;
  music: boolean;
  volume?: number;
}): CompiledPresentation {
  const byId = new Map(input.source.map((moment,sourceOrder) => [moment.id,{moment,sourceOrder}]));
  if (byId.size !== input.source.length) throw new Error("Duplicate presentation moment");
  const selected = new Set(input.selectedIds);
  if (selected.size !== input.selectedIds.length) throw new Error("Duplicate selected moment");
  for (const id of selected) if (!byId.has(id)) throw new Error(`Unknown selected moment: ${id}`);
  const ordered = input.source.filter(moment => selected.has(moment.id));
  if (ordered.some((moment,index) => moment.id !== input.selectedIds[index]))
    throw new Error("Selection must preserve source order");
  if (!ordered.length) return {momentIds:[],moments:[],cues:[],timeline:[],audio:{clips:[],durationMs:0}};
  const cues = ordered.flatMap(moment => {
    if (!moment.segments.length) throw new Error(`Moment has no presentation: ${moment.id}`);
    return moment.segments.map((cue,index): ExportCue => ({...cue,momentId:moment.id,
      timing:{...cue.timing,key:moment.segments.length === 1 ? moment.id : `${moment.id}:segment:${index}`}}));
  });
  const segmentKeys = new Set(cues.map(cue => cue.timing.key));
  const sourceIds = new Set(input.source.map(moment => moment.id));
  const keysByMoment = new Map<string,string[]>();
  for (const cue of cues) {
    const keys = keysByMoment.get(cue.momentId!) ?? [];
    keys.push(cue.timing.key);keysByMoment.set(cue.momentId!,keys);
  }
  const overrides = Object.fromEntries(Object.entries(input.profile.overrides).flatMap(([key,value]) => {
    if (!sourceIds.has(key) && !segmentKeys.has(key)) throw new Error(`Unresolved timing override: ${key}`);
    return (keysByMoment.get(key) ?? (segmentKeys.has(key) ? [key] : [])).map(segmentKey => [segmentKey,value]);
  }));
  const profile = {...input.profile,overrides};
  const timeline = compileTiming(cues.map(cue => cue.timing),profile,input.fps);
  const audio = compileAudio(cues,timeline,input.assets,profile,input.music,input.volume);
  let segmentOffset = 0;
  const moments = ordered.map(moment => {
    const first = segmentOffset;
    segmentOffset += moment.segments.length;
    const timing = timeline[first]!;
    // Inspect the first readable page, after camera/text entrance. Silent
    // shots use a settled point; ballots land after the current vote reveals.
    const contentMs = timing.thought ? timing.thought.insertAt + timing.thought.readAtMs
      : timing.speech ? timing.speech.readAtMs
      : (timing.endMs - timing.startMs) * (cues[first]!.timing.kind === "ballot" ? SOLO_READ_START_MS / cues[first]!.timing.baseDurationMs : .5);
    const contentFrame = Math.max(timing.startFrame, Math.min(timing.endFrame - 1, Math.ceil((timing.startMs + contentMs) * input.fps / 1000)));
    return {id:moment.id,startFrame:timing.startFrame,contentFrame,endFrame:timeline[segmentOffset-1]!.endFrame,
      sourceOrder:byId.get(moment.id)!.sourceOrder};
  });
  return {momentIds:ordered.map(moment => moment.id),moments,cues,timeline,audio};
}

/** Navigation survives an edit without storing a mutable array position. */
export function retainPresentationAnchor(source: readonly PresentationMoment[], compiled: CompiledPresentation,
  anchor: {momentId: string; offsetFrames: number} | {momentId: string; at: "content"} | null): number | null {
  if (!compiled.moments.length) return null;
  const surviving = anchor && compiled.moments.find(moment => moment.id === anchor.momentId);
  if (surviving) return "at" in anchor ? surviving.contentFrame : surviving.startFrame + Math.max(0,Math.min(anchor.offsetFrames,surviving.endFrame-surviving.startFrame-1));
  const oldOrder = anchor ? source.findIndex(moment => moment.id === anchor.momentId) : -1;
  return (compiled.moments.find(moment => moment.sourceOrder > oldOrder) ?? compiled.moments.at(-1))!.startFrame;
}
