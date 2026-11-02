import Ajv from "ajv";
import {object,snapshotSchema} from "./production-editorial-contracts.js";
import {decodeProductionSettings} from "@influence/engine/production-moments/settings";
import {productionGame,completeProductionSource} from "../services/production-editorial-source.js";
import {freezeProductionSelection} from "../services/production-export-selection.js";
import {readAudioPublication} from "../services/audio-publication.js";
import {findProductionRenderOrder,orderProductionRender,renderOrderHash} from "../services/production-render-order.js";
import {renderJobView,queueRenderJob,cancelRenderJob,retryRenderJob,RenderJobError} from "../services/render-jobs.js";
import {getPermissionsForUser} from "../db/rbac.js";
import type {DrizzleDB} from "../db";
import type {RenderExecution} from "@influence/engine/render-execution-config";
import {renderReadOutputs,renderReadInput} from "./render-contracts.js";

const adjustment={type:"object",additionalProperties:false,properties:Object.fromEntries(["readingRate","thinkingRate","conversationGapMs","ballotHoldMs","tallyHoldMs","establishingHoldMs","motionScale","postSpeechHoldMs"].map(key=>[key,{type:"number",minimum:0}]))};
const profile={...adjustment,properties:{...adjustment.properties,ending:{oneOf:[{const:"finish-score"},object({holdMs:{type:"number",minimum:0}})]},overrides:{type:"object",maxProperties:50000,additionalProperties:adjustment}},required:["ending","overrides"]};
export const renderOrderTools=["order_production_render","cancel_production_render","retry_production_render"] as const;
export const renderOrderInputs={
  order_production_render:object({gameIdOrSlug:{type:"string",minLength:1,maxLength:200},audience:{enum:["public","mystery","omniscient"]},thinking:{type:"boolean"},snapshot:snapshotSchema,
    momentIds:{type:"array",minItems:1,maxItems:50000,uniqueItems:true,items:{type:"string",minLength:1,maxLength:8192}},
    settings:object({width:{type:"integer",minimum:128,maximum:7680},height:{type:"integer",minimum:128,maximum:7680},fps:{type:"integer",minimum:1,maximum:120},reducedMotion:{type:"boolean"},music:{type:"boolean"},volume:{type:"number",minimum:0,maximum:1},profile}),
    copy:object({title:{type:"string",maxLength:300}},[]),requestKey:{type:"string",pattern:"^[A-Za-z0-9._:-]{1,128}$"}}),
  cancel_production_render:renderReadInput,retry_production_render:object({...renderReadInput.properties,executionId:{type:"string",pattern:"^[a-f0-9-]{36}$"}}),
};
const ajv=new Ajv({strict:false}),inputs=Object.fromEntries(renderOrderTools.map(name=>[name,ajv.compile(renderOrderInputs[name])])),output=ajv.compile(renderReadOutputs.get_production_render);
export async function writeProductionRender(db:DrizzleDB,userId:string,name:typeof renderOrderTools[number],value:unknown,execution?:RenderExecution) {
  if(!inputs[name]!(value))throw new RenderJobError("Invalid render tool arguments",400);
  if(!(await getPermissionsForUser(db,userId)).roles.some(r=>r==="producer"||r==="sysop"))throw new RenderJobError("Current producer access required",404);
  const args=value as Record<string,unknown>;
  let job:ReturnType<typeof renderJobView>;
  if(name!=="order_production_render")job=name==="cancel_production_render"?await cancelRenderJob(db,String(args.jobId)):await retryRenderJob(db,String(args.jobId),String(args.executionId),execution);
  else {
    const requestHash=renderOrderHash({tool:name,args}),requestKey=String(args.requestKey);
    const existing=await findProductionRenderOrder(db,userId,requestKey,requestHash);
    if(existing)job=existing.state==="uploading_inputs"?await queueRenderJob(db,existing.id):renderJobView(existing);
    else {
      const game=await productionGame(db,String(args.gameIdOrSlug));
      const source=await db.transaction(tx=>completeProductionSource(tx,game.id,args),{isolationLevel:"repeatable read",accessMode:"read only"});
      const momentIds=args.momentIds as string[],settings=decodeProductionSettings(args.settings);
      const audio=await readAudioPublication(db,game.id,args.audience as "public"|"mystery"|"omniscient",args.thinking as boolean,true);
      const recordings=audio?.clips.filter(c=>momentIds.includes(c.momentId)).map(c=>({momentId:c.momentId,messageId:c.momentId,speakerId:c.speakerId,textHash:c.textHash,sha256:c.sha256,durationMs:c.durationMs,versionId:c.versionId}))??[];
      const descriptor=await freezeProductionSelection(db,game.id,{snapshot:source.snapshot,audience:args.audience,thinking:args.thinking,
        selection:{mode:"ids",thinking:args.thinking,ids:momentIds},expectedMomentIds:momentIds,settings,copy:args.copy,recordings});
      job=await orderProductionRender(db,userId,game.id,{descriptor,requestKey},{execution,requestHash});
    }
  }
  const result={status:"ok",job};if(!output(result))throw new Error("Render tool output contract mismatch");
  return {structuredContent:result,content:[{type:"text" as const,text:JSON.stringify(result)}]};
}
