/** Browser entry for the opt-in, provider-free viewer/export render comparison. */
import {useLayoutEffect, useMemo, useState} from "react";
import {Composition, registerRoot, getInputProps, useCurrentFrame, delayRender, continueRender, cancelRender} from "remotion";
import {ReplayFrame} from "../remotion/house-replay/frame";
import type {ReplayManifest} from "../lib/replay-export/manifest";
import type {ExportCue} from "../lib/replay-export/cues";
import {sampleTiming} from "../lib/replay-export/timing";
import {SceneThinkingProvider} from "../components/watch/watch-thinking";
import {VisualPresentationFrame} from "../app/games/[slug]/components/visual-presentation";
import {WerewolfWatchStage} from "../components/games/werewolf/werewolf-watch-stage";
import {werewolfWatchPolicy} from "../components/games/werewolf/werewolf-watch-model";
import {PresentationDirector} from "../components/watch/watch-director";

export type ParityProps = {manifest:ReplayManifest; reference:ExportCue; prepare?:boolean};

function ViewerFrame({manifest,reference}:ParityProps) {
  const frame = useCurrentFrame();
  const sample = sampleTiming(manifest.timeline[0]!,frame * 1000 / manifest.fps);
  const picture = reference.picture;
  const director = useMemo(() => {
    const value = new PresentationDirector({policy:werewolfWatchPolicy});
    if (picture.kind === "werewolf") value.load([picture.cue]);
    return value;
  },[picture]);
  useLayoutEffect(() => () => director.dispose(),[director]);
  const [ready] = useState(() => delayRender("Viewer comparison media/layout"));
  useLayoutEffect(() => {
    void (async () => {
      await document.fonts.ready;
      for (let pass=0;pass<3;pass++) {
        await Promise.all(Array.from(document.images).map(image => {
          image.loading = "eager";
          return image.decode();
        }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      continueRender(ready);
    })().catch(cancelRender);
  },[ready]);
  const actor = manifest.cues[0]!.picture;
  const thought = sample.thought ? {...sample.thought,speaker:actor.kind === "thinking" ? actor.actor.name : ""} : null;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
    {picture.kind === "werewolf" ? <WerewolfWatchStage cue={picture.cue} scene={picture.scene} elapsed={sample.elapsedMs}
      reduced={manifest.reducedMotion} director={{manualAdvance:()=>{},setReady:()=>{},getSnapshot:()=>director.getSnapshot(),getSpeechElapsedBaseMs:()=>sample.elapsedMs}}
      holding={false} contextLabel={reference.label} /> : picture.kind === "influence" && picture.beat ? <>
      <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60">{reference.label}</div>
      <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"><SceneThinkingProvider thought={thought}>
        <VisualPresentationFrame beat={picture.beat} rooms={picture.rooms} elapsedMs={sample.elapsedMs} reducedMotion={manifest.reducedMotion} fullscreen controlsInset={0} roster={picture.roster}/>
      </SceneThinkingProvider></div>
    </> : null}
  </div>;
}

registerRoot(() => {
  const props = getInputProps<ParityProps>();
  return <>
    <Composition id="Export" component={ReplayFrame} width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps}
      durationInFrames={props.prepare ? 2 : props.manifest.range.untilFrame} defaultProps={props}/>
    <Composition id="Viewer" component={ViewerFrame} width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps}
      durationInFrames={props.manifest.range.untilFrame} defaultProps={props}/>
  </>;
});
