"use client";
import type {CSSProperties} from "react";
import {normalizeAudioDelivery} from "@influence/engine/audio-delivery";
import type {BubbleTypography} from "./bubble-typography";
import {TimedSpeech} from "@/app/games/[slug]/components/timed-speech";
import type {SceneFrame} from "@/app/games/[slug]/components/visual-scene-layout";
import {ItemBadges} from "./item-badges";

/** Shared solo/decision speech chrome, typography, pagination, and pointer. */
export function SpeechBubble({speaker, caption, roleLabel, itemLabels, text, box, opacity, typography, padding, elapsedMs, staticSpeech = false, wrapSpeaker = false, tail}: {
  speaker:string; caption?:string; roleLabel?:string; itemLabels?:readonly string[]; text:string; box:SceneFrame; opacity:number;
  typography?:BubbleTypography | null; padding:number; elapsedMs:number; staticSpeech?:boolean; wrapSpeaker?:boolean;
  tail:{side:"left" | "top" | "bottom"; style:CSSProperties};
}) {
  return <div data-speech-bubble style={{...box,opacity,padding}} className="absolute z-[200] flex flex-col rounded-2xl border-2 border-white/60 bg-black/85 shadow-xl">
    <div className={`mb-2 shrink-0 text-base leading-5 ${typography && typography.pages.length > 1 && !typography.footerHeight ? "pr-12" : ""}`}>
      {wrapSpeaker ? <p data-speaker-name data-wrapped-speaker className="whitespace-pre-wrap break-words font-semibold leading-5">{speaker}{"\n"}<span className="text-amber-200">{roleLabel ?? caption}</span></p> : itemLabels?.length ? <>
        <p data-speaker-name className="font-semibold leading-5">{speaker}</p>
        <p className="flex h-5 items-center gap-2 text-sm"><span data-speaker-role className="text-amber-200">{roleLabel}</span><ItemBadges items={itemLabels} /><span className="text-white/50">{caption}</span></p>
      </> : <>
      <p className="flex h-5 items-baseline gap-x-2 overflow-hidden font-semibold">
        <span className="min-w-0 truncate">{speaker}</span>
        {roleLabel ? <span data-speaker-role className="shrink-0 text-amber-200">{roleLabel}</span> : <span className="shrink-0 font-normal text-white/50">{caption}</span>}
      </p>
      {roleLabel && <p className="h-5 text-white/50">{caption}</p>}
      </>}
    </div>
    <blockquote className="flex min-h-0 flex-1 flex-col">
      {staticSpeech ? <p className="break-words" style={{fontSize:typography?.fontSize,lineHeight:1.4}}>{normalizeAudioDelivery(text).cleanText}</p>
        : <TimedSpeech advancePart="speech" text={text} elapsedMs={elapsedMs} typography={typography}/>}
    </blockquote>
    <span aria-hidden="true" data-speech-tail className={`absolute h-4 w-4 rotate-45 border-white/60 bg-black ${tail.side === "left" ? "-left-2 border-l-2 border-b-2" : tail.side === "bottom" ? "-bottom-2 border-r-2 border-b-2" : "-top-2 border-l-2 border-t-2"}`} style={tail.style}/>
  </div>;
}
