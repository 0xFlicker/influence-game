import {eq} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db";
import {createRenderJob} from "../services/render-jobs";

/** Presentation fixtures only. Caller owns a disposable local database; these rows are never dispatched. */
export async function seedRenderMonitorFixture(db:DrizzleDB,userId:string) {
  const influence="monitor-demo-influence",werewolf="monitor-demo-werewolf";
  await db.insert(schema.games).values([{id:influence,slug:"the-last-promise",status:"completed",config:"{}"},{id:werewolf,slug:"a-wolf-among-friends",gameKind:"werewolf",status:"completed",config:"{}"}]);
  await db.insert(schema.gameEpisodePresentations).values([{gameId:influence,title:"The Last Promise",status:"ready"},{gameId:werewolf,title:"A Wolf Among Friends",status:"ready"}]);
  const examples=[
    {name:"rendering",gameId:influence,state:"rendering",minutes:38,progress:64},
    {name:"trailer",gameId:werewolf,state:"queued",minutes:6,progress:0,trailer:1},
    {name:"uploading",gameId:werewolf,state:"uploading",minutes:22,progress:95},
    {name:"queued",gameId:influence,state:"queued",minutes:12,progress:0},
    {name:"failed",gameId:influence,state:"failed",minutes:73,progress:48,failure:"worker_lease_expired"},
    {name:"completed",gameId:werewolf,state:"succeeded",minutes:96,progress:100,trailer:2},
    {name:"cancelled",gameId:influence,state:"cancelled",minutes:125,progress:0},
  ];
  const ids:Record<string,string>={};
  for(const example of examples) {
    const job=await createRenderJob(db,{gameId:example.gameId,userId:example.trailer?null:userId,requestKey:`monitor-demo-${example.name}`,rendererDigest:`sha256:${"a".repeat(64)}`,
      input:example.trailer?{version:1,workload:"trailer",gameId:example.gameId,renderVersion:example.trailer}:{version:1,workload:"studio-export",selectionHash:`sha256:${"b".repeat(64)}`,files:[{path:"manifest.json",sha256:"c".repeat(64),byteLength:1}]}});
    const createdAt=new Date(Date.now()-example.minutes*60000).toISOString();
    await db.update(schema.renderJobs).set({state:example.state,progress:example.progress,failure:example.failure??null,attempt:example.progress?1:0,createdAt,updatedAt:createdAt}).where(eq(schema.renderJobs.id,job.id));
    ids[example.name]=job.id;
  }
  return {ids,influence,werewolf};
}
