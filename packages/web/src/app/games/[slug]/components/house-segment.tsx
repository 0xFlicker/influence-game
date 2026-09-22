import { TimedSpeech } from "./timed-speech";
import { visualSpeechDurationMs } from "@influence/engine/visual-speech";

/** All motion is sampled from the presentation director's clock. */
export function houseSegmentMotion(elapsedMs: number, durationMs: number, readable: boolean, reducedMotion: boolean) {
  if (readable || reducedMotion || elapsedMs >= durationMs) return { opacity: 1, transform: "none" };
  const entrance = Math.min(1, Math.max(0, elapsedMs / 300));
  const exit = Math.min(1, Math.max(0, (durationMs - elapsedMs) / 300));
  return { opacity: Math.min(entrance, exit), transform: `translateY(${(1 - entrance) * 12}px)` };
}

export function HouseSegment({ text, title, elapsedMs, paused, reducedMotion, fullscreen = false }: {
  fullscreen?: boolean;
  text: string | null;
  title?: string;
  elapsedMs: number;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const duration = text === null ? 2000 : visualSpeechDurationMs(text);
  const motion = houseSegmentMotion(elapsedMs, duration, paused, reducedMotion);
  return <section aria-label={text === null ? `House transition: ${title}` : "House summary"}
    data-house-segment={text === null ? "transition" : "summary"}
    className={`relative isolate mx-auto grid min-h-0 w-full max-w-3xl flex-1 grid-rows-2 px-4 text-center ${fullscreen ? "" : "sm:px-8"}`} style={motion}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_50%,rgba(190,149,63,0.10),transparent_65%)]" />
    <div data-house-logo className="flex min-h-0 flex-col items-center justify-end pb-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- the existing House brand asset */}
      <img src="/logo.png" alt="The House" className="min-h-0 max-h-full w-40 object-contain mix-blend-screen sm:w-48" />
    </div>
    <div data-house-copy className="flex min-h-0 flex-col items-center pt-4">
      {text === null
        ? <h2 className="text-2xl font-medium tracking-wide text-[#e6ce9a] sm:text-4xl">{title}</h2>
        : <TimedSpeech text={text} elapsedMs={elapsedMs} className="w-full text-left text-lg leading-relaxed text-[#f0eade] sm:text-2xl" />}
    </div>
  </section>;
}
