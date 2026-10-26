import {createHash} from "node:crypto";
import {PRODUCTION_LABELS,PRODUCTION_MOMENT_KINDS,decodeProductionSelection,resolveProductionMomentIds,selectProductionMoments,validateProductionTags,type ProductionCatalog,type ProductionMoment} from "@influence/engine/production-moments";
import {productionReviewPath} from "@influence/engine/production-moments/review";
import {stableProductionJson} from "@influence/engine/production-moments/export";
import type {DrizzleDB} from "../db/index.js";
import {getPermissionsForUser} from "../db/rbac.js";
import {completeProductionSource,type EditorialSource} from "./production-editorial-source.js";
import {productionMomentContent} from "./production-moment-content.js";
import {AnnotationConflict,readMomentAnnotations,replaceMomentAnnotation,type MomentAnnotation} from "./production-annotations.js";
import {readAudioPublication} from "./audio-publication.js";
import {sha256StableJson} from "./stable-hash.js";
import {HOUSE_PAGE_BYTES} from "./house-read-cursor.js";
import {validateEditorialInput,type EditorialToolName} from "../game-mcp/production-editorial-contracts.js";

class EditorialError extends Error {
  constructor(readonly status:"invalid_input"|"invalid_cursor"|"selection_changed"|"source_unavailable"|"oversized_entry"|"unavailable",message:string,readonly studioPath:string|null=null){super(message);}
}
const fail=(status:EditorialError["status"],message:string,path:string|null=null):never=>{throw new EditorialError(status,message,path);};
const path=(gameId:string,audience:string,thinking:boolean,momentId?:string)=>`/admin/production/games/${encodeURIComponent(gameId)}?${new URLSearchParams({audience,thinking:thinking ? "on":"off",...(momentId ? {moment:momentId}:{})})}`;
function errorResult(error:unknown) {
  const e=error instanceof EditorialError ? error:new EditorialError("source_unavailable",error instanceof Error ? error.message:"Production source unavailable");
  return {version:1,status:e.status,message:e.message,studioPath:e.studioPath};
}
function cursorOffset(token:unknown,binding:string,fingerprint?:string):number {
  if (token===undefined) return 0;
  let cursor:Record<string,unknown>;
  try {cursor=JSON.parse(Buffer.from(String(token),"base64url").toString("utf8"));} catch {return fail("invalid_cursor","Invalid cursor; restart the read");}
  if(!cursor || Object.keys(cursor).sort().join()!=="binding,fingerprint,offset,version" || cursor.version!==1 || cursor.binding!==binding || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset)<0) return fail("invalid_cursor","Cursor does not match the pinned source and filters; restart the read");
  if(cursor.fingerprint!==(fingerprint ?? null)) return fail("selection_changed","This cut changed while paging; restart its preview");
  return Number(cursor.offset);
}
function row(source:EditorialSource,moment:ProductionMoment,annotation:MomentAnnotation|undefined,thinking:boolean) {
  const content=productionMomentContent(source,moment);
  return {momentId:moment.id,kind:moment.kind,actorId:moment.actorId ?? null,actorName:content.actorName,sourceKey:moment.sourceKey,
    eventSequence:"eventSequence" in moment.source ? moment.source.eventSequence:null,transcriptId:moment.source.kind==="influence-transcript" ? moment.source.transcriptId:null,
    order:{...moment.order,semantic:moment.semanticOrder},text:content.text,tags:annotation?.tags ?? {},revision:annotation?.revision ?? 0,
    studioPath:path(source.catalog.gameId,source.catalog.audience,thinking,moment.id)};
}
/** Current role is required even when reached through an authenticated HTTP route. */
export async function productionEditorial(db:DrizzleDB,userId:string,name:EditorialToolName,input:unknown):Promise<Record<string,unknown>> {
  try {
    try {validateEditorialInput(name,input);} catch(error){return fail("invalid_input",(error as Error).message);}
    const args=input as Record<string,unknown>;
    let roles:string[];
    try {roles=(await getPermissionsForUser(db,userId)).roles;} catch {return fail("unavailable","Production authorization is temporarily unavailable");}
    if(!roles.some(role=>role==="producer" || role==="sysop")) return fail("unavailable","Current Producer or Sysop role required");
    let authorized:ProductionCatalog|undefined;
    try {
      return await db.transaction(async tx=>{
        const source=await completeProductionSource(tx,String(args.gameIdOrSlug),args);
        const thinking=args.thinking as boolean;
        const catalog={...source.catalog,moments:source.catalog.moments.filter(moment=>thinking || moment.kind!=="thinking")};
        const annotations=await readMomentAnnotations(tx,catalog),byId=new Map(annotations.map(item=>[item.momentId,item]));
        const studioPath=path(catalog.gameId,catalog.audience,thinking);
        if(name==="update_production_moment_tags") {
          const momentId=args.momentId as string;
          try {resolveProductionMomentIds(catalog,[momentId]);} catch {return fail("invalid_input","Moment is not in this authorized source",studioPath);}
          authorized=catalog;
          const current=byId.get(momentId) ?? {momentId,tags:{},revision:0};
          const receipt=(status:string,annotation:MomentAnnotation)=>({version:1,status,annotation,studioPath:path(catalog.gameId,catalog.audience,thinking,momentId)});
          if(current.revision!==args.expectedRevision) return receipt("conflict",current);
          const set=args.set as Record<string,string>,remove=args.remove as string[];
          if(remove.some(key=>Object.hasOwn(set,key))) return fail("invalid_input","set and remove keys cannot overlap",studioPath);
          let tags;
          try {
            // Validate keys even when removal would be a no-op.
            validateProductionTags(Object.fromEntries(remove.map(key=>[key,"true"])));
            const candidate={...current.tags,...set};for(const key of remove) delete candidate[key];
            tags=validateProductionTags(candidate);
            for(const [key,value] of Object.entries(tags)) if(key.startsWith("label.") && (!Object.hasOwn(PRODUCTION_LABELS,key.slice(6)) || value!=="true")) return fail("invalid_input","Use known label keys with value true",studioPath);
            for(const key of remove) if(key.startsWith("label.") && !Object.hasOwn(PRODUCTION_LABELS,key.slice(6))) return fail("invalid_input","Unknown label key",studioPath);
          } catch(error){return fail("invalid_input",(error as Error).message,studioPath);}
          if(stableProductionJson(tags)===stableProductionJson(current.tags)) return receipt("unchanged",current);
          try {return receipt("saved",await replaceMomentAnnotation(tx,catalog,momentId,userId,{expectedRevision:args.expectedRevision,tags}));}
          catch(error){if(error instanceof AnnotationConflict) return receipt("conflict",error.current);throw error;}
        }
        if(args.cursor!==undefined && args.snapshot===undefined) return fail("invalid_cursor","Continue with the returned snapshot",studioPath);
        if(args.momentId!==undefined) try{resolveProductionMomentIds(catalog,[String(args.momentId)]);}catch{return fail("invalid_input","Moment is not in this authorized source",studioPath);}
        let moments=catalog.moments.filter(moment=>(!args.kind || moment.kind===args.kind) && (!args.actorId || moment.actorId===args.actorId) && (!args.momentId || moment.id===args.momentId));
        const binding=sha256StableJson({tool:name,gameId:catalog.gameId,snapshot:source.snapshot,thinking,kind:args.kind ?? null,actorId:args.actorId ?? null,momentId:args.momentId ?? null,recipe:args.recipe ?? null,music:args.music ?? null,volume:args.volume ?? null});
        let preview:Record<string,unknown>={},fingerprint:string|undefined;
        if(name==="preview_production_cut") {
          const recipe=decodeProductionSelection(args.recipe);
          if(recipe.mode!=="recipe" || recipe.thinking!==thinking) return fail("invalid_input","Recipe must match the explicit thinking option",studioPath);
          moments=selectProductionMoments(catalog,recipe,Object.fromEntries(annotations.map(item=>[item.momentId,item.tags])));
          // Stable accepted identity and content, never request-time publication timestamps or media URLs.
          fingerprint=sha256StableJson({gameId:catalog.gameId,gameKind:catalog.gameKind,audience:catalog.audience,throughEventSequence:source.snapshot.throughEventSequence,
            source:catalog.moments.map(moment=>({id:moment.id,order:moment.order,text:productionMomentContent(source,moment).text})),recipe,music:args.music,volume:args.volume,
            selected:moments.map(moment=>byId.get(moment.id) ?? {momentId:moment.id,tags:{},revision:0})});
          const audio=await readAudioPublication(tx,catalog.gameId,catalog.audience,thinking,true);
          const clips=new Map(audio?.clips.map(clip=>[clip.momentId,clip]));
          let eligible=0,covered=0,missing=0,mismatched=0,unverifiable=0,durationMs=0;
          const missingMomentIds:string[]=[];
          for(const moment of moments) {
            const content=productionMomentContent(source,moment),clip=clips.get(moment.id);
            if(!content.text) {if(["speech","thinking","ballot","scene","outcome","result"].includes(moment.kind)) unverifiable++;continue;}
            eligible++;
            if(!clip){missing++;if(missingMomentIds.length<100)missingMomentIds.push(moment.id);}
            else if(clip.speakerId!==content.speakerId || clip.textHash!==createHash("sha256").update(content.text).digest("hex")){mismatched++;if(missingMomentIds.length<100)missingMomentIds.push(moment.id);}
            else {covered++;durationMs+=clip.durationMs;}
          }
          const counts=Object.fromEntries(PRODUCTION_MOMENT_KINDS.map(kind=>[kind,moments.filter(moment=>moment.kind===kind).length]));
          preview={fingerprint,total:moments.length,counts,audio:{eligible,covered,missing,mismatched,unverifiable,durationMs,missingMomentIds},music:args.music,volume:args.volume,
            reviewPath:productionReviewPath(catalog.gameId,{version:1,audience:catalog.audience,thinking,recipe,music:args.music as boolean,volume:args.volume as number,fingerprint})};
        }
        const offset=cursorOffset(args.cursor,binding,fingerprint);
        if(offset>moments.length) return fail("invalid_cursor","Cursor is outside the source",studioPath);
        const result:Record<string,unknown>={version:1,status:"ok",snapshot:source.snapshot,annotationsLive:true,
          labels:Object.entries(PRODUCTION_LABELS).map(([key,label])=>({name:label,key:`label.${key}`,value:"true"})),studioPath,...preview,moments:[],next:null};
        const rows:ReturnType<typeof row>[]=[];
        const limit=Number(args.limit ?? 20);
        for(let i=offset;i<moments.length && rows.length<limit;i++) {
          const entry=row(source,moments[i]!,byId.get(moments[i]!.id),thinking);
          const estimate=Buffer.byteLength(JSON.stringify({...result,moments:[...rows,entry]}))+Buffer.byteLength(JSON.stringify(args))+Buffer.byteLength(JSON.stringify(source.snapshot))+2048;
          if(estimate>HOUSE_PAGE_BYTES) {if(!rows.length)return fail("oversized_entry","This whole moment cannot fit in an MCP page. Read it in Studio using this exact moment link; no text was truncated.",entry.studioPath);break;}
          rows.push(entry);
        }
        result.moments=rows;
        const end=offset+rows.length;
        if(end<moments.length)result.next={tool:name,arguments:{...args,gameIdOrSlug:catalog.gameId,snapshot:source.snapshot,cursor:Buffer.from(JSON.stringify({version:1,binding,offset:end,fingerprint:fingerprint ?? null})).toString("base64url")}};
        if(Buffer.byteLength(JSON.stringify(result))>HOUSE_PAGE_BYTES) return fail("oversized_entry","Source metadata exceeds the MCP page budget; inspect it in Studio",studioPath);
        return result;
      },{isolationLevel:"repeatable read",...(name!=="update_production_moment_tags" ? {accessMode:"read only" as const}:{})});
    } catch(error) {
      const cause=error && typeof error==="object" && "cause" in error ? error.cause:error;
      if(authorized && cause && typeof cause==="object" && "code" in cause && cause.code==="40001") {
        const momentId=String(args.momentId),[current]=await readMomentAnnotations(db,{...authorized,moments:authorized.moments.filter(moment=>moment.id===momentId)});
        return {version:1,status:"conflict",annotation:current ?? {momentId,tags:{},revision:0},studioPath:path(authorized.gameId,authorized.audience,args.thinking as boolean,momentId)};
      }
      throw error;
    }
  }catch(error){return errorResult(error);}
}
