"use client";

import {characterImageError} from "@/components/character/image-error";
import {useState} from "react";
import type {AcceptedVisualScene} from "@influence/engine/visual-mode";
import {useSampledStage} from "@/components/watch/sampled-stage";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import {TimedSpeech} from "./timed-speech";
import {VisualSceneView, type SceneComposition} from "./visual-scene-view";
import type {PortraitRoom} from "./portrait-room";
import {portraitRoomDurationMs} from "./portrait-room-pagination";
import {DEFAULT_ROOM_BACKDROP} from "./stage-backdrop";

type RoomProps = Parameters<typeof PortraitRoom>[0];
type Player = RoomProps["beat"]["participants"][number];
type Dimensions = {width:number;height:number};

/** Presentation coordinates only; these never become accepted scenes or model observations. */
export function composeRoomCast(players: readonly Player[], images: Record<string, Dimensions>): SceneComposition {
  const columns = Math.min(4, players.length), rows = Math.ceil(players.length / columns);
  const height = Math.min(570, 660 / Math.max(1, rows) * 1.2);
  const cast = players.map((player,index) => {
    const row = Math.floor(index / columns), count = Math.min(columns, players.length - row * columns);
    const depth = rows - row - 1;
    const slot = 1440 / (count + (rows > 1 ? .5 : 0));
    const source = player.fullBodyReferenceUrl!;
    const dimensions = images[source];
    const bodyHeight = height / (1 + depth * .28);
    const width = dimensions ? Math.min(slot * .85, bodyHeight * dimensions.width / dimensions.height) : 0;
    const actualHeight = dimensions ? width * dimensions.height / dimensions.width : 0;
    // Alternate floor positions; distant rows recede toward the central vanishing point.
    const stagger = rows > 1 ? (row % 2 ? .25 : -.25) : 0;
    const center = 800 + slot * (index % columns - (count - 1) / 2 + stagger) / (1 + depth * .08);
    const frame = {left:center - width / 2,
      top:790 - depth * 170 - actualHeight, width, height:actualHeight};
    const head = player.headRectangle ?? {x:.4,y:.04,width:.2,height:.16};
    return {id:player.id,name:player.name,items:player.items,source,frame,
      head:{x:(frame.left + head.x * width)/1600,y:(frame.top + head.y * actualHeight)/900,
        width:head.width * width/1600,height:head.height * actualHeight/900}};
  });
  return {width:1600,height:900,ready:cast.every(player => images[player.source]),cast};
}

/** A DOM composite uses the exact Visual Mode camera, thought focus and speech renderer. */
export function ComposedRoom({beat, backgroundUrl = DEFAULT_ROOM_BACKDROP, onImageReady, onReadyChange, hideSpeech, paginateLargeCast, previousSpeakerId = null, ...props}: RoomProps) {
  const sampled = useSampledStage();
  const thought = useSceneThinking();
  const [missing,setMissing] = useState<string|null>(null);
  const [loaded,setLoaded] = useState<Record<string,Dimensions>>({});
  if (missing && beat.participants.some(player => player.fullBodyReferenceUrl === missing)) throw new Error(`Frozen room character image is missing: ${missing}`);
  const images = {...loaded,...sampled?.images};
  const composition = {...composeRoomCast(beat.participants,images),fitCast:Boolean(paginateLargeCast && beat.participants.length>4)};
  const scene: AcceptedVisualScene = {id:`composed:${backgroundUrl}:${beat.participants.map(player=>player.id).join(":")}`,
    roomId:"lobby",version:1,imageUrl:backgroundUrl,annotatedImageUrl:"",participantIds:beat.participants.map(player=>player.id),
    anchors:composition.cast.map((player,index) => ({playerId:player.id,label:index+1,confidence:"clear" as const,head:player.head}))};
  const actor = beat.participants.find(player => player.id === beat.speech.playerId);
  const duration=portraitRoomDurationMs(beat.speech.text,beat.participants.length);
  const roomProgress=thought ? thought.elapsedMs/Math.max(1,thought.durationMs) : Math.max(0,(props.readingElapsedMs-650)/Math.max(1,duration-1050));
  return <section aria-label={beat.roomLabel ?? "Mingle room"} data-composed-room className="relative flex min-h-0 flex-1 flex-col">
    {/* eslint-disable @next/next/no-img-element -- frozen cutouts must expose natural dimensions before shared camera layout */}
    {beat.participants.map(player => <img key={player.id} src={player.fullBodyReferenceUrl!} alt="" aria-hidden="true" data-composed-preload
      className="hidden" onError={event => void characterImageError(event,() => setMissing(player.fullBodyReferenceUrl!))} onLoad={event => {
        const {naturalWidth:width,naturalHeight:height} = event.currentTarget;
        setLoaded(previous => previous[player.fullBodyReferenceUrl!]?.width === width && previous[player.fullBodyReferenceUrl!]?.height === height
          ? previous : {...previous,[player.fullBodyReferenceUrl!]:{width,height}});
      }} />)}
    <VisualSceneView {...props} previousFocusPlayerId={previousSpeakerId} speechDurationMs={paginateLargeCast && beat.participants.length > 4 ? portraitRoomDurationMs(beat.speech.text,beat.participants.length) : undefined} scene={scene} composition={composition} focusPlayerId={beat.speech.playerId ?? undefined} focusActor={actor}
      speech={hideSpeech ? null : {...beat.speech,portrait:actor}} onReadyChange={ready => {onReadyChange?.(ready); if (ready) onImageReady?.();}} />
    <div data-room-context-label className={`pointer-events-none absolute inset-x-0 h-4 text-center text-xs font-medium text-[#e6ce9a] ${composition.fitCast ? "top-0" : "top-3"}`}>
      <TimedSpeech text={beat.roomLabel ?? `Mingle${beat.roomNumber === null ? "" : ` · Room ${beat.roomNumber}`}`} elapsedMs={props.readingElapsedMs} progress={roomProgress} pageCounter={false} className="h-full text-xs leading-4"/>
    </div>
  </section>;
}
