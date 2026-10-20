import {expect,test} from "bun:test";
import {werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfWatch,projectWerewolfProductionProvenance} from "@influence/engine/werewolf/watch";
import {assembleProductionCatalog} from "@influence/engine/production-moments";
import {buildWerewolfProductionSources} from "@influence/engine/production-moments/werewolf-source";
import {buildInfluenceProductionSources} from "@influence/engine/production-moments/influence-source";
import {loadProductionReplaySource} from "./production-source";
import type {ReadReplayJson} from "./source";
import {assertMysteryWindow} from "./source";
import {buildExportCues} from "./cues";
import {compilePresentation} from "./presentation";
import {bindWerewolfProductionPresentation} from "./production-presentation";
import {parseTimingProfile} from "./timing";

function reader(values:unknown[],paths:string[]=[]):ReadReplayJson {
  return async <T>(path:string) => {paths.push(path);if (!values.length) throw new Error("Unexpected source read");return values.shift() as T;};
}
async function wolfPages() {
  const gameId="paged-production",audience="mystery" as const,events=await werewolfResultsFixture("village",gameId);
  const provenance=projectWerewolfProductionProvenance(events,audience),pages=[];
  let from=1;
  do {
    const projected=projectWerewolfWatch(events,audience,from,8);
    const window={...projected,slug:gameId,status:"completed" as const,audience,publicationCutoff:"2026-10-09T00:00:00.000Z",media:{},moments:projected.moments.map(({staging:_staging,...moment})=>{void _staging;return moment;})};
    const snapshot={gameId,gameKind:"werewolf" as const,audience,thinking:false,throughEventSequence:events.at(-1)!.sequence,throughCursor:window.latestCursor,publicationCutoff:window.publicationCutoff,sourceHash:`sha256:${"a".repeat(64)}`};
    const catalog=assembleProductionCatalog({gameId,gameKind:"werewolf",audience,sources:buildWerewolfProductionSources({gameId,audience,moments:window.moments,provenance,thoughts:[],opening:from===1})});
    pages.push({snapshot,status:"completed",title:"Frozen local episode",window,catalog,provenance:provenance.filter(row=>row.cursor>=from&&row.cursor<=window.throughCursor),thoughts:[],annotations:[],nextCursor:window.throughCursor<window.latestCursor?window.throughCursor+1:null});
    from=window.throughCursor+1;
  } while (from<=pages[0]!.snapshot.throughCursor);
  return {pages,input:{gameId,gameKind:"werewolf" as const,audience,thinking:false}};
}
test("Mystery refuses private thinking before any source read",async()=>{
  const paths:string[]=[];
  await expect(loadProductionReplaySource(reader([],paths),{gameId:"g",gameKind:"werewolf",audience:"mystery",thinking:true})).rejects.toThrow("Mystery");
  expect(paths).toEqual([]);
});
test("bounded Werewolf pages assemble complete safe source before selection",async()=>{
  const {pages,input}=await wolfPages(),paths:string[]=[];
  expect(pages.length).toBeGreaterThan(1);
  const loaded=await loadProductionReplaySource(reader(structuredClone(pages),paths),input);
  expect(loaded.source.kind).toBe("werewolf");
  if(loaded.source.kind!=="werewolf") throw new Error("Werewolf source expected");
  loaded.source.windows.forEach(assertMysteryWindow);
  expect(loaded.source.windows.flatMap(page=>page.moments)).toHaveLength(loaded.snapshot.throughCursor!);
  expect(paths.slice(1).every(path=>new URL(path,"http://local").searchParams.has("snapshot"))).toBe(true);
  expect(paths.every(path=>new URL(path,"http://local").searchParams.get("limit")==="64")).toBe(true);
  const moments=await bindWerewolfProductionPresentation({source:loaded.source,catalog:loaded.catalog,provenance:loaded.provenance,thoughts:loaded.thoughts});
  const result=loaded.catalog.moments.find(moment=>moment.kind==="result")!;
  const compiled=compilePresentation({source:moments,selectedIds:[result.id],profile:parseTimingProfile({ending:{holdMs:0}}),fps:30,assets:{},music:false});
  const base=buildExportCues(loaded.source);
  expect(compiled.cues[0]!.picture).toEqual(base.findLast(cue=>cue.timing.kind==="result")!.picture);
  expect(JSON.stringify(compiled)).not.toContain('"staging"');
});
test("gaps, truncated tails and changing source hashes fail before compilation",async()=>{
  const {pages,input}=await wolfPages();
  const gap=structuredClone(pages);gap[0]!.window.moments.splice(1,1);
  await expect(loadProductionReplaySource(reader(gap),input)).rejects.toThrow("gap");
  const stale=structuredClone(pages);stale[1]!.snapshot.sourceHash=`sha256:${"b".repeat(64)}`;
  await expect(loadProductionReplaySource(reader(stale),input)).rejects.toThrow("Fixed source changed");
  const tail=structuredClone(pages);tail[0]!.nextCursor=null;
  await expect(loadProductionReplaySource(reader(tail),input)).rejects.toThrow("incomplete");
});
test("Influence independently exhausted paging lanes do not reload old frames or lose scene bindings",async()=>{
  const gameId="g",messages=[1,2].map(id=>({id,gameId,round:1,phase:"INTRODUCTION",scope:"public",fromPlayerId:"a",text:`Speech ${id}`,timestamp:id}));
  const catalog=assembleProductionCatalog({gameId,gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId,gameKernel:"classic",transcripts:messages,frames:[]})});
  const snapshot={gameId,gameKind:"influence",audience:"public",throughEventSequence:2,publicationCutoff:"2026-10-09T00:00:00.000Z",sourceHash:`sha256:${"a".repeat(64)}`};
  // This adapter test owns pagination only; canonical frame projection is proved by source services.
  const base={snapshot,status:"completed",game:{id:gameId,slug:gameId,status:"completed",players:[]},acceptedThoughts:[],annotations:[],totalFrames:2,totalMessages:2,totalMoments:catalog.moments.length,totalThoughts:0,totalScenes:2,nextSequence:null,nextThoughtOffset:null};
  const pages=[{...base,messages:[messages[0]],frames:[{sequence:1},{sequence:2}],catalog:{...catalog,moments:catalog.moments.slice(0,2)},visual:{enabled:true,status:null,portraits:{},scenes:[{id:"scene-1"}],bindings:{first:"scene-1"},publicationSnapshot:{}},nextMessageOffset:1,nextCatalogOffset:2,nextVisualOffset:1},
    {...base,messages:[messages[1]],frames:[],catalog:{...catalog,moments:catalog.moments.slice(2)},visual:{enabled:true,status:null,portraits:{},scenes:[{id:"scene-2"}],bindings:{second:"scene-2"},publicationSnapshot:{}},nextMessageOffset:null,nextCatalogOffset:null,nextVisualOffset:null}];
  const paths:string[]=[],loaded=await loadProductionReplaySource(reader(pages,paths),{gameId,gameKind:"influence",audience:"public",thinking:false});
  const next=new URL(paths[1]!,"http://local").searchParams;
  expect(next.get("afterSequence")).toBe("2");expect(next.get("offset")).toBe("1");expect(next.get("catalogOffset")).toBe("2");expect(next.get("visualOffset")).toBe("1");
  expect(loaded.catalog.moments).toEqual(catalog.moments);
  if(loaded.source.kind!=="influence") throw new Error("Influence source expected");
  expect(loaded.source.messages).toHaveLength(2);expect(loaded.source.frames).toHaveLength(2);
  expect(loaded.source.visual.scenes).toHaveLength(2);expect(loaded.source.visual.bindings).toEqual({first:"scene-1",second:"scene-2"});
});
