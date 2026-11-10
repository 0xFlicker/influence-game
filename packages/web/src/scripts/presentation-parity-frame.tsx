/** Browser entry for the opt-in, provider-free viewer/export render comparison. */
import {useLayoutEffect, useMemo, useState} from "react";
import {Artifact, Composition, registerRoot, getInputProps, useCurrentFrame, delayRender, continueRender, cancelRender} from "remotion";
import {ReplayFrame} from "../remotion/house-replay/frame";
import {cueIndexAt, type ReplayManifest} from "../lib/replay-export/manifest";
import type {ExportCue} from "../lib/replay-export/cues";
import {sampleTiming} from "../lib/replay-export/timing";
import {SceneThinkingProvider} from "../components/watch/watch-thinking";
import {VisualPresentationFrame} from "../app/games/[slug]/components/visual-presentation";
import {WerewolfWatchStage} from "../components/games/werewolf/werewolf-watch-stage";
import {WerewolfOpeningFrame} from "../components/games/werewolf/werewolf-opening-frame";
import {werewolfWatchPolicy} from "../components/games/werewolf/werewolf-watch-model";
import {PresentationDirector} from "../components/watch/watch-director";
import {ActiveFormatOverlay} from "../app/games/[slug]/components/active-format-label";
import {ProductionPreview} from "../app/admin/production/production-preview";

export type ParityProps = {manifest:ReplayManifest; reference:ExportCue; references?:ExportCue[]; prepare?:boolean};

function FormatAudit({expectedFormat, expectedPaged}: {expectedFormat?:string; expectedPaged:boolean}) {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender("Format context geometry"));
  const [result,setResult] = useState<string|null>(null);
  useLayoutEffect(() => {
    void (async () => {
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      // Pagination is measured after mount; wait for that state before auditing.
      for (let attempt = 0; attempt < 30; attempt++) {
        const pending = Array.from(document.querySelectorAll<HTMLElement>("[data-format-rules] [data-speech-page-copy], [data-speech-bubble] [data-speech-page-copy]"))
          .some(page => page.getBoundingClientRect().width === 0 || page.getBoundingClientRect().bottom > page.parentElement!.getBoundingClientRect().bottom + 1);
        const stage = document.querySelector<HTMLElement>("[data-influence-stage]");
        const roomPending = !!stage && stage.clientWidth < 600 && document.querySelectorAll("[data-room-player]").length > 4
          && !document.querySelector("[data-paginated-portrait-room]");
        const missing = expectedFormat && !document.querySelector("[data-active-format-overlay]") || expectedPaged && !document.querySelector("[data-paginated-portrait-room]");
        if (!pending && !roomPending && !missing) break;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      const pill = document.querySelector<HTMLElement>("[data-active-format-overlay]");
      const label = document.querySelector<HTMLElement>("[data-room-context-label]");
      for (const node of document.querySelectorAll<HTMLElement>("[data-influence-stage], [data-influence-stage] *, [data-werewolf-stage], [data-werewolf-stage] *")) {
        const style=getComputedStyle(node);
        if ([style.overflowX,style.overflowY].some(value=>value === "auto" || value === "scroll")) throw new Error("Scrollable player content");
      }
      if (expectedFormat && !pill) throw new Error(`Missing active format: ${expectedFormat}`);
      if (expectedPaged && !document.querySelector("[data-paginated-portrait-room]")) throw new Error("Missing paginated cast");
      if (pill) {
        if (getComputedStyle(pill).position !== "absolute") throw new Error("Format context changes scene geometry");
        const box = pill.getBoundingClientRect();
        if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) throw new Error("Format pill is outside the picture");
        if (label) {
          const room = label.getBoundingClientRect();
          if (box.left < room.right && box.right > room.left && box.top < room.bottom && box.bottom > room.top) throw new Error("Format pill covers the room label");
        }
      }
      const names = Array.from(document.querySelectorAll<HTMLElement>("[data-room-player] > p"));
      if (names.length > 5 || document.querySelector("[data-paginated-portrait-room]")) {
        const stage = document.querySelector<HTMLElement>("[data-influence-stage]")!.getBoundingClientRect();
        const overlaps = (a:DOMRect,b:DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const speech = document.querySelector<HTMLElement>("[data-speech-bubble]");
        if (label && speech && Number(getComputedStyle(speech).opacity) > .1 && overlaps(label.getBoundingClientRect(),speech.getBoundingClientRect()))
          throw new Error("Room label overlaps speech");
        for (const [index,name] of names.entries()) {
          const rect = name.getBoundingClientRect();
          if (rect.left < stage.left - 1 || rect.right > stage.right + 1 || rect.top < stage.top - 1 || rect.bottom > stage.bottom + 1)
            throw new Error(`Cast name is outside the picture: ${name.textContent} ${JSON.stringify({rect,stage,paginated:!!document.querySelector("[data-paginated-portrait-room]")})}`);
          if (speech && Number(getComputedStyle(speech).opacity) > .1 && overlaps(rect,speech.getBoundingClientRect()))
            throw new Error(`Cast name overlaps speech: ${name.textContent}`);
          if ((label && overlaps(rect,label.getBoundingClientRect())) || (pill && overlaps(rect,pill.getBoundingClientRect())))
            throw new Error(`Cast name overlaps room or format context: ${name.textContent}`);
          if (names.slice(index + 1).some(other => overlaps(rect,other.getBoundingClientRect())))
            throw new Error(`Cast names overlap: ${name.textContent}`);
        }
      }
      for (const page of document.querySelectorAll<HTMLElement>("[data-format-rules] [data-speech-page-copy], [data-paginated-portrait-room] [data-speech-page-copy], [data-speech-bubble] [data-speech-page-copy]")) {
        if (page.closest<HTMLElement>("[data-speech-bubble]") && Number(getComputedStyle(page.closest<HTMLElement>("[data-speech-bubble]")!).opacity) <= .1) continue;
        const rect=page.getBoundingClientRect(), container=page.parentElement!.getBoundingClientRect();
        if (rect.left < container.left - 1 || rect.right > container.right + 1 || rect.bottom > container.bottom + 1 || parseFloat(getComputedStyle(page).fontSize) < 14)
          throw new Error(`Format rules page does not fit at readable size: ${JSON.stringify({rect,container,font:getComputedStyle(page).fontSize,text:page.textContent})}`);
      }
      for (const name of document.querySelectorAll<HTMLElement>("[data-speaker-name]")) {
        const box = name.getBoundingClientRect();
        if (box.width > 0 && (name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > 21)) throw new Error("Item speaker name does not fit its reserved header");
      }
      const hunter = document.querySelector<HTMLElement>('[data-night-role="snipe"], [data-night-elimination]');
      if (hunter) {
        const bounds = hunter.getBoundingClientRect();
        for (const label of hunter.querySelectorAll<HTMLElement>("h2, figcaption")) {
          const rect = label.getBoundingClientRect();
          if(rect.bottom > bounds.bottom+1 || rect.right > bounds.right+1 || rect.left < bounds.left-1) throw new Error(`Hunter label leaves the player picture: ${JSON.stringify({text:label.textContent,rect,bounds})}`);
        }
        for(const portrait of hunter.querySelectorAll("img")) if(portrait.getBoundingClientRect().height < 24) throw new Error("Hunter portrait has no readable space");
      }
      const room = document.querySelector<HTMLElement>("[data-paginated-portrait-room]");
      const winner = document.querySelector<HTMLElement>("[data-winner-scene]");
      if (winner) {
        const bounds = winner.getBoundingClientRect();
        for (const element of [winner, ...winner.querySelectorAll<HTMLElement>("*")]) {
          const style = getComputedStyle(element);
          if (["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY)) throw new Error("Winner scene contains a scrollable element");
        }
        for (const label of winner.querySelectorAll<HTMLElement>("[data-winner-player] p, [data-winner-votes], h2, h3")) {
          const rect = label.getBoundingClientRect();
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1 || label.scrollHeight > label.clientHeight + 4 || parseFloat(getComputedStyle(label).fontSize) < 12)
            throw new Error(`Winner label does not fit: ${label.textContent} ${JSON.stringify({rect,bounds})}`);
        }
        for (const image of winner.querySelectorAll<HTMLElement>("[data-winner-player] img")) {
          const rect = image.getBoundingClientRect();
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
            throw new Error(`Winner portrait does not fit: ${JSON.stringify({rect,bounds})}`);
        }
        const winnerImage = winner.querySelector<HTMLElement>("[data-winner-image]");
        if (!winnerImage || winnerImage.getBoundingClientRect().height < 24) throw new Error("Winner artwork has no readable space");
      }
      const namePage = room?.querySelector<HTMLElement>("[data-room-context-label] [data-speech-page]");
      const speechBox = room?.querySelector<HTMLElement>("[data-speech-bubble]") ?? document.querySelector<HTMLElement>("[data-speech-bubble]");
      const speechPage = speechBox && Number(getComputedStyle(speechBox).opacity) > .1 ? speechBox.querySelector<HTMLElement>("[data-speech-page]") : null;
      setResult(JSON.stringify({frame,formatOverlay:!!pill,roomLabel:!!label,castPage:room?.dataset.castPage,
        namePage:namePage?.dataset.speechPage,speechPage:speechPage?.dataset.speechPage,
        castMembers:Array.from(document.querySelectorAll<HTMLElement>("[data-room-player]")).map(member=>member.dataset.roomPlayer),
        winnerMembers:Array.from(document.querySelectorAll<HTMLElement>("[data-winner-player]")).map(member=>member.dataset.winnerPlayer)}));
      continueRender(handle);
    })().catch(cancelRender);
  },[frame,handle,expectedFormat,expectedPaged]);
  return result ? <Artifact filename={`format-audit-${frame}.json`} content={result} /> : null;
}

function ViewerFrame({manifest,reference:singleReference,references}:ParityProps) {
  const frame = useCurrentFrame();
  const time = frame * 1000 / manifest.fps;
  const index = cueIndexAt(manifest.timeline,time);
  const reference = references?.[index] ?? singleReference;
  const sample = sampleTiming(manifest.timeline[index]!,time);
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
  const actor = manifest.cues[index]!.picture;
  const thought = sample.thought ? {...sample.thought,speaker:actor.kind === "thinking" ? actor.actor.name : ""} : null;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
    {picture.kind === "werewolf-opening" ? <WerewolfOpeningFrame cue={picture.cue} elapsedMs={sample.elapsedMs} reduced={manifest.reducedMotion} /> : picture.kind === "werewolf" ? <WerewolfWatchStage cue={picture.cue} scene={picture.scene} elapsed={sample.elapsedMs}
      reduced={manifest.reducedMotion} director={{manualAdvance:()=>{},setReady:()=>{},getSnapshot:()=>({...director.getSnapshot(),isPlaying:true}),getSpeechElapsedBaseMs:()=>sample.elapsedMs}}
      holding={false} contextLabel={reference.label} /> : picture.kind === "influence" && picture.beat ? <>
      <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60">{reference.label}</div>
      <div data-influence-stage className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"><SceneThinkingProvider thought={thought}>
        {reference.activeFormatId && <ActiveFormatOverlay formatId={reference.activeFormatId} onOpen={() => {}} />}
        <VisualPresentationFrame beat={picture.beat} rooms={picture.rooms} elapsedMs={sample.elapsedMs} reducedMotion={manifest.reducedMotion} fullscreen controlsInset={0} roster={picture.roster} voteLedger={picture.ledger ?? undefined}/>
      </SceneThinkingProvider></div>
    </> : null}
    <FormatAudit expectedFormat={reference.activeFormatId} expectedPaged={picture.kind === "influence" && picture.beat?.kind === "portrait-room" && picture.beat.paginateLargeCast === true && picture.beat.participants.length > 4 && (manifest.width < 600 || manifest.height < 374 || picture.beat.participants.length > 8)} />
  </div>;
}

function ExportFrame(props:ParityProps) {
  const frame=useCurrentFrame(),time=(frame+props.manifest.range.fromFrame)*1000/props.manifest.fps;
  const cue=props.manifest.cues[cueIndexAt(props.manifest.timeline,time)]!, picture=cue.picture;
  const count=picture.kind === "thinking" ? picture.room?.players.length ?? 0 : picture.kind === "influence" && picture.beat?.kind === "portrait-room" ? picture.beat.participants.length : 0;
  const paginatable=picture.kind === "thinking" ? picture.room?.paginateLargeCast === true : picture.kind === "influence" && picture.beat?.kind === "portrait-room" && picture.beat.paginateLargeCast === true;
  return <><ReplayFrame {...props} />{!props.prepare && <FormatAudit expectedFormat={cue.activeFormatId} expectedPaged={paginatable && count > 4 && (props.manifest.width < 600 || props.manifest.height < 374 || count > 8)} />}</>;
}

/** Exercise the real Studio Player with an isolated selected moment. */
function StudioFrame({manifest,view}:ParityProps & {view:"source"|"cut"}) {
  const frame=useCurrentFrame();
  const ids=manifest.cues.map((_,index)=>`format-context-proof-${index}`);
  const cues=manifest.cues.map((cue,index)=>({...cue,momentId:ids[index]!}));
  const cue=cues[0]!;
  const omitted={...cue,momentId:"omitted",speech:{messageId:"omitted",speakerId:null,speaker:"Omitted neighbor",text:"OMITTED NEIGHBOR MUST NOT APPEAR"}};
  const selectedSource=cues.map((item,index)=>({id:ids[index]!,segments:[item]}));
  const source=view === "cut" ? [{id:"omitted",segments:[omitted]},...selectedSource] : selectedSource;
  const compiled={momentIds:ids,moments:ids.map((id,index)=>({id,startFrame:manifest.timeline[index]!.startFrame,contentFrame:manifest.timeline[index]!.startFrame,endFrame:manifest.timeline[index]!.endFrame,sourceOrder:index+(view === "cut" ? 1 : 0)})),
    cues,timeline:manifest.timeline,audio:manifest.audio};
  const [ready]=useState(()=>delayRender("Studio Player intended frame",{timeoutInMilliseconds:60000}));
  useLayoutEffect(()=>{
    let active=true;
    void (async()=>{
      for(let attempt=0;attempt<180;attempt++) {
        const content=document.querySelector<HTMLElement>(`[data-composition-frame="${frame}"]`);
        if(content && Array.from(content.querySelectorAll("img")).every(image=>image.complete && image.naturalWidth>0)) {
          await document.fonts.ready;
          await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
          if(document.body.textContent?.includes("OMITTED NEIGHBOR MUST NOT APPEAR")) throw new Error("Studio exposed an omitted neighboring speech");
          if(active) continueRender(ready);
          return;
        }
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      throw new Error(`Studio Player did not present frame ${frame}`);
    })().catch(cancelRender);
    return ()=>{active=false;};
  },[frame,ready]);
  return <div className="format-proof-studio" style={{width:"100%",height:"100%"}}>
    <style>{`.format-proof-studio [data-production-preview],.format-proof-studio [aria-label="Playable preview"]{width:100%;height:100%;display:flex;flex-direction:column;min-height:0;padding:0;border:0}
      .format-proof-studio [aria-label="Playable preview"] > :first-child,.format-proof-studio [aria-label="Playable preview"] > :last-child{display:none}
      .format-proof-studio [aria-label="Preview keyboard controls"]{width:100%;height:100%;min-height:0;flex:1;padding:0;border:0;border-radius:0}`}</style>
    <ProductionPreview key={`${view}:${frame}`} base={manifest} source={source} compiled={compiled} selectedIds={ids} view={view}
      onActiveMomentChange={()=>{}} onViewChange={()=>{}} emptyLabel="Empty" readAnchor={()=>{const index=cueIndexAt(manifest.timeline,frame*1000/manifest.fps);return {momentId:ids[index]!,offsetMs:(frame-manifest.timeline[index]!.startFrame)*1000/manifest.fps};}}
      onAnchorChange={()=>{}} playback={{muted:true,volume:1}} onPlaybackChange={()=>{}} renderLayout={monitor=>monitor}
      onOpenHints={()=>{}} characterShortcuts={false} keyboardAvailable={()=>true} />
  </div>;
}

registerRoot(() => {
  const props = getInputProps<ParityProps>();
  return <>
    <Composition id="Export" component={ExportFrame} width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps}
      durationInFrames={props.prepare ? 2 : props.manifest.range.untilFrame} defaultProps={props}/>
    <Composition id="Viewer" component={ViewerFrame} width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps}
      durationInFrames={props.manifest.range.untilFrame} defaultProps={props}/>
    <Composition id="StudioSource" component={StudioFrame} width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps}
      durationInFrames={props.manifest.range.untilFrame} defaultProps={{...props,view:"source"}}/>
    <Composition id="StudioCut" component={StudioFrame} width={props.manifest.width} height={props.manifest.height} fps={props.manifest.fps}
      durationInFrames={props.manifest.range.untilFrame} defaultProps={{...props,view:"cut"}}/>
  </>;
});
