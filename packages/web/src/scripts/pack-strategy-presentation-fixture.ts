import { completedPackStrategyFixture } from "@influence/engine/fixtures/werewolf-pack-strategy";
import { assembleProductionCatalog } from "@influence/engine/production-moments";
import { buildWerewolfProductionSources } from "@influence/engine/production-moments/werewolf-source";
import { projectWerewolfProductionProvenance, projectWerewolfProductionWatch } from "@influence/engine/werewolf/watch";
import { werewolfThinkingActions } from "@influence/engine/werewolf/thinking";
import { buildExportCues } from "../lib/replay-export/cues";
import { bindWerewolfProductionPresentation } from "../lib/replay-export/production-presentation";
import { WEREWOLF_ROOMS } from "../components/games/werewolf/werewolf-rooms";
import type { WerewolfWatchWindow } from "@influence/engine/werewolf/watch-contract";

/** Real v13 catalog/binding inputs shared by adapter tests and the rendered proof. */
export async function packStrategyPresentationFixture(audience: "omniscient" | "mystery", withTransformation = false) {
  const events = await completedPackStrategyFixture();
  const projected = projectWerewolfProductionWatch(events,audience);
  for (const moment of projected.moments) for (const player of [...moment.snapshot.players,...(moment.night?.before.players ?? [])]) {
    player.avatarUrl="/avatars/personas/strategic.png";
    player.fullBodyReferenceUrl="/avatars/personas/full-body-v1/strategic.webp";
  }
  const window: WerewolfWatchWindow = {...projected,audience,status:"completed",slug:"pack-strategy",publicationCutoff:"fixture",media:{},
    moments:projected.moments.map(({staging,...moment})=>{void staging;return moment;})};
  if (audience === "omniscient" && withTransformation) {
    const first = window.moments.find(moment => moment.entry.kind === "proposal" && moment.transformWolfIds?.length);
    if (!first?.transformWolfIds) throw new Error("Missing first pack appearance");
    const wolfIds = first.transformWolfIds;
    const mediaKey = "accepted-pack-room";
    first.wolfForms = Object.fromEntries(wolfIds.map(id => [id, "/avatars/personas/full-body-v1/aggressive.webp"]));
    first.mediaKey = mediaKey;
    window.media[mediaKey] = {id:mediaKey,roomId:"mingle-1",version:1,
      imageUrl:WEREWOLF_ROOMS.pack,annotatedImageUrl:WEREWOLF_ROOMS.pack,participantIds:wolfIds,
      anchors:wolfIds.map((playerId,index) => ({playerId,label:index+1,confidence:"clear",head:{x:.21+index*.42,y:.28,width:.14,height:.19}}))};
  }
  const source = {kind:"werewolf" as const,windows:[window],thoughts:[]};
  const provenance = projectWerewolfProductionProvenance(events,audience);
  const thoughts = audience === "mystery" ? [] : werewolfThinkingActions(events,projected.latestCursor).flatMap(({event,cursor,day})=>{
    const d = event.payload.decision;
    return "thinking" in d ? [{eventSequence:event.sequence,cursor,day,actorId:event.payload.actorId,action:event.payload.action,thinking:d.thinking}] : [];
  });
  const catalog = assembleProductionCatalog({gameId:window.gameId,gameKind:"werewolf",audience,sources:buildWerewolfProductionSources({gameId:window.gameId,audience,moments:window.moments,provenance,thoughts,opening:true})});
  const bound = await bindWerewolfProductionPresentation({source,provenance,catalog,thoughts});
  return {events,source,provenance,thoughts,catalog,bound,base:buildExportCues(source)};
}
