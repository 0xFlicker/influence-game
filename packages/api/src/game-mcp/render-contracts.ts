import Ajv from "ajv";
import {getPermissionsForUser} from "../db/rbac";
import type {DrizzleDB} from "../db";
import {renderJob,renderJobView} from "../services/render-jobs";
import {renderDownload} from "../services/render-object-storage";
const object=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,properties,required:Object.keys(properties)});
const text={type:"string"},nullable=(v:unknown)=>({anyOf:[v,{type:"null"}]}),integer={type:"integer",minimum:0};
const error=object({status:{const:"unavailable"},message:text});
const job=object({id:text,executionId:text,gameId:text,workload:{enum:["trailer","studio-export"]},state:{enum:["uploading_inputs","queued","rendering","uploading","verifying","succeeded","failed","cancelled"]},
  progress:integer,attempt:integer,rendererDigest:text,failure:nullable(text),createdAt:text,updatedAt:text,
  output:nullable(object({sha256:nullable(text),byteLength:nullable(integer)}))});
export const renderReadTools=["get_production_render","get_production_render_download"] as const;
export const renderReadInput=object({jobId:{type:"string",pattern:"^[a-f0-9-]{36}$"}});
export const renderReadOutputs={
  get_production_render:{type:"object",oneOf:[object({status:{const:"ok"},job}),error]},
  get_production_render_download:{type:"object",oneOf:[object({status:{const:"ok"},url:text,expiresAt:text,sha256:text,byteLength:integer}),error]},
};
const ajv=new Ajv({strict:false});const input=ajv.compile(renderReadInput);
const outputs=Object.fromEntries(renderReadTools.map(name=>[name,ajv.compile(renderReadOutputs[name])]));
export async function readProductionRender(db:DrizzleDB,userId:string,name:typeof renderReadTools[number],args:unknown) {
  let result:Record<string,unknown>;
  try {
    if(!input(args))throw new Error("Invalid render arguments");
    if(!(await getPermissionsForUser(db,userId)).roles.some(role=>role==="producer"||role==="sysop"))throw new Error("Current producer access required");
    const row=await renderJob(db,(args as {jobId:string}).jobId);
    if(name==="get_production_render")result={status:"ok",job:renderJobView(row)};
    else {
      if(row.state!=="succeeded"||!row.outputKey||!row.outputHash||!row.outputBytes)throw new Error("Private video output is not ready");
      result={status:"ok",url:await renderDownload(row.outputKey),expiresAt:new Date(Date.now()+900000).toISOString(),sha256:row.outputHash,byteLength:row.outputBytes};
    }
  }catch {result={status:"unavailable",message:"Render is unavailable or current producer access is required"};}
  if(!outputs[name]!(result))throw new Error("Render output contract mismatch");
  return {structuredContent:result,content:[{type:"text" as const,text:JSON.stringify(result)}]};
}
