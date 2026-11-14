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
import {werewolfPortraitRoom} from "../components/games/werewolf/werewolf-room-presentation";
import {Phase} from "@influence/engine";
import {completedCurrentWerewolfFixture, completedWerewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfProductionWatch} from "@influence/engine/werewolf/watch";
import {SOLO_READ_START_MS, visualSpeechReadingMs} from "@influence/engine/visual-speech";
import type {GameWatchReplayFrame, TranscriptEntry} from "../lib/api";
import {formatPresentationMetadata} from "@influence/engine/format-presentation-metadata";
import {portraitRoomPageCount} from "../app/games/[slug]/components/portrait-room-pagination";
import {WINNER_PAGE_MS, WINNER_PAGE_SIZE} from "../app/games/[slug]/components/winner-scene-timing";
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
const cases:{name:string;cue:ExportCue;reference:ExportCue;reducedMotion?:boolean;sequence?:ExportCue[];references?:ExportCue[]}[] = [];
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
const winnerPlayers = largePlayers.slice(0,12).map((player,index)=>index === 1 ? {...player,name:"Bartholomew Another Long Contestant Name"} : player);
const winnerEvent = {type:"jury.winner_determined" as const, sequence:100, timestamp:"2026-01-01T00:00:00Z", round:5, phase:Phase.JURY_VOTE,
  payload:{winnerId:winnerPlayers[0]!.id,votes:{[winnerPlayers[2]!.id]:winnerPlayers[0]!.id,[winnerPlayers[3]!.id]:winnerPlayers[1]!.id}}};
const winnerFrame:GameWatchReplayFrame = {...frames[0]!,sequence:100,eventType:winnerEvent.type,phase:"JURY_VOTE",players:winnerPlayers,viewerDecisionEvent:winnerEvent,
  counts:{totalPlayers:winnerPlayers.length,alivePlayers:winnerPlayers.length,eliminatedPlayers:0,unknownPlayers:0}};
const winnerExits:GameWatchReplayFrame[] = winnerPlayers.slice(2).map((player,index)=>{
  const event = {type:"player.eliminated" as const,sequence:index+1,timestamp:"2026-01-01T00:00:00Z",round:index+1,phase:Phase.VOTE,payload:{playerId:player.id,playerName:player.name}};
  return {...winnerFrame,sequence:event.sequence,eventType:event.type,round:event.round,phase:Phase.VOTE,viewerDecisionEvent:event};
});
const winnerSequence = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players:winnerPlayers},messages:[],frames:[...winnerExits,winnerFrame],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],fullBodies:{[winnerPlayers[0]!.id]:"/avatars/personas/full-body-v1/strategic.webp"}}});
const winnerCue = winnerSequence.find(cue=>cue.picture.kind === "influence" && cue.picture.beat?.kind === "winner");
if (!winnerCue) throw new Error("Missing Influence winner fixture");
cases.push({name:"influence-winner",reference:winnerCue,cue:winnerCue});
const largeFrames = socialFrames.slice(0,2).map(frame => ({...frame,players:largePlayers,counts:{...frame.counts,totalPlayers:largePlayers.length,alivePlayers:largePlayers.length}}));
const huddleMembers = largePlayers.slice(0,-1);
const largeHuddle:TranscriptEntry = {...huddle,id:103,entrySequence:103,toPlayerIds:huddleMembers.slice(1).map(player=>player.id),
  text:"We can hold our votes together, but only if everyone understands who is actually at risk. I want to hear the people who have not spoken yet before we settle on a name. If the plan changes, tell the whole group rather than leaving one person to discover it when the votes are revealed.",
  thinking:"I promised to listen before choosing a target. This room contains several competing commitments, and I need to remember who supports each option. The safest move may be to ask for a clear explanation before accepting a plan that leaves someone else exposed.",
  allianceSession:{sessionId:"large",allianceId:"large",allianceName:"The Exceptionally Long Night Shift Alliance",memberIds:huddleMembers.map(player=>player.id)}};
const largeCues = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players:largePlayers},messages:[largeHuddle],frames:largeFrames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}});
if (process.env.COMPOSED_ROOM_PARITY === "1") {
  const bodies = Object.fromEntries(largePlayers.map(player => [player.id,"/avatars/personas/full-body-v1/strategic.webp"]));
  const cue = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players:largePlayers},messages:[largeHuddle],frames:largeFrames,thoughts:{},
    visual:{enabled:false,status:null,portraits:{},fullBodies:bodies,scenes:[]}}).find(cue => cue.speech?.text === largeHuddle.text)!;
  cases.push({name:"composed-large",reference:cue,cue});
  cases.push({name:"composed-large-reduced",reference:cue,cue,reducedMotion:true});
  cases.push({name:"composed-thought",reference:cue,cue:thinkingSegment(cue,"composed-thought",largeHuddle.thinking!,"atlas")});
  const pair = socialCues.find(cue => cue.speech?.text === social.text)!;
  cases.push({name:"composed-pair-recorded",reference:pair,cue:{...pair,timing:{...pair.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}}});
}
const largeHuddleCue = largeCues.find(cue => cue.speech?.text === largeHuddle.text);
if (!largeHuddleCue || largeHuddleCue.activeFormatId !== "majority_elimination") throw new Error("Missing large huddle format context");
cases.push({name:"format-huddle-large",reference:largeHuddleCue,cue:largeHuddleCue});
cases.push({name:"format-huddle-large-reduced",reference:largeHuddleCue,cue:largeHuddleCue,reducedMotion:true});
const largeThoughtCue = thinkingSegment(largeHuddleCue,"format-huddle-large-thought",largeHuddle.thinking!,"atlas");
cases.push({name:"format-huddle-large-thought",reference:largeHuddleCue,cue:largeThoughtCue});
cases.push({name:"format-huddle-large-thought-recorded",reference:largeHuddleCue,cue:{...largeThoughtCue,timing:{...largeThoughtCue.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}}});
cases.push({name:"format-huddle-large-recorded",reference:largeHuddleCue,cue:{...largeHuddleCue,timing:{...largeHuddleCue.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}}});
const sixPageThought = Array.from({length:10},()=>largeHuddle.thinking!).join(" ");
const sixThoughtCue = thinkingSegment(largeHuddleCue,"format-huddle-six-thought",sixPageThought,"atlas");
cases.push({name:"format-huddle-six-thought",reference:largeHuddleCue,cue:sixThoughtCue});
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
  if (process.env.COMPOSED_ROOM_PARITY === "1" && !suite.prefix) {
    const cue = cues.find(item => item.picture.kind === "werewolf" && werewolfPortraitRoom(item.picture.cue) && !item.picture.scene)!;
    if (!cue) throw new Error("Missing composed Werewolf discussion");
    cases.push({name:`composed-werewolf-${audience}`,reference:cue,cue});
  }
  for(const kind of suite.kinds) {
    const cue=cues.find(item=>item.picture.kind === "werewolf" && (kind === "ending" ? item.picture.cue.reprise : !item.picture.cue.reprise && !item.picture.cue.ballot && !item.picture.cue.nightAction && item.picture.cue.moment.entry.kind === kind));
    if(!cue) throw new Error(`Missing ${audience} ${kind} fixture`);
    cases.push({name:`${suite.prefix}${audience}-${kind}`,cue,reference:cue});
  }
}
if (process.env.COMPOSED_ROOM_PARITY === "1") {
  const historical = projectWerewolfProductionWatch(await completedWerewolfResultsFixture("saved","composed-historical",1),"omniscient");
  for (const moment of historical.moments) for (const player of moment.snapshot.players) {
    player.avatarUrl = "/avatars/personas/strategic.png";
    player.fullBodyReferenceUrl = "/avatars/personas/full-body-v1/strategic.webp";
  }
  const historicalCue = buildExportCues({kind:"werewolf",windows:[{...historical,audience:"omniscient",status:"completed",slug:"composed-historical",publicationCutoff:"fixture",media:{}}],thoughts:[]})
    .find(cue => cue.picture.kind === "werewolf" && werewolfPortraitRoom(cue.picture.cue));
  if (!historicalCue) throw new Error("Missing historical composed pack room");
  cases.push({name:"composed-historical-pack",reference:historicalCue,cue:historicalCue});
  const {packStrategyPresentationFixture} = await import("./pack-strategy-presentation-fixture");
  const input = await packStrategyPresentationFixture("omniscient");
  const pack = input.base.filter(cue => cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "proposal" && werewolfPortraitRoom(cue.picture.cue)).slice(0,2);
  if (pack.length !== 2) throw new Error("Missing eight-player pack composition sequence");
  cases.push({name:"composed-pack-sequence",reference:pack[0]!,cue:pack[0]!,sequence:pack,references:pack});
  const thought = input.bound.flatMap(moment => moment.segments).find(cue => cue.picture.kind === "thinking" && cue.picture.gameKind === "werewolf" && cue.picture.room);
  if (!thought || thought.source.kind !== "werewolf") throw new Error("Missing isolated composed pack thought");
  const cursor = thought.source.cursor;
  const reference = input.base.find(cue => cue.source.kind === "werewolf" && cue.source.cursor === cursor);
  if (!reference) throw new Error("Missing pack thought source reference");
  cases.push({name:"composed-pack-thought",reference,cue:thought});
}
// A long accepted ballot exercises the exact speech adapter used by manual
// page advancement, including an isolated Studio cut with omitted neighbors.
const pageText = "I'm voting to eliminate Kimi K3. They pushed for a four-vote majority without naming a suspect first, then only offered DeepSeek Flash after Meta Spark pressed them directly. That sequencing—demand commitment before naming—is a wolf pattern worth acting on today. I will listen to anyone who can disprove this.";
const pageEvents = await completedCurrentWerewolfFixture("page-parity", 10);
for (const event of pageEvents) if (event.type === "werewolf.action_accepted" && event.payload.action === "public_vote" && event.payload.decision.kind === "spoken_target") event.payload.decision.text = pageText;
const pageProjection = projectWerewolfProductionWatch(pageEvents,"omniscient");
for (const moment of pageProjection.moments) for (const player of moment.snapshot.players) {player.avatarUrl="/avatars/personas/strategic.png";player.fullBodyReferenceUrl="/avatars/personas/full-body-v1/strategic.webp";}
const pageCue = buildExportCues({kind:"werewolf",windows:[{...pageProjection,audience:"omniscient",status:"completed",slug:"page-parity",publicationCutoff:"fixture",media:{}}],thoughts:[]})
  .find(item => item.picture.kind === "werewolf" && item.picture.cue.moment.entry.kind === "ballot" && item.speech?.text === pageText);
if (!pageCue) throw new Error("Missing long ballot pagination fixture");
cases.push({name:"page-werewolf-ballot",cue:pageCue,reference:pageCue});
// Optional saved, already-authorized source cases let a repair prove the actual
// changed adapter rather than replacing its evidence with unrelated fixtures.
const suppliedCases = process.argv[3];
const proofSource = suppliedCases ? `Saved authorized source cases: ${resolve(suppliedCases)}` : "Deterministic fixtures; actual viewer components versus Studio/export composition";
if (suppliedCases) cases.splice(0, cases.length, ...JSON.parse(await readFile(resolve(suppliedCases), "utf8")));
// Hunter fixtures exercise the real catalog -> independent selection -> renderer adapters.
if (process.env.HUNTER_PARITY === "1") {
  const {completedHunterFixture} = await import("@influence/engine/fixtures/werewolf-hunter");
  const {projectWerewolfProductionProvenance} = await import("@influence/engine/werewolf/watch");
  const {assembleProductionCatalog} = await import("@influence/engine/production-moments");
  const {buildWerewolfProductionSources} = await import("@influence/engine/production-moments/werewolf-source");
  const {bindWerewolfProductionPresentation} = await import("../lib/replay-export/production-presentation");
  cases.length = 0;
  for (const mode of ["held","snipe-only","double"] as const) {
    const events = await completedHunterFixture(mode);
    if (process.env.HOUSE_NARRATION_PARITY === "1") {
      const {werewolfHouseNarrationInput} = await import("@influence/engine/werewolf/house-narration");
      for (const [index, event] of events.entries()) for (const audience of ["mystery", "omniscient"] as const) {
        const input = werewolfHouseNarrationInput(events.slice(0,index+1),audience);
        if (input) event.houseNarration = {...event.houseNarration, [audience]: Object.fromEntries(input.requestedParts.map(part => [part, "The village faces another decisive moment! Watch closely as the next chapter unfolds."]))};
      }
    }
    for (const audience of ["omniscient","mystery"] as const) {
      const projected = projectWerewolfProductionWatch(events,audience);
      for (const moment of projected.moments) for (const player of [...moment.snapshot.players,...(moment.night?.before.players ?? [])]) {
        player.avatarUrl="/avatars/personas/strategic.png";
        player.fullBodyReferenceUrl="/avatars/personas/full-body-v1/strategic.webp";
        player.name = `Alexandria Long Frozen Name ${player.id}`;
      }
      const window = {...projected,audience,status:"completed",slug:`hunter-${mode}`,publicationCutoff:"fixture",media:{}};
      const source = {kind:"werewolf" as const,windows:[{...window,moments:window.moments.map(({staging, ...moment}) => { void staging; return moment; })}],thoughts:[]};
      const provenance = projectWerewolfProductionProvenance(events,audience);
      const catalog = assembleProductionCatalog({gameId:window.gameId,gameKind:"werewolf",audience,sources:buildWerewolfProductionSources({gameId:window.gameId,audience,moments:window.moments,provenance,thoughts:[],opening:true})});
      const bound = await bindWerewolfProductionPresentation({source,provenance,catalog,thoughts:[]});
      const base = buildExportCues(source);
      if (mode === "double" && audience === "omniscient" && process.env.HOUSE_NARRATION_BEATS_ONLY !== "1") {
        const sequence = bound.flatMap(item=>item.segments).filter(cue=>cue.picture.kind === "werewolf" && (cue.picture.cue.nightAction?.kind === "snipe" || cue.picture.cue.moment.entry.kind === "night" && !cue.picture.cue.nightAction));
        const references = sequence.map(cue=>{const reference=base.find(item=>item.timing.key === cue.timing.key);if(!reference) throw new Error("Missing sequence reference");return reference;});
        cases.push({name:"hunter-sequence",cue:sequence[0]!,reference:references[0]!,sequence,references});
      }
      for (const moment of catalog.moments) {
        const cue = bound.find(item=>item.id === moment.id)?.segments[0];
        if (!cue || cue.picture.kind !== "werewolf") continue;
        const picture = cue.picture.cue;
        if (process.env.HOUSE_NARRATION_BEATS_ONLY === "1") {
          if (mode !== "double" || audience !== "omniscient" || picture.nightDecision || picture.nightAction?.kind === "snipe"
            || !["scene", "pack_vote", "result", "protect", "investigate", "hunt"].includes(moment.part.kind)) continue;
          if (cases.some(item => item.name === `hunter-${mode}-${audience}-${moment.part.kind}`)) continue;
        } else if (picture.nightAction?.kind !== "snipe" && !(picture.moment.entry.kind === "night" && !picture.nightAction)) continue;
        // Mystery and double-death dawn, plus held/fired private speech and action.
        if (mode === "snipe-only" && audience === "omniscient" && picture.nightAction) continue;
        if (mode === "held" && !picture.nightAction) continue;
        const reference = base.find(item=>item.timing.key === cue.timing.key);
        if (!reference) throw new Error("Missing viewer Hunter reference");
        const name = `hunter-${mode}-${audience}-${moment.part.kind}`;
        cases.push({name,cue,reference});
        if (mode === "held" && picture.nightDecision) {
          cases.push({name:`${name}-reduced`,cue,reference,reducedMotion:true});
          cases.push({name:`${name}-recorded`,reference,cue:{...cue,timing:{...cue.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}}});
        }
      }
    }
  }
  await writeFile(join(output,"hunter-cases.json"),JSON.stringify(cases,null,2));
}
if (process.env.PACK_STRATEGY_PARITY === "1") {
  const {packStrategyPresentationFixture} = await import("./pack-strategy-presentation-fixture");
  cases.length = 0;
  for (const audience of ["omniscient","mystery"] as const) {
    const input = await packStrategyPresentationFixture(audience);
    if (audience === "mystery") {
      if (JSON.stringify(input.catalog).includes("PRIVATE_PACK") || input.base.some(cue=>cue.speech?.text.startsWith("Tomorrow"))) throw new Error("Mystery leaked pack strategy");
      const cue = input.base.find(cue=>cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "night" && !cue.picture.cue.nightAction);
      if (!cue) throw new Error("Missing public dawn");
      cases.push({name:"pack-mystery",cue,reference:cue});
      continue;
    }
    const strategy = input.catalog.moments.find(moment=>moment.part.kind === "speech" && input.bound.find(bound=>bound.id === moment.id)?.segments.some(cue=>cue.speech?.text.startsWith("Tomorrow")));
    const thought = input.catalog.moments.find(moment=>moment.kind === "thinking" && moment.order.anchor === strategy?.order.anchor);
    const result = input.catalog.moments.find(moment=>moment.part.kind === "pack_vote");
    if (!strategy || !thought || !result) throw new Error("Missing v13 independent strategy moments");
    for (const [name,moment] of [["speech",strategy],["thought",thought],["result",result]] as const) {
      const cue = input.bound.find(bound=>bound.id === moment.id)?.segments[0];
      if (!cue) throw new Error(`Unbound pack ${name}`);
      const context = input.base.find(base=>base.source.kind === "werewolf" && base.source.cursor === moment.order.anchor);
      if (!context) throw new Error(`Missing viewer pack ${name} reference`);
      const reference = name === "thought" ? context : input.base.find(base=>base.timing.key === cue.timing.key);
      if (!reference) throw new Error(`Missing pack ${name} timing reference`);
      cases.push({name:`pack-${name}`,cue,reference});
      if (name === "speech") {
        cases.push({name:"pack-reduced",cue,reference,reducedMotion:true});
        cases.push({name:"pack-recorded",cue:{...cue,timing:{...cue.timing,recording:{assetId:"assets/format-context-voice.wav",durationMs:2000}}},reference});
      }
    }
    const included = new Set(input.catalog.moments.filter(moment=>moment.defaultIncluded).map(moment=>moment.id));
    const sequence = input.bound.filter(bound=>included.has(bound.id)).flatMap(bound=>bound.segments).filter(cue=>cue.picture.kind === "werewolf" && ["proposal","pack_vote","night"].includes(cue.picture.cue.moment.entry.kind));
    const references = sequence.map(cue=>{const base=input.base.find(base=>base.timing.key === cue.timing.key);if(!base) throw new Error("Missing pack sequence reference");return base;});
    if (sequence.filter(cue=>cue.speech?.text.startsWith("Tomorrow")).length !== 2 || JSON.stringify(sequence).includes("SECRET_PASS_THINKING")) throw new Error("Invalid pack sequence");
    cases.push({name:"pack-sequence",cue:sequence[0]!,reference:references[0]!,sequence,references});
    await writeFile(join(output,"pack-source.json"),JSON.stringify({events:input.events,catalog:input.catalog,source:input.source},null,2));
  }
  const {completedHunterFixture} = await import("@influence/engine/fixtures/werewolf-hunter");
  for (const [version,events] of [[8,await completedWerewolfResultsFixture("saved","pack-history-v8")],[12,await completedHunterFixture("held")]] as const) {
    const projected = projectWerewolfProductionWatch(events,"omniscient");
    for (const moment of projected.moments) for (const player of moment.snapshot.players) {
      player.avatarUrl="/avatars/personas/strategic.png";
      player.fullBodyReferenceUrl="/avatars/personas/full-body-v1/strategic.webp";
    }
    const source = {kind:"werewolf" as const,windows:[{...projected,audience:"omniscient" as const,status:"completed",slug:`pack-history-v${version}`,publicationCutoff:"fixture",media:{}}],thoughts:[]};
    const cue = buildExportCues(source).find(cue=>cue.picture.kind === "werewolf" && (cue.picture.cue.moment.entry.kind === "proposal" || cue.picture.cue.moment.entry.kind === "speech" && cue.picture.cue.moment.entry.audience === "pack"));
    if (!cue) throw new Error(`Missing frozen v${version} pack picture`);
    cases.push({name:`pack-history-v${version}`,cue,reference:cue});
  }
  await writeFile(join(output,"pack-cases.json"),JSON.stringify(cases,null,2));
}
const scratch=await mkdtemp(join(tmpdir(),"house-parity-"));
const results:{name:string;width:number;height:number;frame:number;meanDifference:number;exportHash:string;viewer:string;export:string}[]=[];
const encodedResults:{name:string;frame:number;meanDifference:number;video:string}[]=[];
const audioResults:unknown[]=[];
const studioResults:unknown[]=[];
const sequenceResults:unknown[]=[];
const pageCoverage:unknown[]=[];
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
  if (process.env.PARITY_ASSET_DIR) await cp(resolve(process.env.PARITY_ASSET_DIR),join(serveUrl,"assets"),{recursive:true});
  await runProcess("ffmpeg",["-y","-v","error","-f","lavfi","-i","sine=frequency=523:sample_rate=44100","-t","2",join(serveUrl,"assets/format-context-voice.wav")]);
  await mkdir(join(serveUrl,"public","assets"),{recursive:true});
  await cp(join(serveUrl,"assets/format-context-voice.wav"),join(serveUrl,"public/assets/format-context-voice.wav"));
  let browser=await openBrowser("chrome",{browserExecutable:process.env.REPLAY_BROWSER_EXECUTABLE});
  const resetComparisonBrowser = async () => {
    await browser.close({silent:true});
    browser = await openBrowser("chrome",{browserExecutable:process.env.REPLAY_BROWSER_EXECUTABLE});
  };
  try {
    const narrow = process.env.FORMAT_CONTEXT_NARROW === "1";
    const portrait = process.env.FORMAT_CONTEXT_PORTRAIT === "1";
    const formatOnly = process.env.FORMAT_CONTEXT_ONLY === "1";
    const geometries: readonly (readonly [number, number])[] = process.env.WINNER_AUDIO === "1" ? [[640,360]] : narrow ? [[360,240]] : portrait ? [[320,480]] : [[1280,720],[640,360],...(process.env.FORMAT_CONTEXT_CASE === "page-werewolf-ballot" ? [[320,480] as const] : []),...(process.env.COMPOSED_ROOM_PARITY === "1" || process.env.HUNTER_PARITY === "1" || process.env.PACK_STRATEGY_PARITY === "1" || suppliedCases || process.env.FORMAT_CONTEXT_CASE === "influence-winner" ? [[360,240] as const, [390,700] as const] : [])];
    const geometryCases = (narrow || portrait) && !suppliedCases ? cases.filter(item => item.name.startsWith("composed-") || item.name.startsWith("hunter-") || item.name.startsWith("pack-") || ["page-werewolf-ballot","influence-winner","format-mingle","format-huddle","format-huddle-five","format-huddle-large","format-huddle-large-reduced","format-huddle-large-thought","format-rules"].includes(item.name))
      : formatOnly ? cases.filter(item => item.name.startsWith("format-")) : cases;
    const selectedCases = process.env.COMPOSED_ROOM_PARITY === "1" ? geometryCases.filter(item => item.name.startsWith("composed-") && (!process.env.FORMAT_CONTEXT_CASE || process.env.FORMAT_CONTEXT_CASE.split(",").includes(item.name))) : process.env.WINNER_SEQUENCE_ONLY === "1" ? [] : process.env.FORMAT_CONTEXT_CASE ? geometryCases.filter(item => item.name === process.env.FORMAT_CONTEXT_CASE) : geometryCases;
    if (process.env.COMPOSED_ROOM_PARITY === "1" && !selectedCases.length) throw new Error("No composed-room proof cases selected");
    for(const [width,height] of geometries) for(const item of selectedCases) {
      // Dense cutout cases retain many decoded textures. Start each comparison
      // in a fresh browser rather than carrying that cache across the matrix.
      if (process.env.COMPOSED_ROOM_PARITY === "1" && results.length) await resetComparisonBrowser();
      const profile=parseTimingProfile({ending:{holdMs:0}}),fps=30;
      const preparedCues = item.sequence ?? [item.cue];
      const timeline=compileTiming(preparedCues.map(cue=>cue.timing),profile,fps);
      const winnerAudio = process.env.WINNER_AUDIO === "1" && item.name === "influence-winner";
      const musicPath = winnerAudio && item.cue.music ? join(webRoot,"public",item.cue.music.src) : null;
      const musicDuration = musicPath ? Math.round(Number(await runProcess("ffprobe",["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",musicPath]))*1000) : 0;
      const musicAssets = musicPath && item.cue.music ? {[item.cue.music.src]:{path:musicPath,sha256:sha256(await readFile(musicPath)),mediaType:"audio" as const,durationMs:musicDuration}} : {};
      if (winnerAudio && !musicPath) throw new Error("Winner fixture is missing its closing music");
      let manifest:ReplayManifest={schema:"house.replay-export",version:2,game:{id:"fixture",slug:item.name,kind:item.cue.picture.kind === "thinking" ? item.cue.picture.gameKind : item.cue.picture.kind === "influence" || item.cue.picture.kind === "influence-opening" ? "influence" : "werewolf"},
        width,height,fps,reducedMotion:item.reducedMotion === true,thinking:item.cue.picture.kind === "thinking",profile,cues:preparedCues,timeline,assets:musicAssets,staticFiles:{},boundary:{},audio:compileAudio(preparedCues,timeline,musicAssets,profile,winnerAudio),
        range:{fromFrame:0,untilFrame:timeline.at(-1)!.endFrame},revision:"fixture",dirty:true};
      const prefix=join(output,`${item.name}-${width}`);
      // The same layout prepass used by the local exporter freezes typography before encoding.
      const preparation={manifest,reference:item.reference,references:item.references,prepare:true};
      const measuring=await selectComposition({serveUrl,id:"Export",inputProps:preparation,puppeteerInstance:browser});
      const layouts:NonNullable<ReplayManifest["layouts"]>={},pages:NonNullable<ReplayManifest["pages"]>={};
      await renderFrames({serveUrl,composition:measuring,inputProps:preparation,outputDir:join(scratch,"measure"),imageFormat:"none",concurrency:1,puppeteerInstance:browser,
        onStart:()=>{},onFrameUpdate:()=>{},onArtifact:artifact=>{const data=JSON.parse(typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content));Object.assign(layouts,data.layouts);Object.assign(pages,data.pages);}});
      manifest={...manifest,layouts,pages};
      await writeFile(`${prefix}.manifest.json`,JSON.stringify(manifest,null,2));
      const inputProps={manifest,reference:item.reference,references:item.references};
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
        : (item.name.startsWith("format-huddle-large-thought") || item.name === "format-huddle-six-thought") && thought ? Array.from({length:castPages},(_,page) => Math.floor((thought.readAtMs + (thought.hideAtMs - thought.readAtMs) * (page + .5) / castPages) * fps / 1000)) : [];
      let dialogueSamples:number[]=[];
      let roomSamples:number[]=[];
      let expectedDialoguePages=0, expectedRoomPages=0;
      if (item.name === "page-werewolf-ballot" || item.name.startsWith("hunter-") && !item.sequence && item.cue.picture.kind === "werewolf" && item.cue.picture.cue.nightDecision) {
        const text = item.name === "page-werewolf-ballot" ? pageText : item.cue.speech!.text;
        const dialoguePages = [...Object.values(pages),...Object.values(layouts).map(layout => layout.pages)].find(value => value.join("") === text);
        if (!dialoguePages?.length || item.name === "page-werewolf-ballot" && dialoguePages.length < 2) throw new Error("Missing complete measured speech pages");
        if (item.name === "page-werewolf-ballot" && width === 320 && dialoguePages.length < 6) throw new Error(`Expected at least six ballot pages, got ${dialoguePages.length}`);
        expectedDialoguePages = dialoguePages.length;
        const weights=dialoguePages.map(page=>Math.max(1,page.trim().split(/\s+/u).length)), total=weights.reduce((a,b)=>a+b,0);
        let prior=0;
        dialogueSamples=weights.flatMap(weight=>{
          const fractions=[prior/total,(prior+weight/2)/total];prior+=weight;
          return fractions.map(fraction=>{
            const source=SOLO_READ_START_MS+visualSpeechReadingMs(text)*fraction;
            const segment=timeline[0]!.segments.find(part=>part.sourceStartMs<=source && part.sourceEndMs>=source && part.sourceStartMs!==part.sourceEndMs);
            if (!segment) throw new Error("Missing ballot reading segment");
            // The first frame at or after a click's measured page boundary.
            return Math.ceil((segment.startMs+(source-segment.sourceStartMs)/(segment.sourceEndMs-segment.sourceStartMs)*(segment.endMs-segment.startMs))*fps/1000);
          });
        });
      }
      if(item.name.startsWith("format-huddle-large") || item.name === "format-huddle-six-thought") {
        const text = item.name === "format-huddle-six-thought" ? sixPageThought : item.name.includes("-thought") ? largeHuddle.thinking! : largeHuddle.text;
        const dialoguePages=Object.values(pages).find(value=>value.join("") === text);
        if(!dialoguePages?.length || dialoguePages.some(page=>!page.trim())) throw new Error("Huddle pagination did not retain every word");
        if (item.name === "format-huddle-six-thought" && width === 640 && dialoguePages.length < 6) throw new Error(`Expected at least six thought pages, got ${dialoguePages.length}`);
        expectedDialoguePages = dialoguePages.length;
        const weights=dialoguePages.map(page=>page.trim().split(/\s+/u).length),total=weights.reduce((sum,value)=>sum+value,0);
        let prior=0;
        dialogueSamples=weights.map(weight=>{
          const progress=(prior+weight/2)/total;prior+=weight;
          if(thought) return Math.floor((thought.readAtMs+(thought.hideAtMs-thought.readAtMs)*progress)*fps/1000);
          const readStart=item.cue.timing.speech?.readAtMs ?? 850;
          const readEnd=item.cue.timing.speech?.hideAtMs ?? item.cue.timing.baseDurationMs-600;
          const source=readStart+(readEnd-readStart)*progress;
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
      if ((item.name.startsWith("pack-") || item.name.startsWith("lone-wolf-") || item.name.startsWith("composed-")) && !item.sequence && (item.cue.speech?.speakerId || item.cue.timing.thinking)) {
        const text = item.cue.timing.thinking ?? item.cue.speech!.text;
        const measuredPages = [...Object.values(pages),...Object.values(layouts).map(layout=>layout.pages)].findLast(value=>value.join("") === text);
        if (!measuredPages?.length || measuredPages.some(page=>!page.trim())) throw new Error("Pack pagination did not preserve all accepted text");
        expectedDialoguePages = measuredPages.length;
        const weights = measuredPages.map(page=>Math.max(1,page.trim().split(/\s+/u).length)), total=weights.reduce((a,b)=>a+b,0);
        let prior=0;
        dialogueSamples=weights.map(weight=>{
          const progress=(prior+weight/2)/total;prior+=weight;
          if (thought) return Math.round((thought.insertAt+thought.readAtMs+(thought.hideAtMs-thought.readAtMs)*progress)*fps/1000);
          const readStart=item.cue.timing.speech?.readAtMs ?? 850;
          const readEnd=item.cue.timing.speech?.hideAtMs ?? item.cue.timing.baseDurationMs-600;
          const source=readStart+(readEnd-readStart)*progress;
          const segment=timeline[0]!.segments.find(part=>part.sourceStartMs<=source && part.sourceEndMs>=source && part.sourceStartMs!==part.sourceEndMs);
          if (!segment) throw new Error("Missing pack reading segment");
          // A short recorded page can occupy just one frame. Sample its nearest
          // midpoint, rather than flooring into the preceding page.
          return Math.round((segment.startMs+(source-segment.sourceStartMs)/(segment.sourceEndMs-segment.sourceStartMs)*(segment.endMs-segment.startMs))*fps/1000);
        });
      }
      const winnerRemaining = item.cue.picture.kind === "influence" && item.cue.picture.beat?.kind === "winner" ? item.cue.picture.beat.standings.length : 0;
      const winnerSamples = item.name === "influence-winner" ? Array.from({length:Math.ceil(winnerRemaining/WINNER_PAGE_SIZE)},(_,page)=>Math.min(manifest.range.untilFrame-1,Math.floor((page+.5)*WINNER_PAGE_MS*fps/1000))) : [];
      const samples=[...new Set([...(rulesSamples ?? (thought ? [Math.round((thought.insertAt+thought.enterMs*.5)*fps/1000),Math.round((thought.insertAt+thought.readAtMs+500)*fps/1000),Math.round((thought.insertAt+thought.returnAtMs+450)*fps/1000)] : item.cue.picture.kind === "werewolf-opening" || item.cue.picture.kind === "werewolf" && (item.cue.picture.cue.reprise || item.cue.picture.cue.transformation) ? [0,15,60,120,manifest.range.untilFrame-1].map(frame=>Math.min(frame,manifest.range.untilFrame-1)) : (item.name.startsWith("composed-") || item.name.startsWith("hunter-") || item.name.startsWith("pack-") || item.name.startsWith("format-") && item.name !== "format-menu") ? [0,Math.min(60,manifest.range.untilFrame-1),manifest.range.untilFrame-1] : [Math.min(60,manifest.range.untilFrame-1)])),...(item.name.startsWith("lone-wolf-") ? [Math.floor(manifest.range.untilFrame*.65)] : []),...castSamples,...dialogueSamples,...roomSamples,...winnerSamples,...(item.sequence ? timeline.flatMap(row=>[row.startFrame,Math.min(row.endFrame-1,row.startFrame+60),row.endFrame-1]) : [])])];
      const observedCast = new Set<string>();
      const observedWinnerCast = new Set<string>();
      const observedDialoguePages = new Set<string>(), observedRoomPages = new Set<string>();
      for(const frame of samples) {
        const paths={viewer:`${prefix}-${frame}-viewer.png`,export:`${prefix}-${frame}-export.png`};
        const frameAudits:unknown[]=[];
        await renderStill({serveUrl,composition:viewer,inputProps,frame,output:paths.viewer,imageFormat:"png",puppeteerInstance:browser});
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:paths.export,imageFormat:"png",puppeteerInstance:browser,
          onArtifact:artifact=>{if (artifact.filename.startsWith("format-audit-")) {const data=JSON.parse(typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content)); frameAudits.push(data); for (const id of data.castMembers ?? []) observedCast.add(id); for (const id of data.winnerMembers ?? []) observedWinnerCast.add(id); if(data.namePage !== undefined) observedRoomPages.add(data.namePage); if(data.speechPage !== undefined) observedDialoguePages.add(data.speechPage);}}});
        await writeFile(`${prefix}-${frame}-audit.json`,JSON.stringify(frameAudits,null,2));
        const meanDifference=difference(await pixels(paths.viewer),await pixels(paths.export));
        results.push({name:item.name,width,height,frame,meanDifference,exportHash:sha256(await readFile(paths.export)),...paths});
        await writeFile(join(output,"comparison.json"),JSON.stringify({source:proofSource,frames:results},null,2));
        if(meanDifference>1) throw new Error(`Viewer/export mismatch: ${item.name} ${width} frame ${frame}: ${meanDifference}`);
        for(const {view,composition} of studio) {
          const path=`${prefix}-${frame}-studio-${view}.png`;
          await renderStill({serveUrl,composition,inputProps:{...inputProps,view},frame,output:path,imageFormat:"png",puppeteerInstance:browser,timeoutInMilliseconds:60000});
          const delta=difference(await pixels(paths.export),await pixels(path));
          studioResults.push({name:item.name,width,height,frame,view,meanDifference:delta,path});
          if(delta>1) throw new Error(`Studio ${view} mismatch: ${item.name} ${width} frame ${frame}: ${delta}`);
        }
      }
      if((item.name.startsWith("format-huddle-large") || item.name === "format-huddle-six-thought" || item.name === "format-huddle-five") && expectedCast.some(player=>!observedCast.has(player.id))) throw new Error(`Not every huddle member appeared: ${[...observedCast].join(", ")}`);
      if(item.name === "influence-winner" && winnerPlayers.slice(1).some(player=>!observedWinnerCast.has(player.id))) throw new Error(`Not every winner-scene cast member appeared: ${[...observedWinnerCast].join(", ")}`);
      if((item.name.startsWith("format-huddle-large") || item.name === "format-huddle-six-thought") && (observedRoomPages.size !== expectedRoomPages || observedDialoguePages.size !== expectedDialoguePages))
        throw new Error(`Not every huddle page appeared: room ${observedRoomPages.size}/${expectedRoomPages}, dialogue ${observedDialoguePages.size}/${expectedDialoguePages}`);
      pageCoverage.push({name:item.name,width,height,expectedDialoguePages,observedDialoguePages:[...observedDialoguePages],samples});
      await writeFile(join(output,"page-coverage.json"),JSON.stringify(pageCoverage,null,2));
      if (expectedDialoguePages > 0 && (item.name === "page-werewolf-ballot" || item.name.startsWith("hunter-") || item.name.startsWith("pack-") || item.name.startsWith("lone-wolf-") || item.name.startsWith("composed-")) && observedDialoguePages.size !== expectedDialoguePages)
        throw new Error(`Not every measured dialogue page appeared: ${observedDialoguePages.size}/${expectedDialoguePages}`);
      // Verify random-access stability independently of prior React/browser state.
      if (process.env.COMPOSED_ROOM_PARITY === "1") await resetComparisonBrowser();
      for(const frame of samples.toReversed()) {
        const path=join(scratch,"reverse.png");
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:path,imageFormat:"png",puppeteerInstance:browser});
        if(sha256(await readFile(path))!==results.find(row=>row.name===item.name && row.width===width && row.frame===frame)!.exportHash) throw new Error("Reverse-order render mismatch");
      }
      if(width===640 && ((process.env.COMPOSED_ROOM_PARITY === "1" && ["composed-thought","composed-pair-recorded","composed-werewolf-omniscient","composed-pack-thought"].includes(item.name)) || process.env.HUNTER_PARITY === "1" || process.env.PACK_STRATEGY_PARITY === "1" || suppliedCases || ["page-werewolf-ballot","influence-winner","format-menu","format-rules","format-mingle","format-huddle-thought","format-huddle-large-recorded","format-huddle-large-thought-recorded","chain-0","winner-mystery-vote"].includes(item.name))) {
        const recorded = item.name.endsWith("-recorded");
        if (process.env.COMPOSED_ROOM_PARITY === "1") await resetComparisonBrowser();
        await renderMedia({serveUrl,composition:exported,inputProps,codec:"h264",imageFormat:item.name.startsWith("composed-") ? "png" : undefined,crf:item.name === "influence-winner" || item.name.startsWith("composed-") ? 10 : undefined,audioCodec:"aac",muted:!recorded && !winnerAudio,outputLocation:`${prefix}.mp4`,concurrency:2,puppeteerInstance:browser});
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
        if (winnerAudio && musicPath) {
          for (const startMs of [2000, 25000]) {
            const pcm = async(path:string,destination:string) => {
              await runProcess("ffmpeg",["-y","-v","error","-ss",String(startMs/1000),"-i",path,"-t","3","-ar","48000","-ac","1","-f","f32le",destination]);
              const buffer=await readFile(destination);return new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
            };
            const source=await pcm(musicPath,join(scratch,"winner-source.pcm"));
            const actual=await pcm(`${prefix}.mp4`,join(scratch,"winner-audio.pcm"));
            // Compare at the score's native sample rate; coarse resampling changes
            // phase and underestimates correlation for complex stereo music.
            const alignment=compareRecordingPcm(Float32Array.from(source,value=>value*.3),Array.from(actual),48000,50);
            if(alignment.correlation<.96 || alignment.relativeError>.35) throw new Error(`Winner music differs at ${startMs}ms: ${JSON.stringify(alignment)}`);
            audioResults.push({name:item.name,startMs,alignment});
          }
        }
      }
      console.log(`Verified ${item.name} ${width}×${height}`);
    }
    if (process.env.FORMAT_CONTEXT_CASE === "influence-winner" && process.env.WINNER_AUDIO !== "1") {
      const winnerIndex=winnerSequence.indexOf(winnerCue);
      if (winnerIndex < 1) throw new Error("Missing the winner's preceding ballot");
      const cues=winnerSequence.slice(0,winnerIndex+1).filter(cue=>cue.picture.kind === "influence" && cue.picture.cue.source === "endgame"), width=640, height=360, fps=30;
      if (cues.length < 2) throw new Error("Missing the jury ballot sequence");
      const profile=parseTimingProfile({ending:{holdMs:0}}), timeline=compileTiming(cues.map(cue=>cue.timing),profile,fps);
      let manifest:ReplayManifest={schema:"house.replay-export",version:2,game:{id:"fixture",slug:"influence-winner-sequence",kind:"influence"},width,height,fps,reducedMotion:false,thinking:false,profile,cues,timeline,assets:{},staticFiles:{},boundary:{},audio:compileAudio(cues,timeline,{},profile,false),range:{fromFrame:0,untilFrame:timeline.at(-1)!.endFrame},revision:"fixture",dirty:true};
      const preparation={manifest,reference:cues[0]!,references:cues,prepare:true};
      const measuring=await selectComposition({serveUrl,id:"Export",inputProps:preparation,puppeteerInstance:browser});
      const layouts:NonNullable<ReplayManifest["layouts"]>={}, pages:NonNullable<ReplayManifest["pages"]>={};
      await renderFrames({serveUrl,composition:measuring,inputProps:preparation,outputDir:join(scratch,"sequence-measure"),imageFormat:"none",concurrency:1,puppeteerInstance:browser,onStart:()=>{},onFrameUpdate:()=>{},onArtifact:artifact=>{const data=JSON.parse(typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content));Object.assign(layouts,data.layouts);Object.assign(pages,data.pages);}});
      manifest={...manifest,layouts,pages};
      await writeFile(join(output,"influence-winner-sequence.manifest.json"),JSON.stringify(manifest,null,2));
      const inputProps={manifest,reference:cues[0]!,references:cues};
      const exported=await selectComposition({serveUrl,id:"Export",inputProps,puppeteerInstance:browser});
      const viewer=await selectComposition({serveUrl,id:"Viewer",inputProps,puppeteerInstance:browser});
      const studio=await Promise.all(["source","cut"].map(async view=>({view,composition:await selectComposition({serveUrl,id:view === "source" ? "StudioSource" : "StudioCut",inputProps:{...inputProps,view},puppeteerInstance:browser})})));
      const boundary=timeline.at(-1)!.startFrame;
      const samples=[0,...timeline.slice(1).flatMap(cue=>[Math.max(0,cue.startFrame-1),cue.startFrame]),Math.min(boundary+75,manifest.range.untilFrame-1),manifest.range.untilFrame-1];
      for (const frame of [...new Set(samples)]) {
        const prefix=join(output,`influence-winner-sequence-${frame}`), viewerPath=`${prefix}-viewer.png`, exportPath=`${prefix}-export.png`;
        await renderStill({serveUrl,composition:viewer,inputProps,frame,output:viewerPath,imageFormat:"png",puppeteerInstance:browser});
        await renderStill({serveUrl,composition:exported,inputProps,frame,output:exportPath,imageFormat:"png",puppeteerInstance:browser});
        const delta=difference(await pixels(viewerPath),await pixels(exportPath));
        if(delta>1) throw new Error(`Winner sequence viewer/export mismatch at ${frame}: ${delta}`);
        for (const {view,composition} of studio) {
          const path=`${prefix}-studio-${view}.png`;
          await renderStill({serveUrl,composition,inputProps:{...inputProps,view},frame,output:path,imageFormat:"png",puppeteerInstance:browser,timeoutInMilliseconds:60000});
          const studioDelta=difference(await pixels(exportPath),await pixels(path));
          if(studioDelta>1) throw new Error(`Winner sequence Studio ${view} mismatch at ${frame}: ${studioDelta}`);
          sequenceResults.push({frame,view,meanDifference:studioDelta,path,viewer:viewerPath,export:exportPath});
        }
      }
      console.log("Verified ballot-to-winner sequence and handoff");
    }
  } finally {await browser.close({silent:true});}
  await writeFile(join(output,"comparison.json"),JSON.stringify({source:proofSource,reverseOrder:true,frames:results,studio:studioResults,encoded:encodedResults,audio:audioResults,sequence:sequenceResults},null,2));
  console.log(`Saved ${results.length} comparisons and ${new Set(encodedResults.map(row=>row.video)).size} fresh videos: ${output}`);
} finally {await rm(scratch,{recursive:true,force:true});}
