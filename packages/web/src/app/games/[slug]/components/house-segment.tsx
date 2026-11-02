import { visualSpeechDurationMs } from "@influence/engine/visual-speech";
import { HouseMessage } from "@/components/watch/house-message";

/** All motion is sampled from the presentation director's clock. */
export function houseSegmentMotion(elapsedMs: number, durationMs: number, readable: boolean, reducedMotion: boolean) {
  if (elapsedMs >= durationMs) return { opacity: 0, transform: "none" };
  if ((readable && elapsedMs === 0) || reducedMotion) return { opacity: 1, transform: "none" };
  const entrance = Math.min(1, Math.max(0, elapsedMs / 300));
  const exit = Math.min(1, Math.max(0, (durationMs - elapsedMs) / 300));
  return { opacity: Math.min(entrance, exit), transform: `translateY(${(1 - entrance) * 12}px)` };
}

export function HouseSegment({ text, title, elapsedMs, paused, reducedMotion, fullscreen = false, logoUrl = "/logo.png" }: {
  logoUrl?: string;
  fullscreen?: boolean;
  text: string | null;
  title?: string;
  elapsedMs: number;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const duration = text === null ? 2000 : visualSpeechDurationMs(text);
  const motion = houseSegmentMotion(elapsedMs, duration, paused, reducedMotion);
  if (text !== null) return <section aria-label="House narration" data-house-segment="summary" className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 items-center px-4" style={motion}>
    <div className="h-[clamp(120px,28vh,220px)] w-full"><HouseMessage text={text} elapsedMs={elapsedMs} logoUrl={logoUrl} /></div>
  </section>;
  return <section aria-label={text === null ? `House transition: ${title}` : "House summary"}
    data-house-segment={text === null ? "transition" : "summary"}
    className={`relative isolate mx-auto grid min-h-0 w-full max-w-3xl flex-1 grid-rows-2 px-4 text-center ${fullscreen ? "" : "sm:px-8"}`} style={motion}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_50%,rgba(190,149,63,0.10),transparent_65%)]" />
    <div data-house-logo className="flex min-h-0 flex-col items-center justify-end pb-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- the existing House brand asset */}
      <img src={logoUrl} alt="The House" className="min-h-0 max-h-full w-40 object-contain mix-blend-screen sm:w-48" />
    </div>
    <div data-house-copy className="flex min-h-0 flex-col items-center pt-4">
      <h2 className="text-2xl font-medium tracking-wide text-[#e6ce9a] sm:text-4xl">{title}</h2>
    </div>
  </section>;
}
