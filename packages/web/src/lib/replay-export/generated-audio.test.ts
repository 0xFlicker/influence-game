import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfWatch,projectWerewolfProductionProvenance} from "@influence/engine/werewolf/watch";
import {werewolfThinkingActions} from "@influence/engine/werewolf/thinking";
import {assembleProductionCatalog} from "@influence/engine/production-moments";
import {buildWerewolfProductionSources} from "@influence/engine/production-moments/werewolf-source";
import type {PublishedAudioTrack} from "@influence/engine/audio-track";
import {bindWerewolfProductionPresentation} from "./production-presentation";
import {attachGeneratedAudio,recordingIdentity} from "./generated-audio";
import {productionMediaIds} from "../../app/admin/production/production-media-selection";
import {compilePresentation} from "./presentation";
import type {CachedAsset} from "./assets";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
test("generated House, speech and independent thinking versions reach the shared export schedule",async()=>{
 const gameId="generated-audio-movie",events=await completedCurrentWerewolfFixture(gameId,10);
 const windows=[];let next=1;
 do {
  const projected=projectWerewolfWatch(events,"omniscient",next,64);
  windows.push({...projected,slug:gameId,status:"completed" as const,audience:"omniscient" as const,publicationCutoff:"2026-10-24T00:00:00.000Z",media:{}});
  next=projected.throughCursor+1;
 } while(next<=windows[0]!.latestCursor);
 const actions=werewolfThinkingActions(events,windows[0]!.latestCursor);
 const thought=actions.find(row=>row.event.payload.action==="protect"||row.event.payload.action==="investigate")!;
 const thoughts=[{eventSequence:thought.event.sequence,cursor:thought.cursor,day:thought.day,actorId:thought.event.payload.actorId,action:thought.event.payload.action,thinking:"Tonight I must choose carefully."}];
 const provenance=projectWerewolfProductionProvenance(events,"omniscient");
 const catalog=assembleProductionCatalog({gameId,gameKind:"werewolf",audience:"omniscient",sources:buildWerewolfProductionSources({gameId,audience:"omniscient",moments:windows.flatMap(window=>window.moments),provenance,thoughts,opening:true})});
 const source=await bindWerewolfProductionPresentation({source:{kind:"werewolf",windows,thoughts:[]},provenance,thoughts,catalog});
 const eligible=source.filter(moment=>moment.segments.length===1&&recordingIdentity(moment.segments[0]!));
 expect(eligible.some(moment=>moment.segments[0]!.picture.kind==="thinking")).toBe(true);
 const publication:PublishedAudioTrack={id:"track",clips:eligible.map((moment,index)=>{
  const line=recordingIdentity(moment.segments[0]!)!;
  return {momentId:moment.id,speakerId:line.speakerId,textHash:hash(line.text),versionId:crypto.randomUUID(),sha256:hash(String(index)),durationMs:1000+index*10,url:`/audio/${index}`};
 })};
 const selectedIds=eligible.map(moment=>moment.id);
 const asset=async(clip:PublishedAudioTrack["clips"][number])=>({path:clip.url,sha256:clip.sha256,mediaType:"audio",durationMs:clip.durationMs} as CachedAsset);
 const attached=await attachGeneratedAudio({source,selectedIds,publication,hash,asset});
 // Source playback can hide thinking while the selected export retains it.
 const previewIds=source.filter(moment=>moment.segments[0]?.picture.kind!=="thinking").map(moment=>moment.id);
 const sourceView=await attachGeneratedAudio({source,selectedIds:productionMediaIds(previewIds,selectedIds),publication,hash,asset});
 expect(sourceView.recordings.filter(row=>selectedIds.includes(row.momentId))).toEqual(attached.recordings);
 const sourceCut=compilePresentation({source:sourceView.source,selectedIds,profile:{ending:{holdMs:0},overrides:{}},fps:30,assets:sourceView.assets,music:false});
 const cutView=compilePresentation({source:attached.source,selectedIds,profile:{ending:{holdMs:0},overrides:{}},fps:30,assets:attached.assets,music:false});
 expect(sourceCut.audio).toEqual(cutView.audio);
 expect(attached.recordings).toHaveLength(eligible.length);
 const compiled=compilePresentation({source:attached.source,selectedIds,profile:{ending:{holdMs:0},overrides:{}},fps:30,assets:attached.assets,music:false});
 expect(compiled.audio.clips.filter(clip=>clip.purpose==="speech")).toHaveLength(eligible.length);
 const thinking=attached.source.find(moment=>moment.segments[0]?.picture.kind==="thinking")!;
 expect(thinking.segments[0]!.timing.recording?.durationMs).toBeGreaterThan(0);
 await expect(attachGeneratedAudio({source,selectedIds,publication,hash,asset,frozen:attached.recordings.map((recording,index)=>index?recording:{...recording,durationMs:9})})).rejects.toThrow("changed");
 await expect(attachGeneratedAudio({source,selectedIds,publication:{...publication,clips:publication.clips.map((clip,index)=>index?clip:{...clip,textHash:"wrong"})},hash,asset})).rejects.toThrow("text or speaker");
});

test("accepted Influence House summaries retain exact audio identity across phase and winner scenes", async () => {
 const {bindInfluenceProductionPresentation} = await import("./production-presentation");
 const {buildInfluenceProductionSources} = await import("@influence/engine/production-moments/influence-source");
 const {selectProductionMoments} = await import("@influence/engine/production-moments");
 const gameId="house-summary-export";
 const phases=["LOBBY","FORMAT_MENU","FORMAT_PICK","OPENING_STATEMENTS","ACCUSATION","DEFENSE","PLEA","VOTE","FORMAT_RESOLVE","CLOSING_ARGUMENTS","JURY_VOTE"] as const;
 const messages: import("../api").TranscriptEntry[]=phases.map((phase,index)=>({
  id:100+index,gameId,round:1,phase,scope:"system",entrySequence:index+1,
  dialogueKind:"house_summary",firstDurableEventSequence:index+1,fromPlayerId:null,
  fromPlayerName:null,toPlayerIds:null,text:`Exact accepted House summary ${index}.`,timestamp:index+1,
 }));
 const replay: Extract<import("./source").ReplaySource,{kind:"influence"}>={
  kind:"influence",game:{id:gameId,slug:gameId,status:"completed",gameKernel:"classic",players:[
   {id:"a",name:"A",persona:"",status:"alive",shielded:false},
   {id:"b",name:"B",persona:"",status:"alive",shielded:false},
  ]},messages,frames:[],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],publicationSnapshot:{}},
 };
 const catalog=assembleProductionCatalog({gameId,gameKind:"influence",audience:"public",
  sources:buildInfluenceProductionSources({gameId,gameKernel:"classic",transcripts:messages,frames:[]})});
 const source=await bindInfluenceProductionPresentation({source:replay,catalog,thoughts:[]});
 const selectedIds=selectProductionMoments(catalog,{mode:"full",thinking:true}).map(moment=>moment.id);
 const summaries=source.filter(moment=>moment.segments.some(cue=>cue.source.kind==="influence"));
 expect(summaries).toHaveLength(phases.length);
 const publication:PublishedAudioTrack={id:"house-track",clips:summaries.map((moment,index)=>({
  momentId:moment.id,speakerId:null,textHash:hash(messages[index]!.text),versionId:`house-${index}`,
  sha256:hash(`audio-${index}`),durationMs:9000+index,url:`/house-${index}.mp3`,
 }))};
 const asset=async(clip:PublishedAudioTrack["clips"][number])=>({path:clip.url,sha256:clip.sha256,mediaType:"audio",durationMs:clip.durationMs} as CachedAsset);
 const attached=await attachGeneratedAudio({source,selectedIds,publication,hash,asset});
 expect(attached.recordings).toHaveLength(phases.length);
 expect(attached.recordings.map(r=>r.messageId)).toEqual(messages.map(m=>String(m.id)));
 for(const [index,moment] of summaries.entries())expect(recordingIdentity(moment.segments[0]!)).toMatchObject({speakerId:null,speaker:"The House",text:messages[index]!.text});
 const compiled=compilePresentation({source:attached.source,selectedIds,profile:{ending:{holdMs:0},overrides:{}},fps:30,assets:attached.assets,music:false});
 expect(compiled.audio.clips.filter(clip=>clip.purpose==="speech")).toHaveLength(phases.length);
 expect(compiled.timeline.filter(cue=>cue.recording).map(cue=>cue.speech!.hideAtMs-cue.speech!.readAtMs)).toEqual(publication.clips.map(clip=>clip.durationMs));
 await expect(attachGeneratedAudio({source,selectedIds,publication:{...publication,clips:publication.clips.map((clip,index)=>index?clip:{...clip,speakerId:"a"})},hash,asset})).rejects.toThrow("text or speaker");
 await expect(attachGeneratedAudio({source:source.map(moment=>moment===summaries[0]?{...moment,segments:[...moment.segments,...moment.segments]}:moment),selectedIds,publication,hash,asset})).rejects.toThrow("unambiguous accepted line");
});
