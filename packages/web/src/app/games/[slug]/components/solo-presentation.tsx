"use client";

import styles from "./solo-presentation.module.css";
import { useState } from "react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { TimedSpeech } from "./timed-speech";
import type { VisualPresentationBeat } from "./visual-presentation";

/** Frozen character art, never a generated talking-head clip or an inferred crop. */
export function SoloPresentation({ beat, opacity, elapsedMs }: {
  beat: Extract<VisualPresentationBeat, { kind: "portrait" }>;
  opacity: number;
  elapsedMs: number;
}) {
  const { player, speech } = beat;
  const [naturalHeight, setNaturalHeight] = useState<number>();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const fullBody = player.fullBodyReferenceUrl && failedImage !== player.fullBodyReferenceUrl ? player.fullBodyReferenceUrl : null;
  return <section aria-label={`${beat.purpose}: ${player.name}`} data-solo-image={fullBody ? "full-body" : "portrait"}
    className={`${styles.stage} mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4`}>
    <div className={`${styles.layout} min-h-0 flex-1 gap-4`}>
      <figure className={`${styles.character} relative flex min-h-0 min-w-0 items-center justify-center`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- frozen game image, with a static portrait only when full-body art is unavailable */}
        <img src={fullBody ?? resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey)} alt={player.name}
          onError={fullBody ? () => setFailedImage(fullBody) : undefined}
          className={`h-full w-full object-contain ${fullBody ? "" : "max-h-64 max-w-64"}`} />
      </figure>
      <div className={`${styles.dialogue} flex min-h-0 min-w-0 items-center justify-center`}>
        <div className="flex max-h-full min-h-0 w-full flex-col" style={{ height: naturalHeight ? naturalHeight + 92 : "100%" }}>
          <p className={`${styles.caption} mb-3 shrink-0`}><span className="block text-xs text-white/50">{beat.caption ?? beat.purpose}</span><span className="text-lg font-semibold">{player.name}</span></p>
          {opacity > 0 && <blockquote style={{ opacity }} className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-white/25 bg-black/85 px-5 py-4 text-lg leading-relaxed shadow-xl">
            <TimedSpeech text={speech.text} elapsedMs={elapsedMs} onNaturalHeight={setNaturalHeight} />
            <span aria-hidden="true" className={`${styles.tail} absolute h-4 w-4 rotate-45 !border-white/25 bg-black`} />
          </blockquote>}
        </div>
      </div>
    </div>
  </section>;
}
