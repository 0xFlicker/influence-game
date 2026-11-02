/** Deterministic actual viewer/Studio/export comparison, including DOM fit checks. */
import {useLayoutEffect,useState} from "react";
import {Artifact,Composition,registerRoot,getInputProps,useCurrentFrame,delayRender,continueRender,cancelRender,staticFile} from "remotion";
import {ReplayFrame} from "../remotion/house-replay/frame";
import type {ReplayManifest} from "../lib/replay-export/manifest";
import {cueIndexAt} from "../lib/replay-export/manifest";
import {sampleTiming} from "../lib/replay-export/timing";
import type {ExportCue} from "../lib/replay-export/cues";
import {VisualPresentationFrame} from "../app/games/[slug]/components/visual-presentation";
import {SceneThinkingProvider} from "../components/watch/watch-thinking";
import {SampledStageProvider} from "../components/watch/sampled-stage";
import {exportPreviousSpeaker} from "../lib/replay-export/room-continuity";
import {RoomBackdrop} from "../app/games/[slug]/components/stage-backdrop";
import {resultRoom} from "../app/games/[slug]/components/influence-rooms";
import {InfluenceOpeningFrame} from "../app/games/[slug]/components/influence-opening-frame";

type Props={manifest:ReplayManifest;references:ExportCue[];prepare?:boolean};
function Audit({frame}:{frame:number}) {
  const [handle]=useState(()=>delayRender("Alliance geometry and media",{timeoutInMilliseconds:60000}));
  const [result,setResult]=useState<string|null>(null);
  useLayoutEffect(()=>{
    void (async()=>{
      await document.fonts.ready;
      for(let pass=0;pass<3;pass++) {
        await Promise.all(Array.from(document.images).map(image=>image.decode()));
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      }
      const stage=document.querySelector<HTMLElement>("[data-alliance-introduction]");
      const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const within=(node:Element,label:string)=>{
        const rect=node.getBoundingClientRect();
        if(rect.left<viewport.left-1 || rect.top<viewport.top-1 || rect.right>viewport.right+1 || rect.bottom>viewport.bottom+1) throw new Error(`Clipped ${label}: ${JSON.stringify(rect)}`);
      };
      for(const element of document.querySelectorAll<HTMLElement>("body *")) {
        const style=getComputedStyle(element);
        if([style.overflowX,style.overflowY].some(value=>value==="auto" || value==="scroll")) throw new Error("Scrollable player container");
      }
      const members=Array.from(stage?.querySelectorAll<HTMLElement>("[data-alliance-member]") ?? []);
      for(const member of members) {within(member,"member");within(member.querySelector("p")!,"member name");}
      const card=document.querySelector<HTMLElement>("[data-house-message]");
      const logo=document.querySelector<HTMLElement>("[data-house-message-logo]");
      if(card && logo) {
        within(card,"House message");within(logo,"House logo");
        const box=card.getBoundingClientRect(), mark=logo.getBoundingClientRect();
        const midpoint=mark.top+mark.height/2, border=box.top+parseFloat(getComputedStyle(card).borderTopWidth);
        if(Math.abs(midpoint-border)>1) throw new Error(`House border does not cross logo midpoint: ${midpoint}, ${border}`);
      }
      const pages=Array.from(document.querySelectorAll<HTMLElement>("[data-speech-page]"));
      for(const page of pages) {
        within(page,"caption page");
        const parent=page.parentElement!;
        if(page.offsetHeight>parent.clientHeight+1) throw new Error("Caption page exceeds its box");
        if(parseFloat(getComputedStyle(page).fontSize)<14) throw new Error("Unreadable caption type");
      }
      setResult(JSON.stringify({frame,members:members.map(member=>member.dataset.allianceMember),pages:pages.map(page=>({index:page.dataset.speechPage,count:page.dataset.speechPageCount,text:page.textContent})),scrollFree:true,logoMidpoint:!!logo}));
      continueRender(handle);
    })().catch(cancelRender);
  },[frame,handle]);
  return result ? <Artifact filename={`audit-${frame}.json`} content={result}/> : null;
}
function Viewer({manifest,references}:Props) {
  const frame=useCurrentFrame(),time=(frame+manifest.range.fromFrame)*1000/manifest.fps;
  const index=cueIndexAt(manifest.timeline,time),cue=manifest.cues[index]!,reference=references[index]!;
  const sample=sampleTiming(manifest.timeline[index]!,time),picture=reference.picture;
  if(picture.kind==="influence-opening") return <><InfluenceOpeningFrame {...picture} elapsedMs={sample.elapsedMs} reduced={manifest.reducedMotion}/><Audit frame={frame}/></>;
  if(picture.kind!=="influence" || !picture.beat) throw new Error("Missing viewer reference");
  const record=manifest.timeline[index]!.recording;
  const thought=sample.thought ? {...sample.thought,speaker:cue.picture.kind==="thinking" ? cue.picture.actor.name : cue.speech?.speaker ?? ""} : null;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
    <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60">{reference.label}</div>
    <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden">
      {picture.cue.resultsPresentation && <div className="absolute inset-0 -z-10"><RoomBackdrop source={resultRoom(picture.cue.phase)} resilient /></div>}
      <SceneThinkingProvider thought={thought}>
      <SampledStageProvider value={{images:{},previousScene:null,previousSpeaker:exportPreviousSpeaker(cue,manifest.cues[index-1]),firstInScene:true,
        ...(picture.beat.kind !== "alliance-introduction" && cue.alignment && cue.speech && {speech:{text:cue.speech.text,alignment:cue.alignment,elapsedMs:time-(record?.startMs ?? 0)}})}}>
        <VisualPresentationFrame beat={picture.beat} rooms={picture.rooms} elapsedMs={sample.elapsedMs} readingElapsedMs={sample.elapsedMs} reducedMotion={manifest.reducedMotion} fullscreen controlsInset={0} roster={picture.roster} houseLogoUrl={staticFile("logo.png")}/>
      </SampledStageProvider>
    </SceneThinkingProvider></div>
    <Audit frame={frame}/>
  </div>;
}
function Export(props:Props) {const frame=useCurrentFrame();return <><ReplayFrame {...props}/>{!props.prepare && <Audit frame={frame}/>}</>;}
function Studio(props:Props) {const frame=useCurrentFrame();return <><ReplayFrame {...props} preview/>{!props.prepare && <Audit frame={frame}/>}</>;}
registerRoot(()=>{
  const props=getInputProps<Props>();
  return <>{([['Viewer',Viewer],['Export',Export],['Studio',Studio]] as const).map(([id,component])=><Composition key={id} id={id} component={component}
    width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps} durationInFrames={props.prepare ? props.manifest.cues.length*2 : props.manifest.range.untilFrame-props.manifest.range.fromFrame} defaultProps={props}/>)}</>;
});
