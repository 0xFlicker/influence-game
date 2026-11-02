import {assembleProductionCatalog} from "@influence/engine/production-moments";
import {buildInfluenceProductionSources} from "@influence/engine/production-moments/influence-source";
import {bindInfluenceProductionPresentation} from "../lib/replay-export/production-presentation";
import type {ReplaySource} from "../lib/replay-export/source";
import type {TranscriptEntry} from "../lib/api";

/** Deterministic presentation source, not a generated game or historical replacement. */
export async function alliancePresentationFixture(count = 3, historical = false, plainSummary = false) {
  const cast = Array.from({length:count},(_,index)=>({id:`p${index}`,name:`Alexandria Member ${index + 1} North`,persona:"strategic",status:"alive" as const,shielded:false,avatarUrl:"/avatars/personas/observer.png"}));
  const players=[...cast,{...cast[0]!,id:"outside",name:"Observer"}];
  const session={sessionId:"meeting",allianceId:"alliance",allianceName:"The Night Shift",memberIds:cast.map(player=>player.id)};
  const speech:TranscriptEntry={id:10,entrySequence:10,firstDurableEventSequence:20,gameId:"alliance-proof",round:1,phase:"FORMAT_MINGLE",scope:"huddle",speakerPlayerId:cast[0]!.id,
    fromPlayerId:cast[0]!.id,fromPlayerName:cast[0]!.name,toPlayerIds:cast.slice(1).map(player=>player.id),dialogueKind:"huddle_speech",allianceSession:session,
    text:"We still have a choice to make together.",thinking:"My promises compete, and I need to hear where everyone stands.",timestamp:10};
  const intro:TranscriptEntry={...speech,id:12,entrySequence:12,firstDurableEventSequence:22,scope:"system",fromPlayerId:null,speakerPlayerId:null,toPlayerIds:null,thinking:null,
    dialogueKind:"house_summary",allianceSession:undefined,allianceIntroduction:{...session,beforeEntrySequence:10},
    text:"The Night Shift meets with a shared target and an uneven supply of trust. Another promise pulls Alexandria in the opposite direction. They may have a plan, but there is still a decision to make—and agreement around this table is only the beginning.",timestamp:12};
  if(plainSummary) delete intro.allianceIntroduction;
  const messages=historical ? [speech] : [speech,intro];
  const source:Extract<ReplaySource,{kind:"influence"}>={kind:"influence",projectionVersion:7,
    game:{id:"alliance-proof",slug:"alliance-proof",status:"completed",gameKernel:"classic",players},messages,frames:[],thoughts:{},
    visual:{enabled:false,status:null,portraits:Object.fromEntries(cast.map(player=>[player.id,"/avatars/personas/strategic.png"])),scenes:[]}};
  const catalog=assembleProductionCatalog({gameId:source.game.id,gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId:source.game.id,gameKernel:"classic",transcripts:messages,frames:[]})});
  const bound=await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
  const introId=catalog.moments.find(moment=>moment.source.kind === "influence-transcript" && moment.source.transcriptId === "12")?.id;
  const speechId=catalog.moments.find(moment=>moment.source.kind === "influence-transcript" && moment.source.transcriptId === "10" && moment.kind !== "thinking")!.id;
  const thoughtId=catalog.moments.find(moment=>moment.source.kind === "influence-transcript" && moment.source.transcriptId === "10" && moment.kind === "thinking")!.id;
  return {source,catalog,bound,introId,speechId,thoughtId,cast,intro,speech};
}
