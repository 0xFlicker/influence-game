/** Fresh browser/encoded proof. Uses deterministic game fixtures and bundled artwork; no API/providers. */
import {mkdir, mkdtemp, readFile, writeFile, cp, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import {bundle} from "@remotion/bundler";
import {openBrowser, renderStill, renderFrames, renderMedia, selectComposition} from "@remotion/renderer";
import tailwindConfig from "../../tailwind.config";
import {createFormatKernelViewerScenario} from "@influence/engine/fixtures/format-kernel-viewer";
import {completedCurrentWerewolfFixture, completedWerewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfProductionWatch} from "@influence/engine/werewolf/watch";
import type {GameWatchReplayFrame, TranscriptEntry} from "../lib/api";
import {formatPresentationMetadata} from "@influence/engine/format-presentation-metadata";
import {portraitRoomPageCount} from "../app/games/[slug]/components/portrait-room-pagination";
import {buildExportCues, type ExportCue} from "../lib/replay-export/cues";
import {thinkingSegment} from "../lib/replay-export/presentation";
import {compileTiming, parseTimingProfile} from "../lib/replay-export/timing";
import {compileAudio} from "../lib/replay-export/audio";
import {compareRecordingPcm} from "./recording-alignment";
import type {ReplayManifest} from "../lib/replay-export/manifest";
import {runProcess, sha256} from "../lib/replay-export/assets";

const webRoot = resolve(import.meta.dir,"../.."), repoRoot = resolve(webRoot,"../..");
const output = resolve(process.argv[2] ?? join(repoRoot,".renders",`presentation-parity-${Date.now()}`));
await mkdir(output,{recursive:true});
const cases:{name:string;cue:ExportCue;reference:ExportCue;reducedMotion?:boolean}[] = [];
const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
const players = fixture.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false,avatarUrl:"/avatars/personas/strategic.png"}));
const frames:GameWatchReplayFrame[] = fixture.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,
  counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0}}));
const influence = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages:[],frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],
  fullBodies:Object.fromEntries(players.map(player=>[player.id,"/avatars/personas/full-body-v1/strategic.webp"]))}});
// Start with a fresh format-menu scene: its full-body layout hides a lazy
// portrait, which must still finish decoding during export preparation.
const menu = influence.find(cue=>cue.picture.kind === "influence" && cue.picture.cue.kind === "format_menu");
if (!menu) throw new Error("Missing format-menu readiness fixture");
cases.push({name:"format-menu",reference:menu,cue:menu});
const selectedRules = influence.find(cue => cue.picture.kind === "influence" && cue.picture.cue.source === "format" && cue.picture.cue.kind === "format_selected" && cue.picture.cue.stage === "rules_reveal");
if (!selectedRules) throw new Error("Missing selected rules fixture");
cases.push({name:"format-rules",reference:selectedRules,cue:selectedRules});
const socialScenario = createFormatKernelViewerScenario("majority_elimination_clear");
const socialFrames:GameWatchReplayFrame[] = socialScenario.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,
  counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0}}));
const social:TranscriptEntry = {id:101,entrySequence:101,firstDurableEventSequence:61,gameId:"g",round:2,phase:"FORMAT_MINGLE",scope:"mingle",fromPlayerId:"atlas",speakerPlayerId:"atlas",fromPlayerName:"Atlas",toPlayerIds:["lyra"],text:"We should decide where the votes go before we split up.",thinking:"I need to hear what they really intend.",timestamp:101};
const huddle:TranscriptEntry = {...social,id:102,entrySequence:102,scope:"huddle",dialogueKind:"huddle_speech",allianceSession:{sessionId:"s",allianceId:"a",allianceName:"The Night Shift",memberIds:["atlas","lyra"]},text:"We can hold our votes together.",timestamp:102};
const socialCues = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages:[social,huddle],frames:socialFrames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],
  fullBodies:Object.fromEntries(players.map(player=>[player.id,"/avatars/personas/full-body-v1/strategic.webp"]))}});
for (const [name,message] of [["format-mingle",social],["format-huddle",huddle]] as const) {
  const cue = socialCues.find(item => item.speech?.text === message.text);
  if (!cue || cue.activeFormatId !== "majority_elimination") throw new Error(`Missing ${name} format context`);
  cases.push({name,reference:cue,cue});
  cases.push({name:`${name}-thought`,reference:cue,cue:thinkingSegment(cue,`${name}-thought`,message.thinking!,"atlas")});
}
const largePlayers = [...players.map((player,index)=>index === 0 ? {...player,name:"Alexandria Very Long Contestant Name"} : player),...Array.from({length:8},(_,index)=>({...players[0]!,id:`extra-${index}`,name:`Long Contestant Name ${index + 1}`}))];
const largeFrames = socialFrames.slice(0,2).map(frame => ({...frame,players:largePlayers,counts:{...frame.counts,totalPlayers:largePlayers.length,alivePlayers:largePlayers.length}}));
const huddleMembers = largePlayers.slice(0,-1);
const largeHuddle:TranscriptEntry = {...huddle,id:103,entrySequence:103,toPlayerIds:huddleMembers.slice(1).map(player=>player.id),
  text:"We can hold our votes together, but only if everyone understands who is actually at risk. I want to hear the people who have not spoken yet before we settle on a name. If the plan changes, tell the whole group rather than leaving one person to discover it when the votes are revealed.",
  thinking:"I promised to listen before choosing a target. This room contains several competing commitments, and I need to remember who supports each option. The safest move may be to ask for a clear explanation before accepting a plan that leaves someone else exposed.",
  allianceSession:{sessionId:"large",allianceId:"large",allianceName:"The Exceptionally Long Night Shift Alliance",memberIds:huddleMembers.map(player=>player.id)}};
const largeCues = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players:largePlayers},messages:[largeHuddle],frames:largeFrames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}});
const largeHuddleCue = largeCues.find(cue => cue.speech?.text === largeHuddle.text);
if (!largeHuddleCue || largeHuddleCue.activeFormatId !== "majority_elimination") throw new Error("Missing large huddle format context");
cases.push({name:"format-huddle-large",reference:largeHuddleCue,cue:largeHuddleCue});
cases.push({name:"format-huddle-large-reduced",reference:largeHuddleCue,cue:largeHuddleCue,reducedMotion:true});
const largeThoughtCue = thinkingSegment(largeHuddleCue,"format-huddle-large-thought",largeHuddle.thinking!,"atlas");
cases.push({name:"format-huddle-large-thought",reference:largeHuddleCue,cue:largeThoughtCue});
cases.push({name:"format-huddle-large-thought-recorded",reference:largeHuddleCue,cue:{...largeThoughtCue,timing:{...largeThoughtCue.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}}});
cases.push({name:"format-huddle-large-recorded",reference:largeHuddleCue,cue:{...largeHuddleCue,timing:{...largeHuddleCue.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}}});
const fiveMembers = largePlayers.slice(0,5);
const fiveHuddle:TranscriptEntry = {...largeHuddle,id:104,entrySequence:104,toPlayerIds:fiveMembers.slice(1).map(player=>player.id),
  allianceSession:{sessionId:"five",allianceId:"five",allianceName:"The Exceptionally Long Night Shift Alliance",memberIds:fiveMembers.map(player=>player.id)}};
const fiveCue = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players:largePlayers},messages:[fiveHuddle],frames:largeFrames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}}).find(cue=>cue.speech?.text === fiveHuddle.text);
if (!fiveCue) throw new Error("Missing five-person huddle fixture");
cases.push({name:"format-huddle-five",reference:fiveCue,cue:fiveCue});
const pointers = influence.filter(cue=>cue.picture.kind === "influence" && cue.picture.beat?.kind === "safety-chain" && cue.picture.beat.cue.kind === "safety_bounce_pointer");
for (const index of [0,pointers.length-1]) {
  const reference=pointers[index]!;
  if(reference.picture.kind !== "influence" || reference.picture.beat?.kind !== "safety-chain" || reference.picture.beat.cue.kind !== "safety_bounce_pointer") throw new Error("Missing chain fixture");
  cases.push({name:`chain-${index}`,reference,cue:thinkingSegment(reference,`thought-${index}`,"I need to keep my commitment without giving the other pool control.",reference.picture.beat.cue.actorId)});
}
const events=await completedCurrentWerewolfFixture("render-parity",11);
const suites=[{events,prefix:"",kinds:["night","vote","result","ending"] as const},
  {events:await completedWerewolfResultsFixture("village","render-win"),prefix:"winner-",kinds:["vote","result","ending"] as const}];
for (const suite of suites) for (const audience of ["mystery","omniscient"] as const) {
  const projected=projectWerewolfProductionWatch(suite.events,audience);
  // Replace fixture-only media URLs with local, immutable test artwork.
  for(const moment of projected.moments) for(const player of moment.snapshot.players) {
    player.avatarUrl="/avatars/personas/strategic.png";
    player.fullBodyReferenceUrl="/avatars/personas/full-body-v1/strategic.webp";
  }
  const cues=buildExportCues({kind:"werewolf",windows:[{...projected,audience,status:"completed",slug:"render-parity",publicationCutoff:"fixture",media:{}}],thoughts:[]});
  for(const kind of suite.kinds) {
    const cue=cues.find(item=>item.picture.kind === "werewolf" && (kind === "ending" ? item.picture.cue.reprise : !item.picture.cue.reprise && !item.picture.cue.ballot && !item.picture.cue.nightAction && item.picture.cue.moment.entry.kind === kind));
    if(!cue) throw new Error(`Missing ${audience} ${kind} fixture`);
    cases.push({name:`${suite.prefix}${audience}-${kind}`,cue,reference:cue});
  }
}
const scratch=await mkdtemp(join(tmpdir(),"house-parity-"));
const results:{name:string;width:number;height:number;frame:number;meanDifference:number;exportHash:string;viewer:string;export:string}[]=[];
const encodedResults:{name:string;frame:number;meanDifference:number;video:string}[]=[];
const audioResults:unknown[]=[];
const studioResults:unknown[]=[];
async function pixels(path:string) {
  const destination=join(scratch,"pixels.rgb");
  await runProcess("ffmpeg",["-y","-v","error","-i",path,"-pix_fmt","rgb24","-f","rawvideo",destination]);
  return readFile(destination);
}
function difference(a:Buffer,b:Buffer) {
  if(a.length!==b.length) throw new Error("Comparison geometry mismatch");
  return a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]!),0)/a.length;
}
try {
  const css=await postcss([tailwind({...tailwindConfig,content:[join(webRoot,"src/**/*.{ts,tsx}")]}),autoprefixer]).process(await readFile(join(webRoot,"src/app/globals.css"),"utf8"),{from:join(webRoot,"src/app/globals.css")});
  await writeFile(join(scratch,"parity.css"),css.css);
  await writeFile(join(scratch,"entry.tsx"),`import "./parity.css";\nimport ${JSON.stringify(join(import.meta.dir,"presentation-parity-frame.tsx"))};\n`);
  const serveUrl=await bundle({entryPoint:join(scratch,"entry.tsx"),rootDir:webRoot,publicDir:join(webRoot,"public"),outDir:join(scratch,"bundle"),ignoreRegisterRootWarning:true,
    webpackOverride:config=>{
      for(const rule of config.module?.rules ?? []) if(rule && typeof rule === "object" && Array.isArray(rule.use))
        for(const loader of rule.use) if(loader && typeof loader === "object" && loader.loader?.includes("css-loader"))
          loader.options={...(typeof loader.options === "object" ? loader.options : {}),url:false};
      return {...config,resolve:{...config.resolve,alias:{...config.resolve?.alias,"@":join(webRoot,"src")}}};
    }});
  await cp(join(webRoot,"public"),serveUrl,{recursive:true});
  await mkdir(join(serveUrl,"assets"),{recursive:true});
  await runProcess("ffmpeg",["-y","-v","error","-f","lavfi","-i","sine=frequency=523:sample_rate=44100","-t","2",join(serveUrl,"assets/format-context-voice.wav")]);
  await mkdir(join(serveUrl,"public","assets"),{recursive:true});
  await cp(join(serveUrl,"assets/format-context-voice.wav"),join(serveUrl,"public/assets/format-context-voice.wav"));
  const browser=await openBrowser("chrome",{browserExecutable:process.env.REPLAY_BROWSER_EXECUTABLE});
  try {
    const narrow = process.env.FORMAT_CONTEXT_NARROW === "1";
    const portrait = process.env.FORMAT_CONTEXT_PORTRAIT === "1";
    const formatOnly = process.env.FORMAT_CONTEXT_ONLY === "1";
    const geometries: readonly (readonly [number, number])[] = narrow ? [[360,240]] : portrait ? [[320,480]] : [[1280,720],[640,360]];
    const geometryCases = narrow || portrait ? cases.filter(item => ["format-mingle","format-huddle","format-huddle-five","format-huddle-large","format-huddle-large-reduced","format-huddle-large-thought","format-rules"].includes(item.name))
      : formatOnly ? cases.filter(item => item.name.startsWith("format-")) : cases;
    const selectedCases = process.env.FORMAT_CONTEXT_CASE ? geometryCases.filter(item => item.name === process.env.FORMAT_CONTEXT_CASE) : geometryCases;
    for(const [width,height] of geometries) for(const item of selectedCases) {
      const profile=parseTimingProfile({ending:{holdMs:0}}),fps=30;
      const timeline=compileTiming([item.cue.timing],profile,fps);
      let manifest:ReplayManifest={schema:"house.replay-export",version:2,game:{id:"fixture",slug:item.name,kind:item.cue.picture.kind === "thinking" || item.cue.picture.kind === "influence" ? "influence" : "werewolf"},
        width,height,fps,reducedMotion:item.reducedMotion === true,thinking:item.cue.picture.kind === "thinking",profile,cues:[item.cue],timeline,assets:{},staticFiles:{},boundary:{},audio:compileAudio([item.cue],timeline,{},profile,false),
        range:{fromFrame:0,untilFrame:timeline[0]!.endFrame},revision:"fixture",dirty:true};
      const prefix=join(output,`${item.name}-${width}`);
      // The same layout prepass used by the local exporter freezes typography before encoding.
      const preparation={manifest,reference:item.reference,prepare:true};
      const measuring=await selectComposition({serveUrl,id:"Export",inputProps:preparation,puppeteerInstance:browser});
      const layouts:NonNullable<ReplayManifest["layouts"]>={},pages:NonNullable<ReplayManifest["pages"]>={};
      await renderFrames({serveUrl,composition:measuring,inputProps:preparation,outputDir:join(scratch,"measure"),imageFormat:"none",concurrency:1,puppeteerInstance:browser,
        onStart:()=>{},onFrameUpdate:()=>{},onArtifact:artifact=>{const data=JSON.parse(typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content));Object.assign(layouts,data.layouts);Object.assign(pages,data.pages);}});
      manifest={...manifest,layouts,pages};
      await writeFile(`${prefix}.manifest.json`,JSON.stringify(manifest,null,2));
      const inputProps={manifest,reference:item.reference};
      const exported=await selectComposition({serveUrl,id:"Export",inputProps,puppeteerInstance:browser});
      const viewer=await selectComposition({serveUrl,id:"Viewer",inputProps,puppeteerInstance:browser});
      const studio = process.env.FORMAT_CONTEXT_STUDIO === "1" ? await Promise.all(["source","cut"].map(async view=>({view,
        composition:await selectComposition({serveUrl,id:view === "source" ? "StudioSource" : "StudioCut",inputProps:{...inputProps,view},puppeteerInstance:browser})}))) : [];
      const thought=timeline[0]!.thought;
      let rulesSamples:number[]|null = null;
      if (item.name === "format-rules" && item.cue.picture.kind === "influence" && item.cue.picture.cue.source === "format" && item.cue.picture.cue.kind === "format_selected") {
        const text = formatPresentationMetadata(item.cue.picture.cue.formatId).conciseRules;
        const rulePages = Object.values(pages).find(value => value.join("") === text);
        if (!rulePages?.length || rulePages.some(page => !page.trim())) throw new Error("Rules pagination did not preserve every word");
        const weights = rulePages.map(page => page.trim().split(/\s+/u).length), total = weights.reduce((sum,value) => sum + value,0);
        let prior = 0;
        rulesSamples = [0,...weights.map(weight => {const frame = Math.floor((prior + weight / 2) / total * manifest.range.untilFrame); prior += weight; return frame;}),manifest.range.untilFrame-1];
      }
      const expectedCast = item.name === "format-huddle-five" ? fiveMembers : huddleMembers;
      const castPages = portraitRoomPageCount(expectedCast.length);
      const castSamples = ["format-huddle-five","format-huddle-large","format-huddle-large-reduced","format-huddle-large-recorded"].includes(item.name) ? Array.from({length:castPages},(_,page) => Math.floor((650 + (item.cue.timing.baseDurationMs - 1050) * (page + .5) / castPages) * fps / 1000))
        : item.name.startsWith("format-huddle-large-thought") && thought ? Array.from({length:castPages},(_,page) => Math.floor((thought.readAtMs + (thought.hideAtMs - thought.readAtMs) * (page + .5) / castPages) * fps / 1000)) : [];
      let dialogueSamples:number[]=[];
      let roomSamples:number[]=[];
      let expectedDialoguePages=0, expectedRoomPages=0;
      if(item.name.startsWith("format-huddle-large")) {
        const text = item.name.includes("-thought") ? largeHuddle.thinking! : largeHuddle.text;
        const dialoguePages=Object.values(pages).find(value=>value.join("") === text);
        if(!dialoguePages?.length || dialoguePages.some(page=>!page.trim())) throw new Error("Huddle pagination did not retain every word");
        expectedDialoguePages = dialoguePages.length;
        const weights=dialoguePages.map(page=>page.trim().split(/\s+/u).length),total=weights.reduce((sum,value)=>sum+value,0);
        let prior=0;
        dialogueSamples=weights.map(weight=>{
          const progress=(prior+weight/2)/total;prior+=weight;
          if(thought) return Math.floor((thought.readAtMs+(thought.hideAtMs-thought.readAtMs)*progress)*fps/1000);
          const source=850+(item.cue.timing.baseDurationMs-1450)*progress;
          const segment=timeline[0]!.segments.find(part=>part.sourceStartMs<=source && part.sourceEndMs>=source && part.sourceStartMs!==part.sourceEndMs);
          if(!segment) throw new Error("Missing huddle reading segment");
          return Math.floor((segment.startMs+(source-segment.sourceStartMs)/(segment.sourceEndMs-segment.sourceStartMs)*(segment.endMs-segment.startMs))*fps/1000);
        });
        const roomPages=Object.values(pages).find(value=>value.join("") === largeHuddle.allianceSession!.allianceName);
        if(!roomPages?.length || roomPages.some(page=>!page.trim())) throw new Error("Huddle name pagination did not retain every word");
        expectedRoomPages = roomPages.length;
        const roomWeights=roomPages.map(page=>page.trim().split(/\s+/u).length),roomTotal=roomWeights.reduce((sum,value)=>sum+value,0);
        let roomPrior=0;
        roomSamples=roomWeights.map(weight=>{
          const progress=(roomPrior+weight/2)/roomTotal;roomPrior+=weight;
          if(thought) return Math.floor((thought.readAtMs+(thought.hideAtMs-thought.readAtMs)*progress)*fps/1000);
          const source=650+(item.cue.timing.baseDurationMs-1050)*progress;
          const segment=timeline[0]!.segments.find(part=>part.sourceStartMs<=source && part.sourceEndMs>=source && part.sourceStartMs!==part.sourceEndMs);
          if(!segment) throw new Error("Missing huddle name timing segment");
          return Math.floor((segment.startMs+(source-segment.sourceStartMs)/(segment.sourceEndMs-segment.sourceStartMs)*(segment.endMs-segment.startMs))*fps/1000);
        });
      }
      const samples=[...new Set([...(rulesSamples ?? (thought ? [Math.round(thought.enterMs*.5*fps/1000),Math.round((thought.readAtMs+500)*fps/1000),Math.round((thought.returnAtMs+450)*fps/1000)] : item.name.startsWith("format-") && item.name !== "format-menu" ? [0,Math.min(60,manifest.range.untilFrame-1),manifest.range.untilFrame-1] : [Math.min(60,manifest.range.untilFrame-1)])),...castSamples,...dialogueSamples,...roomSamples])];
      const observedCast = new Set<string>();
      const observedDialoguePages = new Set<string>(), observedRoomPages = new Set<string>();
      for(const frame of samples) {
        const paths={viewer:`${prefix}-${frame}-viewer.png`,export:`${prefix}-${frame}-export.png`};
        await renderStill({serveUrl,composition:viewer,inputProps,frame,output:paths.viewer,imageFormat:"png",puppeteerInstance:browser});
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:paths.export,imageFormat:"png",puppeteerInstance:browser,
          onArtifact:artifact=>{if (artifact.filename.startsWith("format-audit-")) {const data=JSON.parse(typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content)); for (const id of data.castMembers ?? []) observedCast.add(id); if(data.namePage !== undefined) observedRoomPages.add(data.namePage); if(data.speechPage !== undefined) observedDialoguePages.add(data.speechPage);}}});
        const meanDifference=difference(await pixels(paths.viewer),await pixels(paths.export));
        results.push({name:item.name,width,height,frame,meanDifference,exportHash:sha256(await readFile(paths.export)),...paths});
        await writeFile(join(output,"comparison.json"),JSON.stringify({source:"deterministic fixtures; actual viewer components versus Studio/export composition",frames:results},null,2));
        if(meanDifference>1) throw new Error(`Viewer/export mismatch: ${item.name} ${width} frame ${frame}: ${meanDifference}`);
        for(const {view,composition} of studio) {
          const path=`${prefix}-${frame}-studio-${view}.png`;
          await renderStill({serveUrl,composition,inputProps:{...inputProps,view},frame,output:path,imageFormat:"png",puppeteerInstance:browser,timeoutInMilliseconds:60000});
          const delta=difference(await pixels(paths.export),await pixels(path));
          studioResults.push({name:item.name,width,height,frame,view,meanDifference:delta,path});
          if(delta>1) throw new Error(`Studio ${view} mismatch: ${item.name} ${width} frame ${frame}: ${delta}`);
        }
      }
      if((item.name.startsWith("format-huddle-large") || item.name === "format-huddle-five") && expectedCast.some(player=>!observedCast.has(player.id))) throw new Error(`Not every huddle member appeared: ${[...observedCast].join(", ")}`);
      if(item.name.startsWith("format-huddle-large") && (observedRoomPages.size !== expectedRoomPages || observedDialoguePages.size !== expectedDialoguePages))
        throw new Error(`Not every huddle page appeared: room ${observedRoomPages.size}/${expectedRoomPages}, dialogue ${observedDialoguePages.size}/${expectedDialoguePages}`);
      // Verify random-access stability independently of the comparison order.
      for(const frame of samples.toReversed()) {
        const path=join(scratch,"reverse.png");
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:path,imageFormat:"png",puppeteerInstance:browser});
        if(sha256(await readFile(path))!==results.find(row=>row.name===item.name && row.width===width && row.frame===frame)!.exportHash) throw new Error("Reverse-order render mismatch");
      }
      if(width===640 && ["format-menu","format-rules","format-mingle","format-huddle-thought","format-huddle-large-recorded","format-huddle-large-thought-recorded","chain-0","winner-mystery-vote"].includes(item.name)) {
        const recorded = item.name.endsWith("-recorded");
        await renderMedia({serveUrl,composition:exported,inputProps,codec:"h264",audioCodec:"aac",muted:!recorded,outputLocation:`${prefix}.mp4`,concurrency:2,puppeteerInstance:browser});
        for(const frame of samples) {
          const encoded=`${prefix}-${frame}-encoded.png`;
          await runProcess("ffmpeg",["-y","-v","error","-i",`${prefix}.mp4`,"-vf",`select=eq(n\\,${frame})`,"-frames:v","1",encoded]);
          const meanDifference=difference(await pixels(`${prefix}-${frame}-viewer.png`),await pixels(encoded));
          encodedResults.push({name:item.name,frame,meanDifference,video:`${prefix}.mp4`});
          if(meanDifference>4) throw new Error(`Encoded/viewer mismatch: ${item.name}: ${meanDifference}`);
        }
        if (recorded) {
          const pcm = async(path:string,destination:string,startMs=0) => {
            await runProcess("ffmpeg",["-y","-v","error","-ss",String(startMs/1000),"-i",path,"-t","2","-ar","2000","-ac","1","-f","f32le",destination]);
            const buffer=await readFile(destination);return new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
          };
          const expected=await pcm(join(serveUrl,"assets/format-context-voice.wav"),join(scratch,"expected.pcm"));
          const actual=await pcm(`${prefix}.mp4`,join(scratch,"actual.pcm"),timeline[0]!.recording!.startMs);
          const alignment=compareRecordingPcm(expected,Array.from(actual),2000,50);
          if(alignment.correlation<.98 || alignment.relativeError>.25) throw new Error(`Recorded audio differs: ${JSON.stringify(alignment)}`);
          audioResults.push({name:item.name,alignment});
        }
      }
      console.log(`Verified ${item.name} ${width}×${height}`);
    }
  } finally {await browser.close({silent:true});}
  await writeFile(join(output,"comparison.json"),JSON.stringify({source:"deterministic fixtures; actual viewer components versus Studio/export composition",reverseOrder:true,frames:results,studio:studioResults,encoded:encodedResults,audio:audioResults},null,2));
  console.log(`Saved ${results.length} comparisons and ${new Set(encodedResults.map(row=>row.video)).size} fresh videos: ${output}`);
} finally {await rm(scratch,{recursive:true,force:true});}
