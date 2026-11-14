"use client";

import {useLayoutEffect, useRef, useState} from "react";
import {resolveAgentAvatarUrl} from "@/components/agent-avatar";
import {useSampledStage} from "@/components/watch/sampled-stage";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import {RoomBackdrop, DEFAULT_ROOM_BACKDROP} from "./stage-backdrop";
import {TimedSpeech} from "./timed-speech";
import {portraitRoomDurationMs, portraitRoomPage, portraitRoomPageCount, PORTRAIT_ROOM_PAGE_SIZE} from "./portrait-room-pagination";
import type {VisualPresentationBeat} from "./visual-presentation";
import {ItemBadges} from "@/components/watch/item-badges";
import {characterImageError} from "@/components/character/image-error";

/** Compact crowded rooms retain every attendee on pages sampled from the shared clock. */
export function PaginatedPortraitRoom({beat, elapsedMs, readingElapsedMs, reducedMotion, backgroundUrl, hideSpeech, onImageReady, short = false, durationMs}: {
  beat:Extract<VisualPresentationBeat,{kind:"portrait-room"}>; elapsedMs:number; readingElapsedMs:number; reducedMotion:boolean;
  backgroundUrl?:string; hideSpeech?:boolean; onImageReady?:()=>void;
  short?:boolean;
  durationMs?:number;
}) {
  const thought = useSceneThinking();
  const sampled = useSampledStage();
  const speaker = beat.participants.find(player => player.id === beat.speech.playerId);
  if (!speaker) throw new Error("Crowded room is missing its speaking contestant");
  const others = beat.participants.filter(player => player.id !== speaker.id);
  const composed=beat.participants.every(player=>player.fullBodyReferenceUrl);
  const pageSize=composed ? 7 : PORTRAIT_ROOM_PAGE_SIZE;
  const pages=composed ? Math.max(1,Math.ceil(others.length/pageSize)) : portraitRoomPageCount(beat.participants.length);
  const duration = durationMs ?? portraitRoomDurationMs(beat.speech.text, beat.participants.length);
  const page = thought ? Math.min(pages - 1, Math.floor(Math.max(0, thought.elapsedMs) / Math.max(1, thought.durationMs) * pages))
    : composed ? Math.min(pages-1,Math.max(0,Math.floor(Math.max(0,readingElapsedMs-650)/Math.max(1,duration-1050)*pages))) : portraitRoomPage(readingElapsedMs,duration,beat.participants.length);
  const visible = [speaker,...others.slice(page * pageSize,(page + 1) * pageSize)];
  const [failed,setFailed] = useState<ReadonlySet<string>>(new Set());
  const activeImage = useRef<HTMLImageElement>(null);
  const activeLabel=useRef<HTMLDivElement>(null);
  const [labelWidth,setLabelWidth]=useState(0);
  useLayoutEffect(()=>{
    const label=activeLabel.current;if(!label)return;
    const measure=()=>setLabelWidth(label.clientWidth);
    measure();const observer=new ResizeObserver(measure);observer.observe(label);return()=>observer.disconnect();
  },[composed,short,speaker.id]);
  useLayoutEffect(() => {if (activeImage.current?.complete && activeImage.current.naturalWidth > 0) onImageReady?.();},[speaker.id,failed,onImageReady]);
  const speechOpacity = elapsedMs <= 650 ? 0 : reducedMotion ? 1 : Math.max(0,Math.min(1,(elapsedMs - 650) / 200,(duration - 400 - elapsedMs) / 200));
  const text = thought?.text ?? beat.speech.text;
  const roomName = beat.roomLabel ?? "Mingle";
  const roomProgress = thought ? thought.elapsedMs / Math.max(1,thought.durationMs)
    : Math.max(0,(readingElapsedMs - 650) / Math.max(1,duration - 1050));
  const progress = thought ? thought.elapsedMs / Math.max(1,thought.durationMs)
    : sampled?.speech?.text === text ? undefined : Math.max(0,(readingElapsedMs - 850) / Math.max(1,duration - 1450));
  return <section data-portrait-room data-composed-room={composed || undefined} data-paginated-portrait-room data-cast-page={page} data-cast-pages={pages} aria-label={beat.roomLabel ?? "Mingle room"}
    className="relative isolate flex min-h-0 w-full flex-1 flex-col overflow-hidden">
    <RoomBackdrop source={backgroundUrl ?? DEFAULT_ROOM_BACKDROP} />
    <div data-room-context-label aria-label={roomName} className="absolute left-3 top-0.5 z-10 flex h-11 w-[calc(100%-12rem)] min-w-0 text-left text-white/70">
      <TimedSpeech text={roomName} elapsedMs={readingElapsedMs} progress={roomProgress} className="text-sm font-medium uppercase leading-4" />
    </div>
    <div className="relative grid min-h-0 flex-1 grid-cols-2 gap-2 px-3 pb-2 pt-12">
      <div data-speech-bubble className="flex min-h-0 flex-col rounded-xl border-2 border-white/60 bg-black/90 p-2 text-white" style={{opacity:thought ? thought.opacity : hideSpeech ? 0 : speechOpacity}}>
        <p className="shrink-0 break-words text-sm font-semibold leading-4">{thought ? `${speaker.name} thinks` : beat.speech.speaker}</p>
        {thought?.roleLabel && <p data-thinking-role className="shrink-0 text-sm leading-4 text-amber-200">{thought.roleLabel}</p>}
        <TimedSpeech advancePart={thought ? "thinking" : "speech"} text={text} elapsedMs={readingElapsedMs} progress={progress} progressDurationMs={thought ? thought.durationMs : Math.max(1,duration - 1450)} className="mt-1 text-sm leading-5" />
      </div>
      <div className={composed ? "grid min-h-0 grid-cols-2 gap-1" : "flex min-h-0 flex-col justify-center gap-1"} style={composed ? {gridTemplateRows:`repeat(${Math.ceil(visible.length/2)}, minmax(0,1fr))`} : undefined} aria-label={`Cast page ${page + 1} of ${pages}`}>
        {visible.map(player => {
          const saved = composed ? player.fullBodyReferenceUrl! : resolveAgentAvatarUrl(player.avatarUrl,player.persona,player.name,player.personaKey);
          if(composed && failed.has(saved))throw new Error(`Frozen room character image is missing: ${saved}`);
          const source = failed.has(saved) ? resolveAgentAvatarUrl(null,player.persona,player.name,player.personaKey) : saved;
          return <div key={player.id} data-room-player={player.id} data-active-speaker={player.id === speaker.id} className={composed ? `flex min-h-0 items-center gap-0.5 rounded-lg bg-black/60 px-0.5 ${short ? "" : "flex-col"}` : "flex min-h-0 items-center gap-1 rounded-lg bg-black/75 p-1"}>
            {/* eslint-disable-next-line @next/next/no-img-element -- frozen cast portrait with deterministic fallback */}
            <img ref={player.id === speaker.id ? activeImage : undefined} src={source} alt={player.name} onLoad={player.id === speaker.id ? onImageReady : undefined}
              onError={event => composed ? void characterImageError(event,()=>setFailed(previous=>new Set(previous).add(saved))) : setFailed(previous => new Set(previous).add(saved))}
              className={composed ? short ? "h-7 w-4 shrink-0 object-contain" : "min-h-0 w-full flex-1 object-contain" : "h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-white/40"} />
            {composed ? <div ref={player.id===speaker.id ? activeLabel : undefined} data-room-player-name={player.id} data-composed-item-player={player.items?.length ? player.id : undefined} className={`flex h-8 min-h-0 min-w-0 items-center gap-0.5 text-sm leading-4 text-white ${short ? "flex-1" : "w-full shrink-0"}`} aria-label={player.name}>
              <TimedSpeech text={player.name} elapsedMs={readingElapsedMs} progress={roomProgress} pageCounter={false} className="h-full min-w-0 text-sm leading-4"/><ItemBadges items={player.items} compact/>
            </div> : <p className="flex min-w-0 items-center gap-1.5 break-words text-xs leading-4 text-white"><span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{player.name}</span><ItemBadges items={player.items} compact /></p>}
          </div>;
        })}
        {!composed && <p className="text-right text-xs text-white/65" aria-label={`Cast page ${page + 1} of ${pages}`}>{page + 1} / {pages}</p>}
      </div>
    </div>
    {composed && sampled?.capturePages && labelWidth>0 && <div aria-hidden="true" className="pointer-events-none invisible fixed left-[-10000px] top-0" style={{width:labelWidth}}>
      {/* Prepare every frozen name, including attendees on later cast pages. */}
      {beat.participants.map(player=><div key={player.id} className="flex h-8 min-w-0 items-center gap-0.5 text-sm leading-4">
        <TimedSpeech text={player.name} elapsedMs={0} pageCounter={false} className="h-full min-w-0 text-sm leading-4"/><ItemBadges items={player.items} compact/>
      </div>)}
    </div>}
  </section>;
}
