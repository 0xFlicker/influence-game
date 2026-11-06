/** Opt-in local parity proof. No API, model, speech-provider or deployment calls. */
import {mkdir,mkdtemp,readFile,writeFile,cp,rm} from "node:fs/promises";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import {bundle} from "@remotion/bundler";
import {openBrowser,renderFrames,renderStill,renderMedia,selectComposition} from "@remotion/renderer";
import tailwindConfig from "../../tailwind.config";
import {alliancePresentationFixture} from "./alliance-presentation-fixture";
import {buildExportCues} from "../lib/replay-export/cues";
import {compilePresentation} from "../lib/replay-export/presentation";
import {parseTimingProfile} from "../lib/replay-export/timing";
import type {ReplayManifest} from "../lib/replay-export/manifest";
import {validateManifest} from "../lib/replay-export/manifest";
import {runProcess,sha256,ReplayAssets} from "../lib/replay-export/assets";
import {compareRecordingPcm} from "./recording-alignment";
import {withPreparedReplay} from "../lib/replay-export/render";

const webRoot=resolve(import.meta.dir,"../.."),output=resolve(process.argv[2] ?? join(tmpdir(),`alliance-parity-${Date.now()}`));
await mkdir(output,{recursive:true});
const scratch=await mkdtemp(join(tmpdir(),"alliance-proof-"));
const widthArguments=process.argv.slice(3).filter(argument=>argument.startsWith("--width="));
const onlyWidths=new Set(widthArguments.map(argument=>Number(argument.slice(8))));
if([...onlyWidths].some(width=>![1280,640,320].includes(width))) throw new Error("Unknown proof width");
const onlyCases=new Set(process.argv.slice(3).filter(argument=>!argument.startsWith("--width=")));
const comparisons:unknown[]=[],encoded:unknown[]=[];
const pixels=async(path:string)=>{
  const destination=join(scratch,`${sha256(path)}.rgb`);
  await runProcess("ffmpeg",["-y","-v","error","-i",path,"-pix_fmt","rgb24","-f","rawvideo",destination]);
  return readFile(destination);
};
const meanDifference=async(a:string,b:string)=>{
  const [left,right]=await Promise.all([a,b].map(pixels));
  if(left.length!==right.length) throw new Error("Comparison geometry differs");
  return left.reduce((sum,value,index)=>sum+Math.abs(value-right[index]!),0)/left.length;
};
try {
  const publicDir=join(scratch,"public");
  await mkdir(join(publicDir,"assets"),{recursive:true});
  for(const path of ["logo.png","avatars/personas/strategic.png","avatars/personas/observer.png","visual/influence/rooms-v1/lobby.jpg"]) {
    await mkdir(dirname(join(publicDir,path)),{recursive:true});await cp(join(webRoot,"public",path),join(publicDir,path));
  }
  await runProcess("ffmpeg",["-y","-v","error","-f","lavfi","-i","sine=frequency=523:sample_rate=44100","-t","15",join(publicDir,"assets/voice.wav")]);
  const cache=new ReplayAssets(publicDir,join(webRoot,"public"),new URL("http://127.0.0.1"),new AbortController().signal);
  const large=await alliancePresentationFixture(15),small=await alliancePresentationFixture(3),old=await alliancePresentationFixture(3,true),summary=await alliancePresentationFixture(3,false,true);
  const definitions=[{name:"large-cast",fixture:large,ids:[large.introId!],voice:false,music:false},
    {name:"source",fixture:small,ids:small.catalog.moments.map(moment=>moment.id),voice:false,music:true},
    {name:"intro-only",fixture:small,ids:[small.introId!],voice:false,music:false},
    {name:"handoff",fixture:small,ids:[small.introId!,small.thoughtId,small.speechId],voice:false,music:true},
    {name:"conversation-only",fixture:small,ids:[small.speechId],voice:false,music:false},
    {name:"thought-only",fixture:small,ids:[small.thoughtId],voice:false,music:false},
    {name:"historical",fixture:old,ids:[old.speechId],voice:false,music:false},
    {name:"recorded",fixture:small,ids:[small.introId!],voice:true,music:false},
    {name:"summary",fixture:summary,ids:[summary.introId!],voice:false,music:false},
    {name:"large-cast-reduced",fixture:large,ids:[large.introId!],voice:false,music:false,reduced:true}];
  const cases:Array<typeof definitions[number] & {bound:typeof small.bound}>=[];
  // Freeze all selected assets before bundling, exactly as the production preparer does.
  for(const item of definitions) {
    if(onlyCases.size && !onlyCases.has(item.name)) continue;
    const bound=structuredClone(item.fixture.bound);
    if(item.voice) {
      const cue=bound.find(moment=>moment.id===item.fixture.introId)!.segments[0]!;
      cue.timing.recording={assetId:await cache.cache(join(publicDir,"assets/voice.wav"),true),durationMs:15000};
      const text=cue.speech!.text,words=[...text.matchAll(/\S+/gu)];
      cue.alignment=words.map((match,index)=>({textStart:match.index!,textEnd:match.index!+match[0].length,startMs:index*15000/words.length,endMs:(index+1)*15000/words.length}));
    }
    for(const moment of bound) moment.segments=item.ids.includes(moment.id)
      ? await Promise.all(moment.segments.map(cue=>cache.freeze({...cue,music:item.music ? cue.music : null}))) : [];
    cases.push({...item,bound});
  }
  if(!cases.length) throw new Error("No known verification cases selected");
  const css=await postcss([tailwind({...tailwindConfig,content:[join(webRoot,"src/**/*.{ts,tsx}")]}),autoprefixer]).process(await readFile(join(webRoot,"src/app/globals.css"),"utf8"),{from:join(webRoot,"src/app/globals.css")});
  await writeFile(join(scratch,"parity.css"),css.css);
  await writeFile(join(scratch,"entry.tsx"),`import "./parity.css";\nimport ${JSON.stringify(join(import.meta.dir,"alliance-presentation-frame.tsx"))};`);
  const serveUrl=await bundle({entryPoint:join(scratch,"entry.tsx"),rootDir:webRoot,publicDir,outDir:join(scratch,"bundle"),ignoreRegisterRootWarning:true,
    webpackOverride:config=>{
      for(const rule of config.module?.rules ?? []) if(rule && typeof rule==="object" && Array.isArray(rule.use))
        for(const loader of rule.use) if(loader && typeof loader==="object" && loader.loader?.includes("css-loader")) loader.options={...(typeof loader.options==="object" ? loader.options : {}),url:false};
      return {...config,resolve:{...config.resolve,alias:{...config.resolve?.alias,"@":join(webRoot,"src")}}};
    }});
  await cp(publicDir,serveUrl,{recursive:true});
  const browser=await openBrowser("chrome",{browserExecutable:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try {
    for(const [width,height] of [[1280,720],[640,360],[320,480]] as const) for(const item of cases) {
      if(onlyWidths.size && !onlyWidths.has(width)) continue;
      if(width===320 && !["large-cast","recorded"].includes(item.name)) continue;
      const bound=item.bound,assets=cache.table;
      const profile=parseTimingProfile({ending:{holdMs:0}}),fps=30;
      const compiled=compilePresentation({source:bound,selectedIds:item.ids,profile,fps,assets,music:item.music});
      const raw=buildExportCues(item.fixture.source);
      const references=compiled.cues.map(cue=>raw.find(reference=>reference.picture.kind==="influence-opening" && cue.picture.kind==="influence-opening"
        ? reference.picture.cue.key===cue.picture.cue.key
        : reference.source.kind==="influence" && cue.source.kind==="influence" && reference.source.transcriptId===cue.source.transcriptId)!);
      let manifest:ReplayManifest={schema:"house.replay-export",version:2,game:{id:"alliance-proof",slug:item.name,kind:"influence"},width,height,fps,reducedMotion:"reduced" in item && item.reduced === true,thinking:item.ids.includes(item.fixture.thoughtId),profile,
        cues:compiled.cues,timeline:compiled.timeline,audio:compiled.audio,assets,staticFiles:{},boundary:{},range:{fromFrame:0,untilFrame:compiled.timeline.at(-1)!.endFrame},revision:"deterministic-fixture",dirty:true};
      // Keep the complete Source cut; focus its proof range on the alliance sequence.
      const allianceStart=compiled.cues.findIndex(cue=>cue.picture.kind!=="influence-opening");
      if(allianceStart<0) throw new Error("No alliance cue in proof");
      manifest.range.fromFrame=compiled.timeline[allianceStart]!.startFrame;
      const preparing={manifest:{...manifest,cues:manifest.cues.slice(allianceStart),timeline:manifest.timeline.slice(allianceStart)},references:references.slice(allianceStart),prepare:true};
      const measuring=await selectComposition({serveUrl,id:"Export",inputProps:preparing,puppeteerInstance:browser});
      const pages:NonNullable<ReplayManifest["pages"]>={},layouts:NonNullable<ReplayManifest["layouts"]>={};
      await renderFrames({serveUrl,composition:measuring,inputProps:preparing,outputDir:join(scratch,"measure"),imageFormat:"png",concurrency:1,puppeteerInstance:browser,
        onStart:()=>{},onFrameUpdate:()=>{},onArtifact:artifact=>{if(artifact.filename.startsWith("layout-")){const data=JSON.parse(String(artifact.content));Object.assign(pages,data.pages);Object.assign(layouts,data.layouts);}}});
      manifest={...manifest,pages,layouts};
      if(item.ids.includes(item.fixture.introId!)) {
        const caption=Object.entries(pages).find(([key])=>key.includes(item.fixture.intro.text));
        const normalized=(text:string)=>text.replace(/\s+/gu," ").trim();
        if(!caption || normalized(caption[1].join(" "))!==normalized(item.fixture.intro.text)) throw new Error("Prepared captions do not retain the complete accepted House text");
      }
      const prefix=join(output,`${item.name}-${width}`),inputProps={manifest,references};
      await writeFile(`${prefix}.manifest.json`,JSON.stringify(manifest,null,2));
      const compositions=await Promise.all(["Viewer","Studio","Export"].map(id=>selectComposition({serveUrl,id,inputProps,puppeteerInstance:browser})));
      const samples=new Set<number>();
      for(const [index,timing] of compiled.timeline.entries()) {
        if(compiled.cues[index]!.picture.kind==="influence-opening") continue;
        const length=timing.endFrame-timing.startFrame;
        for(const fraction of [.015,.18,.38,.62,.85,.985]) samples.add(Math.min(timing.endFrame-1,timing.startFrame+Math.floor(length*fraction))-manifest.range.fromFrame);
      }
      const frameHashes=new Map<number,string>(),names=new Set<string>();
      for(const frame of samples) {
        const audits:unknown[]=[];
        const paths=["viewer","studio","export"].map(mode=>`${prefix}-${frame}-${mode}.png`);
        for(const [index,composition] of compositions.entries()) await renderStill({serveUrl,composition,inputProps,frame,output:paths[index]!,imageFormat:"png",puppeteerInstance:browser,timeoutInMilliseconds:60000,
          onArtifact:artifact=>{if(artifact.filename.startsWith("audit-")){const data=JSON.parse(String(artifact.content));audits.push(data);for(const id of data.members) names.add(id);}}});
        const differences=await Promise.all(paths.slice(1).map(path=>meanDifference(paths[0]!,path)));
        if(differences.some(value=>value>1)) throw new Error(`Viewer/Studio/export difference ${item.name} ${width} ${frame}: ${differences}`);
        frameHashes.set(frame,sha256(await readFile(paths[2]!)));
        comparisons.push({name:item.name,width,height,frame,differences,paths,audits});
      }
      if(item.name.startsWith("large-cast") && names.size!==15) throw new Error(`Not every cast page was sampled (${names.size})`);
      for(const frame of [...samples].reverse()) {
        const path=`${prefix}-${frame}-reverse.png`;
        await renderStill({serveUrl,composition:compositions[2]!,inputProps,frame,output:path,imageFormat:"png",puppeteerInstance:browser,timeoutInMilliseconds:60000});
        if(sha256(await readFile(path))!==frameHashes.get(frame)) {
          const difference=await meanDifference(`${prefix}-${frame}-export.png`,path);
          if(difference>.01) throw new Error(`Reverse/direct seek frame changed ${item.name} ${width} frame ${frame}: ${difference}`);
        }
      }
      if(width===640 && ["handoff","recorded"].includes(item.name)) {
        const video=`${prefix}.mp4`;
        const bundleDir=`${prefix}.bundle`,used=JSON.stringify([manifest.cues,manifest.audio]);
        const retainedAssets=Object.fromEntries(Object.entries(assets).filter(([id,asset])=>used.includes(id) || used.includes(asset.path)));
        await mkdir(join(bundleDir,"assets"),{recursive:true});
        for(const asset of Object.values(retainedAssets)) await cp(join(publicDir,asset.path),join(bundleDir,asset.path));
        const staticFiles:Record<string,string>={};
        for(const path of ["logo.png","avatars/personas/strategic.png","avatars/personas/observer.png","visual/influence/rooms-v1/lobby.jpg"]) {
          const target=join(bundleDir,"static",path);await mkdir(dirname(target),{recursive:true});
          await cp(join(publicDir,path),target);staticFiles[`static/${path}`]=sha256(await readFile(target));
        }
        const frozen={...manifest,assets:retainedAssets,staticFiles};
        validateManifest(frozen);
        await writeFile(join(bundleDir,"manifest.json"),JSON.stringify(frozen,null,2));
        await withPreparedReplay(frozen,bundleDir,new AbortController().signal,async (preparedUrl,prepared,cancelSignal)=>{
          // A separately registered production composition gets its own browser.
          const encoder=await openBrowser("chrome",{browserExecutable:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
          try {
          const props={manifest:prepared};
          const composition=await selectComposition({serveUrl:preparedUrl,id:"HouseReplay",inputProps:props,puppeteerInstance:encoder,timeoutInMilliseconds:60000});
          await renderMedia({serveUrl:preparedUrl,composition,inputProps:props,codec:"h264",audioCodec:"aac",outputLocation:video,concurrency:2,cancelSignal,puppeteerInstance:encoder,timeoutInMilliseconds:60000});
          } finally {await encoder.close({silent:true});}
        });
        for(const frame of [...samples].filter((_,index)=>index%2===0)) {
          const path=`${prefix}-${frame}-encoded.png`;
          await runProcess("ffmpeg",["-y","-v","error","-i",video,"-vf",`select=eq(n\\,${frame})`,"-frames:v","1",path]);
          const difference=await meanDifference(`${prefix}-${frame}-viewer.png`,path);
          if(difference>4) throw new Error(`Encoded frame differs: ${difference}`);
          encoded.push({name:item.name,frame,difference,video});
        }
        if(item.voice) {
          const pcm=async(path:string,name:string)=>{
            const destination=join(scratch,name);
            await runProcess("ffmpeg",["-y","-v","error","-i",path,"-ar","2000","-ac","1","-f","f32le",destination]);
            const buffer=await readFile(destination);return new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
          };
          const expected=await pcm(join(publicDir,"assets/voice.wav"),"expected.pcm"),actual=await pcm(video,"encoded.pcm");
          const alignment=compareRecordingPcm(expected,Array.from(actual),2000,50);
          if(alignment.correlation<.98 || alignment.relativeError>.25) throw new Error(`Recorded audio placement differs: ${JSON.stringify(alignment)}`);
          encoded.push({name:"recorded-audio",alignment});
        }
      }
      console.log(`Verified ${item.name} ${width}x${height}`);
      await writeFile(join(output,"comparison.json"),JSON.stringify({source:"deterministic accepted presentation fixtures; actual viewer, Studio Player and exporter",reverseOrder:true,comparisons,encoded},null,2));
    }
  } finally {await browser.close({silent:true});}
  if(!comparisons.length) throw new Error("No presentation frames verified");
  console.log(`Saved parity proof: ${output}`);
} finally {await rm(scratch,{recursive:true,force:true});}
