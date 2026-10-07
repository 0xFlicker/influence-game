"use client";
import {useEffect, useState} from "react";
import type {WerewolfWatchCue} from "./werewolf-watch-model";
import {wolfTransformationFrame} from "./werewolf-night-motion";

/** One establishing passage before speech, using the two immutable, opaque pictures. */
export function WerewolfTransformationStage({cue, elapsed, reduced, onReady}: {cue: WerewolfWatchCue; elapsed: number; reduced: boolean; onReady: (ready: boolean) => void}) {
  const wolves = cue.transformation!.wolfIds.map(id => {
    const player = cue.moment.snapshot.players.find(player => player.id === id)!;
    return {player, original: player.fullBodyReferenceUrl ?? player.avatarUrl, wolf: cue.moment.wolfForms?.[id]};
  });
  const sources = JSON.stringify(wolves.flatMap(wolf => [wolf.original, wolf.wolf]).filter((url): url is string => Boolean(url)));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let active = true;
    const urls: string[] = JSON.parse(sources);
    const failures = new Set<string>();
    let pending = urls.length;
    onReady(pending === 0);
    const images = urls.map(url => {
      const image = new Image();
      const done = (error: boolean) => {
        if (!active) return;
        if (error) failures.add(url);
        if (--pending === 0) { setFailed(new Set(failures)); onReady(true); }
      };
      image.onload = () => done(false); image.onerror = () => done(true); image.src = url;
      return image;
    });
    return () => {active = false; for (const image of images) {image.onload = null; image.onerror = null;} };
  }, [sources, onReady]);
  return <section data-wolf-transformation className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden bg-[#111821] p-6 text-center text-white">
    <p className="shrink-0 text-xs uppercase tracking-[.25em] text-slate-300">The pack awakens</p>
    <div className="flex min-h-0 w-full max-w-3xl flex-1 items-stretch justify-center gap-5 py-5">
      {wolves.map(({player, original, wolf}, index) => {
        const frame = wolfTransformationFrame(elapsed, index, reduced);
        const canTransform = Boolean(original && wolf && !failed.has(original) && !failed.has(wolf));
        return <figure key={player.id} data-wolf-id={player.id} data-wolf-form={canTransform && frame.wolf ? "wolf" : "original"} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="relative min-h-0 flex-1" style={{transform: canTransform ? `translateY(${frame.y}px) rotate(${frame.rotate}deg) scale(${frame.scale})` : undefined}}>
            {/* eslint-disable-next-line @next/next/no-img-element -- frozen original and published derivative remain opaque rectangles */}
            {original && !failed.has(original) && <img src={original} alt={player.name} className="absolute inset-0 h-full w-full object-contain" style={{opacity: canTransform ? 1 - frame.wolfOpacity : 1}} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- only an audience-permitted published form */}
            {wolf && !failed.has(wolf) && <img src={wolf} alt={`${player.name}, werewolf form`} className="absolute inset-0 h-full w-full object-contain" style={{opacity: canTransform ? frame.wolfOpacity : original && !failed.has(original) ? 0 : 1}} />}
          </div>
          <figcaption className="shrink-0 break-words text-sm"><span className="font-semibold">{player.name}</span><span className="mt-1 block text-xs text-slate-400">Werewolf</span></figcaption>
        </figure>;
      })}
    </div>
  </section>;
}
