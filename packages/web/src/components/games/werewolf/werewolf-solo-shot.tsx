"use client";

import type {ComponentProps} from "react";
import {SoloPresentation} from "@/app/games/[slug]/components/solo-presentation";
import {SOLO_IMAGE_FADE_MS} from "@/app/games/[slug]/components/solo-presentation-timing";
import {SceneThinkingProvider, useSceneThinking} from "@/components/watch/watch-thinking";
import {werewolfCueMoment, type WerewolfWatchCue} from "./werewolf-watch-model";

/** Only adjacent solo shots overlap; room scenes and ballot collection own their staging. */
function soloActor(cue?: WerewolfWatchCue) {
  if (!cue || cue.ballot || cue.transformation || cue.moment.mediaKey || cue.nightAction && !cue.nightDecision) return null;
  const moment = werewolfCueMoment(cue);
  if (!cue.nightDecision && !(cue.moment.entry.kind === "speech" && !moment.pack)) return null;
  return moment.actor?.fullBodyReferenceUrl ? moment.actor : null;
}

/** Sampled from the director clock, so pause, seek, speed and exports agree. */
export function WerewolfSoloShot({cue, previousCue, nextCue, ...props}: ComponentProps<typeof SoloPresentation> & {
  cue: WerewolfWatchCue; previousCue?: WerewolfWatchCue; nextCue?: WerewolfWatchCue;
}) {
  const thought = useSceneThinking();
  const current = soloActor(cue);
  const previous = current ? soloActor(previousCue) : null;
  const next = current ? soloActor(nextCue) : null;
  if (!current) return <SoloPresentation {...props} />;
  const ramp = (value: number) => Math.max(0, Math.min(1, value));
  const entrance = props.reducedMotion || props.paused && props.elapsedMs === 0 ? 1 : ramp(props.elapsedMs / SOLO_IMAGE_FADE_MS);
  const exit = props.reducedMotion || next ? 1 : ramp((cue.baseDurationMs - props.elapsedMs) / SOLO_IMAGE_FADE_MS);
  const outgoing = previous && previous.id !== current.id && entrance < 1 ? previous : null;
  const currentOpacity = previous ? exit : entrance * exit;
  const layers = [
    ...(outgoing ? [{player: outgoing, outgoing: true}] : []),
    {player: current, outgoing: false},
  ];
  return <div className="relative flex min-h-0 flex-1 flex-col" data-solo-dissolve>
    {layers.map(layer => <div key={layer.player.id} data-solo-layer={layer.outgoing ? "outgoing" : "current"}
      aria-hidden={layer.outgoing || undefined}
      className="absolute inset-0 flex flex-col"
      style={{opacity: layer.outgoing ? 1 : outgoing ? entrance : 1, pointerEvents: layer.outgoing ? "none" : undefined}}>
      <SceneThinkingProvider thought={layer.outgoing ? null : thought}>
        <SoloPresentation {...props} beat={layer.outgoing ? {...props.beat, player: {...layer.player, persona: ""}} : props.beat}
          hideSpeech={layer.outgoing || props.hideSpeech} reserveSpeechSpace={!props.hideSpeech} imageOpacity={layer.outgoing ? 1 : currentOpacity}
          onImageReady={layer.outgoing ? undefined : props.onImageReady} />
      </SceneThinkingProvider>
    </div>)}
  </div>;
}
