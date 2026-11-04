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
import type {GameWatchReplayFrame} from "../lib/api";
import {buildExportCues, type ExportCue} from "../lib/replay-export/cues";
import {thinkingSegment} from "../lib/replay-export/presentation";
import {compileTiming, parseTimingProfile} from "../lib/replay-export/timing";
import type {ReplayManifest} from "../lib/replay-export/manifest";
import {runProcess, sha256} from "../lib/replay-export/assets";

const webRoot = resolve(import.meta.dir,"../.."), repoRoot = resolve(webRoot,"../..");
const output = resolve(process.argv[2] ?? join(repoRoot,".renders",`presentation-parity-${Date.now()}`));
await mkdir(output,{recursive:true});
const cases:{name:string;cue:ExportCue;reference:ExportCue}[] = [];
const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
const players = fixture.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false,avatarUrl:"/avatars/personas/strategic.png"}));
const frames:GameWatchReplayFrame[] = fixture.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,
  counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0}}));
const influence = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages:[],frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],
  fullBodies:Object.fromEntries(players.map(player=>[player.id,"/avatars/personas/full-body-v1/strategic.webp"]))}});
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
// Optional saved, already-authorized source cases let a repair prove the actual
// changed adapter rather than replacing its evidence with unrelated fixtures.
const suppliedCases = process.argv[3];
const proofSource = suppliedCases ? `Saved authorized source cases: ${resolve(suppliedCases)}` : "Deterministic fixtures; actual viewer components versus Studio/export composition";
if (suppliedCases) cases.splice(0, cases.length, ...JSON.parse(await readFile(resolve(suppliedCases), "utf8")));
const scratch=await mkdtemp(join(tmpdir(),"house-parity-"));
const results:{name:string;width:number;height:number;frame:number;meanDifference:number;exportHash:string;viewer:string;export:string}[]=[];
const encodedResults:{name:string;frame:number;meanDifference:number;video:string}[]=[];
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
  const browser=await openBrowser("chrome",{browserExecutable:process.env.REPLAY_BROWSER_EXECUTABLE});
  try {
    for(const [width,height] of [[1280,720],[640,360],...(suppliedCases ? [[390,700] as const] : [])] as const) for(const item of cases) {
      const profile=parseTimingProfile({ending:{holdMs:0}}),fps=30;
      const timeline=compileTiming([item.cue.timing],profile,fps);
      let manifest:ReplayManifest={schema:"house.replay-export",version:2,game:{id:"fixture",slug:item.name,kind:item.cue.picture.kind === "thinking" ? "influence" : "werewolf"},
        width,height,fps,reducedMotion:false,thinking:item.cue.picture.kind === "thinking",profile,cues:[item.cue],timeline,assets:{},staticFiles:{},boundary:{},audio:{clips:[],durationMs:timeline[0]!.endMs},
        range:{fromFrame:0,untilFrame:timeline[0]!.endFrame},revision:"fixture",dirty:true};
      const prefix=join(output,`${item.name}-${width}`);
      // The same layout prepass used by the local exporter freezes typography before encoding.
      const preparation={manifest,reference:item.reference,prepare:true};
      const measuring=await selectComposition({serveUrl,id:"Export",inputProps:preparation,puppeteerInstance:browser});
      const layouts:NonNullable<ReplayManifest["layouts"]>={},pages:NonNullable<ReplayManifest["pages"]>={};
      await renderFrames({serveUrl,composition:measuring,inputProps:preparation,outputDir:join(scratch,"measure"),imageFormat:"png",concurrency:1,puppeteerInstance:browser,
        onStart:()=>{},onFrameUpdate:()=>{},onArtifact:artifact=>{const data=JSON.parse(typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content));Object.assign(layouts,data.layouts);Object.assign(pages,data.pages);}});
      manifest={...manifest,layouts,pages};
      await writeFile(`${prefix}.manifest.json`,JSON.stringify(manifest,null,2));
      const inputProps={manifest,reference:item.reference};
      const exported=await selectComposition({serveUrl,id:"Export",inputProps,puppeteerInstance:browser});
      const viewer=await selectComposition({serveUrl,id:"Viewer",inputProps,puppeteerInstance:browser});
      const thought=timeline[0]!.thought;
      const samples=thought ? [Math.round(thought.enterMs*.5*fps/1000),Math.round((thought.readAtMs+500)*fps/1000),Math.round((thought.returnAtMs+450)*fps/1000)] : (item.cue.picture.kind === "werewolf-opening" || item.cue.picture.kind === "werewolf" && item.cue.picture.cue.reprise) ? [...new Set([0, 15, 60, manifest.range.untilFrame - 1].map(frame => Math.min(frame, manifest.range.untilFrame - 1)))] : [Math.min(60,manifest.range.untilFrame-1)];
      for(const frame of samples) {
        const paths={viewer:`${prefix}-${frame}-viewer.png`,export:`${prefix}-${frame}-export.png`};
        await renderStill({serveUrl,composition:viewer,inputProps,frame,output:paths.viewer,imageFormat:"png",puppeteerInstance:browser});
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:paths.export,imageFormat:"png",puppeteerInstance:browser});
        const meanDifference=difference(await pixels(paths.viewer),await pixels(paths.export));
        results.push({name:item.name,width,height,frame,meanDifference,exportHash:sha256(await readFile(paths.export)),...paths});
        await writeFile(join(output,"comparison.json"),JSON.stringify({source:proofSource,frames:results},null,2));
        if(meanDifference>1) throw new Error(`Viewer/export mismatch: ${item.name} ${width} frame ${frame}: ${meanDifference}`);
      }
      // Verify random-access stability independently of the comparison order.
      for(const frame of samples.toReversed()) {
        const path=join(scratch,"reverse.png");
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:path,imageFormat:"png",puppeteerInstance:browser});
        if(sha256(await readFile(path))!==results.find(row=>row.name===item.name && row.width===width && row.frame===frame)!.exportHash) throw new Error("Reverse-order render mismatch");
      }
      if(width===640 && (suppliedCases || item.name === "chain-0" || item.name === "winner-mystery-vote")) {
        await renderMedia({serveUrl,composition:exported,inputProps,codec:"h264",muted:true,outputLocation:`${prefix}.mp4`,concurrency:2,puppeteerInstance:browser});
        for(const frame of samples) {
          const encoded=`${prefix}-${frame}-encoded.png`;
          await runProcess("ffmpeg",["-y","-v","error","-i",`${prefix}.mp4`,"-vf",`select=eq(n\\,${frame})`,"-frames:v","1",encoded]);
          const meanDifference=difference(await pixels(`${prefix}-${frame}-viewer.png`),await pixels(encoded));
          encodedResults.push({name:item.name,frame,meanDifference,video:`${prefix}.mp4`});
          if(meanDifference>4) throw new Error(`Encoded/viewer mismatch: ${item.name}: ${meanDifference}`);
        }
      }
      console.log(`Verified ${item.name} ${width}×${height}`);
    }
  } finally {await browser.close({silent:true});}
  await writeFile(join(output,"comparison.json"),JSON.stringify({source:proofSource,reverseOrder:true,frames:results,encoded:encodedResults},null,2));
  console.log(`Saved ${results.length} comparisons and ${encodedResults.length} encoded-frame checks: ${output}`);
} finally {await rm(scratch,{recursive:true,force:true});}
