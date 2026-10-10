import {spawn} from "node:child_process";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import sharp from "sharp";
import type {ProductionExportDescriptor} from "@influence/engine/production-moments/export";

interface PreparedParityManifest {
  width:number;height:number;fps:number;range:{untilFrame:number};boundary:{selectionHash?:string};
  cues:{momentId?:string;picture:{kind:string};speech:unknown|null}[];audio:{clips:unknown[]};
  timeline:{startMs:number;thought:{enterMs:number;readAtMs:number;returnAtMs:number;duration:number;insertAt:number}|null}[];
}

/** Uses the browser's actual frozen selection and the harness's existing local API.
 * The caller retains its browser/API/database until this bounded proof completes.
 */
export async function verifyStudioEncodedParity({descriptor, token, origin, output, captureFrame}: {
  descriptor:ProductionExportDescriptor;token:string;origin:string;output:string;
  captureFrame:(frame:number)=>Promise<Uint8Array>;
}) {
  await mkdir(output,{recursive:true});
  const repoRoot = resolve(import.meta.dir,"../../../.."),selection = join(output,"studio.selection.json"),video = join(output,"studio.mp4");
  await writeFile(selection,JSON.stringify(descriptor,null,2));
  const run = (binary:string,args:string[],withToken = false):Promise<void> => new Promise((accept,reject) => {
    const child = spawn(binary,args,{cwd:repoRoot,detached:true,stdio:["ignore","pipe","pipe"],
      env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,...(withToken && {INFLUENCE_API_SESSION_TOKEN:token})}});
    let failure = "";
    const timer = setTimeout(()=>{if(child.pid) process.kill(-child.pid,"SIGTERM");},180_000);
    child.stdout?.on("data",data=>process.stdout.write(data));
    child.stderr?.on("data",data=>{failure=(failure+String(data)).slice(-8000);process.stderr.write(data);});
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("close",code=>{
      clearTimeout(timer);
      if(child.pid) try {process.kill(-child.pid,"SIGKILL");} catch(error) {
        if(!(error instanceof Error && "code" in error && error.code === "ESRCH")) {reject(error);return;}
      }
      if(code===0) accept();else reject(new Error(`Studio encoded proof exited ${code}: ${failure}`));
    });
  });
  await run(process.execPath,["run","replay:export","--selection",selection,"--output",video,"--api-base-url",origin],true);
  const bundle = join(output,"studio.bundle"), manifest:PreparedParityManifest = JSON.parse(await readFile(join(bundle,"manifest.json"),"utf8"));
  if(manifest.width!==descriptor.settings.width || manifest.height!==descriptor.settings.height || manifest.fps!==descriptor.settings.fps
    || manifest.boundary.selectionHash!==descriptor.hash || manifest.cues.some(cue=>!descriptor.momentIds.includes(cue.momentId ?? "")))
    throw new Error("Encoded bundle differs from the Studio's frozen IDs or settings");
  const first = manifest.timeline[0]!,thought = first.thought;
  if(!thought || manifest.cues.some(cue=>cue.picture.kind!=="thinking" || cue.speech!==null) || manifest.audio.clips.length)
    throw new Error("Thought-only Studio bridge leaked omitted speech or audio");
  const frames = [...new Set([thought.enterMs/2,thought.readAtMs+500,(thought.returnAtMs+thought.duration)/2]
    .map(offset=>Math.min(manifest.range.untilFrame-1,Math.ceil((first.startMs+thought.insertAt+offset)*manifest.fps/1000))))];
  const differences: {frame:number;meanDifference:number;studio:string;encoded:string}[] = [];
  for(const frame of frames) {
    const studio = join(output,`studio-${frame}.png`),encoded = join(output,`encoded-${frame}.png`);
    await writeFile(studio,await captureFrame(frame));
    await run("ffmpeg",["-y","-v","error","-i",video,"-vf",`select=eq(n\\,${frame})`,"-frames:v","1",encoded]);
    const expected = await sharp(studio).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const actual = await sharp(encoded).removeAlpha().raw().toBuffer({resolveWithObject:true});
    if(expected.info.width!==manifest.width || expected.info.height!==manifest.height || expected.data.length!==actual.data.length)
      throw new Error(`Studio capture geometry differs at frame ${frame}: ${expected.info.width}×${expected.info.height}`);
    let difference = 0;
    for(let index=0;index<expected.data.length;index++) difference+=Math.abs(expected.data[index]!-actual.data[index]!);
    const meanDifference = difference/expected.data.length;
    differences.push({frame,meanDifference,studio,encoded});
    await writeFile(join(output,"studio-parity.json"),JSON.stringify({kind:"actual-local-studio-to-encoded-video",selectionHash:descriptor.hash,
      sourceHash:descriptor.sourceSnapshot.sourceHash,settings:descriptor.settings,momentIds:descriptor.momentIds,audio:{scheduledClips:0},frames:differences},null,2));
    if(meanDifference>12) throw new Error(`Studio and encoded composition disagree at frame ${frame}: mean pixel difference ${meanDifference}`);
  }
  await run(process.execPath,["run","packages/web/src/scripts/verify-house-replay-export.ts",bundle,join(output,"frame-proof"),video]);
  console.info(`STUDIO_ENCODED_PARITY ${join(output,"studio-parity.json")}`);
}
