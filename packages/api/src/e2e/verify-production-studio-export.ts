/** Opt-in local API → frozen cut → encoded movie proof. No providers or shared DB mutations.
 * Run from the repository root:
 * bun packages/api/src/e2e/verify-production-studio-export.ts [/private/tmp/proof-directory]
 * Output is retained; its API server, subprocess groups and isolated database are removed.
 */
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {spawn, type ChildProcess} from "node:child_process";
import {Hono} from "hono";
import {decodeProductionExport, type ProductionExportDescriptor} from "@influence/engine/production-moments/export";
import type {ProductionCatalog} from "@influence/engine/production-moments";
import type {ProductionRecording} from "@influence/engine/production-moments/recordings";
import {createVisualReplayProductionRoutes} from "../routes/visual-replay-production.js";
import {createProductionStudioRoutes} from "../routes/production-studio.js";
import type {AuthEnv} from "../middleware/auth.js";
import {seedProductionStudioFixture} from "../__tests__/production-studio-fixtures.js";
import {createIsolatedTestDb, destroyIsolatedTestDb, type TestDB} from "./test-db.js";
import {cleanupE2eResources} from "./cleanup.js";
import {observeHarnessSignals} from "./harness-signals.js";

const repoRoot = resolve(import.meta.dir,"../../../..");
const hash = (bytes:string|Uint8Array) => createHash("sha256").update(bytes).digest("hex");
interface SourcePage {
  snapshot:Record<string,unknown>;catalog:ProductionCatalog;
  messages?:{id:number;text:string}[];
}
interface PreparedManifest {
  cues:{momentId?:string;speech:{text:string}|null;picture:{kind:string};timing:{thinking:string|null}}[];
  width:number;height:number;fps:number;range:{fromFrame:number;untilFrame:number};
  boundary:{selectionHash:string;sourceHash:string};audio:{clips:{purpose:string}[]};
  assets:Record<string,{sha256:string;mediaType:string;durationMs?:number}>;
}

function tone(durationMs:number):Buffer {
  const sampleRate = 24000, samples = Math.round(sampleRate * durationMs / 1000);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write("data",36);wav.writeUInt32LE(samples*2,40);
  for (let index=0;index<samples;index++) {
    const envelope = Math.min(1,index/240,(samples-index-1)/240);
    const time = index/sampleRate;
    // A chirp gives the PCM proof a unique temporal match; a single pitch repeats every cycle.
    const phase = 2*Math.PI*(440*time + 560*time*time/(2*durationMs/1000));
    wav.writeInt16LE(Math.round(5000*envelope*Math.sin(phase)),44+index*2);
  }
  return wav;
}

function killGroup(child:ChildProcess,signal:NodeJS.Signals) {
  if (!child.pid) return;
  try {process.kill(-child.pid,signal);}
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

async function main() {
  const signals = observeHarnessSignals(),children = new Set<ChildProcess>();
  let database:TestDB|undefined,server:ReturnType<typeof Bun.serve>|undefined;
  const originalSecret = process.env.JWT_SECRET;
  const output = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp("/private/tmp/production-studio-export-");
  await mkdir(output,{recursive:true});
  // The fixture signs this local-only token; neither secret nor token is written to output.
  process.env.JWT_SECRET = randomUUID();
  const run = (args:string[],token?:string):Promise<void> => new Promise((accept,reject) => {
    signals.signal.throwIfAborted();
    const child = spawn(process.execPath,args,{cwd:repoRoot,detached:true,stdio:["ignore","pipe","pipe"],
      env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,...(token && {INFLUENCE_API_SESSION_TOKEN:token})}});
    children.add(child);let errorOutput = "";
    child.stdout?.on("data",chunk => process.stdout.write(chunk));
    child.stderr?.on("data",chunk => {errorOutput = (errorOutput + String(chunk)).slice(-8000);process.stderr.write(chunk);});
    const abort = () => killGroup(child,"SIGTERM");
    signals.signal.addEventListener("abort",abort,{once:true});
    child.once("error",reject);
    child.once("close",code => {
      signals.signal.removeEventListener("abort",abort);
      // Remotion owns browser teardown on success. Reap any group members left after failures.
      try {killGroup(child,"SIGKILL");children.delete(child);} catch (error) {reject(error);return;}
      if (code === 0) accept();else reject(new Error(`Local proof command exited ${code}: ${errorOutput}`));
    });
  });
  try {
    database = await createIsolatedTestDb({signal:signals.signal});
    const fixture = await seedProductionStudioFixture(database.db);
    const app = new Hono<AuthEnv>();
    app.route("/",createVisualReplayProductionRoutes(database.db));app.route("/",createProductionStudioRoutes(database.db));
    server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:app.fetch});
    const origin = `http://127.0.0.1:${server.port}`,token = fixture.producer.token;
    const request = async <T>(path:string,body?:unknown):Promise<T> => {
      const response = await fetch(`${origin}${path}`,{method:body === undefined ? "GET" : "POST",signal:signals.signal,
        headers:{Authorization:`Bearer ${token}`,...(body !== undefined && {"Content-Type":"application/json"})},
        ...(body !== undefined && {body:JSON.stringify(body)})});
      if (!response.ok) throw new Error(`Local API ${response.status} at ${path.split("?")[0]}: ${await response.text()}`);
      return await response.json() as T;
    };
    const root = (id:string) => `/api/admin/production/games/${encodeURIComponent(id)}`;
    const influence = await request<SourcePage>(`${root(fixture.influence.id)}/source?audience=public&thinking=on&limit=256`);
    const werewolf = await request<SourcePage>(`${root(fixture.werewolf.id)}/source?audience=omniscient&thinking=on&limit=64`);
    const thought = werewolf.catalog.moments.find(moment => moment.kind === "thinking"),spoken = werewolf.catalog.moments.find(moment => moment.kind === "speech");
    if (!thought || !spoken) throw new Error("Local fixture needs independently selectable Werewolf thinking and speech");
    const influenceSpeech = influence.catalog.moments.find(moment => moment.id === fixture.influence.speechId);
    if (influenceSpeech?.source.kind !== "influence-transcript") throw new Error("Local Influence speech is missing immutable transcript provenance");
    const transcriptId = influenceSpeech.source.transcriptId;
    const transcript = influence.messages?.find(message => String(message.id) === transcriptId);
    if (!transcript) throw new Error("Local Influence recording text is missing from its source page");
    const durationMs = 1500,wav = tone(durationMs),wavFile = join(output,"local-tone.wav");await writeFile(wavFile,wav);
    const attachment = {messageId:String(transcript.id),speakerId:influenceSpeech.actorId ?? null,textHash:hash(transcript.text),file:"local-tone.wav"};
    const speechManifest = join(output,"speech.json");await writeFile(speechManifest,JSON.stringify([attachment],null,2));
    const recording:ProductionRecording = {momentId:influenceSpeech.id,messageId:attachment.messageId,speakerId:attachment.speakerId,
      textHash:attachment.textHash,sha256:hash(wav),durationMs};
    const settings = {width:640,height:360,fps:24,reducedMotion:false,music:false,volume:1,
      profile:{readingRate:4,thinkingRate:4,motionScale:2,conversationGapMs:0,postSpeechHoldMs:100,ending:{holdMs:0},overrides:{}}};
    const cases = [
      {name:"werewolf-thinking",id:fixture.werewolf.id,audience:"omniscient",page:werewolf,ids:[thought.id],recordings:[]},
      {name:"werewolf-speech",id:fixture.werewolf.id,audience:"omniscient",page:werewolf,ids:[spoken.id],recordings:[]},
      {name:"influence-scene-recording",id:fixture.influence.id,audience:"public",page:influence,
        ids:[fixture.influence.speechId,fixture.influence.roomSpeechId],recordings:[recording],speechManifest},
    ];
    const evidence:unknown[] = [];
    for (const cut of cases) {
      console.log(`Freezing and encoding ${cut.name}…`);
      const ids = cut.page.catalog.moments.filter(moment => cut.ids.includes(moment.id)).map(moment => moment.id);
      if (ids.length !== cut.ids.length) throw new Error(`Selected source page is missing ${cut.name} moments`);
      const descriptor:ProductionExportDescriptor = decodeProductionExport(await request(`${root(cut.id)}/selection`,{
        snapshot:cut.page.snapshot,audience:cut.audience,thinking:true,selection:{mode:"ids",thinking:true,ids},expectedMomentIds:ids,
        settings,copy:{},recordings:cut.recordings}));
      const selection = join(output,`${cut.name}.selection.json`),video = join(output,`${cut.name}.mp4`);
      await writeFile(selection,JSON.stringify(descriptor,null,2));
      await run(["run","replay:export","--selection",selection,"--output",video,"--api-base-url",origin,
        ...(cut.speechManifest ? ["--speech-manifest",cut.speechManifest] : [])],token);
      const bundle = video.replace(/\.mp4$/,".bundle"),proofDirectory = join(output,`${cut.name}-proof`);
      const manifest = JSON.parse(await readFile(join(bundle,"manifest.json"),"utf8")) as PreparedManifest;
      if (manifest.boundary.selectionHash !== descriptor.hash || manifest.boundary.sourceHash !== descriptor.sourceSnapshot.sourceHash
        || manifest.width !== settings.width || manifest.height !== settings.height || manifest.fps !== settings.fps
        || new Set(manifest.cues.map(cue => cue.momentId)).size !== ids.length || manifest.cues.some(cue => !ids.includes(cue.momentId ?? "")))
        throw new Error("Prepared movie disagrees with its frozen selected IDs or settings");
      if (cut.name === "werewolf-thinking" && manifest.cues.some(cue => cue.picture.kind !== "thinking" || cue.speech !== null)) throw new Error("Thought-only cut leaked omitted speech");
      if (cut.name === "werewolf-speech" && manifest.cues.some(cue => cue.picture.kind === "thinking" || cue.timing.thinking !== null)) throw new Error("Speech-only cut leaked omitted thinking");
      if (cut.recordings.length ? manifest.audio.clips.length !== 1 || manifest.audio.clips[0]!.purpose !== "speech" : manifest.audio.clips.length !== 0)
        throw new Error("Music-off proof has an unexpected audio schedule");
      await run(["run","packages/web/src/scripts/verify-house-replay-export.ts",bundle,proofDirectory,video]);
      const proof:unknown = JSON.parse(await readFile(join(proofDirectory,"proof.json"),"utf8"));
      evidence.push({name:cut.name,video,sha256:hash(await readFile(video)),selectionHash:descriptor.hash,sourceHash:descriptor.sourceSnapshot.sourceHash,
        momentIds:ids,durationSeconds:(manifest.range.untilFrame-manifest.range.fromFrame)/manifest.fps,assets:manifest.assets,proof});
    }
    await writeFile(join(output,"proof.json"),JSON.stringify({kind:"local-provider-free-api-and-encoded-proof",syntheticAudio:true,cuts:evidence},null,2));
    console.log(`PRODUCTION_STUDIO_ENCODED_PROOF ${join(output,"proof.json")}`);
  } finally {
    signals.dispose();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;else process.env.JWT_SECRET = originalSecret;
    await cleanupE2eResources([
      ["export/browser subprocess groups",() => {for (const child of children) killGroup(child,"SIGKILL");}],
      ["local API",async () => {if (server) await server.stop(true);}],
      ["isolated database",async () => {if (database) await destroyIsolatedTestDb(database.databaseUrl);}]
    ]);
  }
}
await main().catch(error => {console.error(error);process.exitCode = 1;});
