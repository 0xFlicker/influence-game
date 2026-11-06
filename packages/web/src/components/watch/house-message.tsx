"use client";
import {TimedSpeech} from "../../app/games/[slug]/components/timed-speech";
import {visualSpeechDurationMs,VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";

/** Shared viewer/Studio/export caption: the border crosses the logo's midpoint. */
export function HouseMessage({text, elapsedMs = 0, logoUrl = "/logo.png", progress}: {
  text:string; elapsedMs?:number; logoUrl?:string; progress?:number;
}) {
  return <div data-house-message-container className="flex h-full min-h-0 min-w-0 flex-col pt-4">
    <section aria-label="House summary" data-house-message className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-white/20 bg-black/90 px-3 pb-1 pt-5 text-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled House identity shared with encoded exports */}
      <img src={logoUrl} alt="The House" data-house-message-logo className="absolute left-1/2 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2 object-contain" />
      <TimedSpeech growToLine text={text} elapsedMs={elapsedMs} progress={progress ?? (elapsedMs-VISUAL_SPEECH_FADE_MS)/Math.max(1,visualSpeechDurationMs(text)-2*VISUAL_SPEECH_FADE_MS)} className="text-sm leading-5 sm:text-base sm:leading-6" />
    </section>
  </div>;
}
