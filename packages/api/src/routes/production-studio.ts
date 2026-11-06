import {readGameFollowContext} from '../services/game-follow-context.js';
import {renderExecutionConfig,studioRenderEnabled,renderWorkerDigest,type RenderExecution} from "@influence/engine/render-execution-config";
import {orderProductionRender} from "../services/production-render-order.js";
import {renderFile} from "@influence/engine/render-job";
import {createRenderJob,renderJobView,RenderJobError} from "../services/render-jobs.js";
import {HouseInspectionError} from '../services/house-game-access.js';
import {productionEditorial} from "../services/production-editorial.js";
import {completeProductionSource as completeSource, ProductionEditorialInputError} from "../services/production-editorial-source.js";
import {resumeLiveAudio,LiveAudioBlocked} from "../services/audio-live.js";
import {readAudioPublication, readPublishedAudioBytes} from "../services/audio-publication.js";
import {audioBytesResponse} from "./audio.js";
import { previewAudioTrack, queueAudioBackfill, retryAudioTrack, AudioTrackConflict } from "../services/audio-tracks.js";
import {Hono} from "hono";
import {createMiddleware} from "hono/factory";
import {eq,or} from "drizzle-orm";
import {resolveProductionMomentIds,type ProductionCatalog} from "@influence/engine/production-moments";
import {decodeProductionExport} from "@influence/engine/production-moments/export";
import {schema,type DrizzleDB} from "../db/index.js";
import {getPermissionsForUser} from "../db/rbac.js";
import {requireAuth,type AuthEnv} from "../middleware/auth.js";
import {AnnotationConflict,decodeAnnotationReplacement,readMomentAnnotations,replaceMomentAnnotation} from "../services/production-annotations.js";
import {decodeInfluenceProductionSnapshot,readInfluenceProductionSource,InfluenceProductionSourceError} from "../services/influence-production-source.js";
import {decodeWerewolfProductionSnapshot,readWerewolfProductionSource,readWerewolfProductionMedia,readWerewolfProductionCharacter} from "../services/werewolf-production-source.js";
import {readProductionScenes,readProductionScene} from "../services/production-scenes.js";
import {readProductionRecovery} from "../services/production-recovery.js";
import {ReplayVisualError} from "../services/visual-replay-production.js";
import {WerewolfGameError} from "../services/werewolf-games.js";

import {freezeProductionSelection,validateProductionSelection,StudioInputError} from "../services/production-export-selection.js";
function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioInputError("Request must be an object");
  return value as Record<string,unknown>;
}
function fields(body:Record<string,unknown>,allowed:readonly string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new StudioInputError("Unsupported request field");
}
function parseSnapshot(value:string|undefined):unknown {
  if (value === undefined) return undefined;
  if (value.length > 65536) throw new StudioInputError("Source snapshot is too large");
  try {return JSON.parse(value);} catch {throw new StudioInputError("Invalid source snapshot JSON");}
}
function position(value:string|undefined):number|undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new StudioInputError("Invalid source page position");
  return Number(value);
}
function options(body:Record<string,unknown>):{audience:"public"|"mystery"|"omniscient";thinking:boolean} {
  const audience = body.audience;
  if (audience !== "public" && audience !== "mystery" && audience !== "omniscient") throw new StudioInputError("Invalid source audience");
  if (typeof body.thinking !== "boolean") throw new StudioInputError("Source requires a boolean thinking option");
  return {audience,thinking:body.thinking};
}
async function kind(db:Pick<DrizzleDB,"select">,id:string) {
  const [game] = await db.select({id:schema.games.id,gameKind:schema.games.gameKind}).from(schema.games)
    .where(or(eq(schema.games.id,id),eq(schema.games.slug,id)));
  if (!game) throw new WerewolfGameError("Production game not found",404);
  return game;
}


/** Editorial operations remain Producer/Sysop-only; legacy visual grants live in their existing routes. */
export function createProductionStudioRoutes(db:DrizzleDB,config:{execution?:RenderExecution}={}) {
  const app = new Hono<AuthEnv>(),root = "/api/admin/production/games/:id";
  app.use("/api/admin/production/*",requireAuth(db),createMiddleware<AuthEnv>(async (c,next) => {
    c.header("Cache-Control","private, no-store");
    let roles:string[];
    try {roles = (await getPermissionsForUser(db,c.get("user").id)).roles;}
    catch {return c.json({error:"Production authorization is temporarily unavailable"},503);}
    if (!roles.some(role => role === "producer" || role === "sysop")) return c.json({error:"Producer or Sysop role required"},403);
    await next();
  }));
  app.onError((error,c) => {
    if(error instanceof RenderJobError)return c.json({error:error.message},error.status);
    if(error instanceof HouseInspectionError)return c.json({error:error.message},error.code==='not_accessible'?404:400);
    if (error instanceof AudioTrackConflict || error instanceof LiveAudioBlocked) return c.json({error:error.message},409);
    if (error instanceof AnnotationConflict) return c.json({error:error.message,current:error.current},409);
    if (error instanceof WerewolfGameError) return c.json({error:error.message},error.status);
    if (error instanceof ReplayVisualError) return c.json({error:error.message,code:error.code},error.status);
    if (error instanceof ProductionEditorialInputError || error instanceof StudioInputError || error instanceof InfluenceProductionSourceError) return c.json({error:error.message},400);
    console.error("[production-studio]",error);
    return c.json({error:"Production request failed. Refresh to check saved state."},500);
  });
  app.post(`${root}/follow-context`,async c=>c.json(await readGameFollowContext(db,c.req.param('id'),await c.req.json())));
  app.post(`${root}/cut-preview`,async c => {
    const body=object(await c.req.json());fields(body,["audience","thinking","snapshot","recipe","music","volume"]);
    const result=await productionEditorial(db,c.get("user").id,"preview_production_cut",{...body,gameIdOrSlug:c.req.param("id"),limit:1});
    return c.json(result,result.status === "ok" ? 200:400);
  });
  app.get(`${root}/audio/manifest`, async c => {
    const access=options({audience:c.req.query("audience"),thinking:c.req.query("thinking")==="on"});
    return c.json(await readAudioPublication(db,c.req.param("id"),access.audience,access.thinking,true));
  });
  app.post(`${root}/audio/versions`, async c => {
    const body = object(await c.req.json()); fields(body,["audience","thinking","versionIds"]);
    const access = options(body);
    if (!Array.isArray(body.versionIds) || body.versionIds.length > 50000 || new Set(body.versionIds).size !== body.versionIds.length
      || body.versionIds.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))) throw new StudioInputError("Invalid frozen audio versions");
    const publication = await readAudioPublication(db,c.req.param("id"),access.audience,access.thinking,true,body.versionIds as string[]);
    if ((publication?.clips.length ?? 0) !== body.versionIds.length) throw new StudioInputError("Frozen audio version is unavailable for this audience");
    return c.json(publication);
  });
  app.get(`${root}/audio/:version`, async c => {
    const audience = c.req.query("audience"), thinking = c.req.query("thinking"), version = c.req.param("version");
    if (thinking !== "on" && thinking !== "off") throw new StudioInputError("Invalid audio thinking option");
    const access = options({audience, thinking: thinking === "on"});
    if (!/^[a-f0-9-]{36}$/.test(version)) return c.json({error:"Audio not found"},404);
    return audioBytesResponse(c, await readPublishedAudioBytes(db,c.req.param("id"),version,access.audience,access.thinking,true));
  });
  app.get(`${root}/audio`, async c => {
    const game = await kind(db,c.req.param("id"));
    const preview = await previewAudioTrack(db,game.id);
    return c.json({previewHash:preview.previewHash, voices:preview.voices, clipCount:preview.source.lines.length,
      characters:preview.characters, estimateUsd:preview.estimateUsd, retryBudgetUsd:preview.retryBudgetUsd, tracks:preview.existing,resumeOwnerEpoch:preview.resumeOwnerEpoch});
  });
  app.post(`${root}/audio`, async c => {
    const body = object(await c.req.json()); fields(body,["previewHash"]);
    if (typeof body.previewHash !== "string") throw new StudioInputError("Review the audio preview before generating");
    const game = await kind(db,c.req.param("id"));
    return c.json({trackId:await queueAudioBackfill(db,game.id,c.get("user").id,body.previewHash)},202);
  });
  app.post(`${root}/audio/resume`,async c => {
    const body=object(await c.req.json());fields(body,["ownerEpoch"]);
    if (typeof body.ownerEpoch !== "string") throw new StudioInputError("Review audio recovery before resuming");
    const game=await kind(db,c.req.param("id"));
    await resumeLiveAudio(db,game.id,body.ownerEpoch);
    return c.json({resumed:true});
  });
  app.post(`${root}/audio/:track/retry`, async c => {
    const game = await kind(db,c.req.param("id"));
    await retryAudioTrack(db,game.id,c.req.param("track"));
    return c.json({queued:true},202);
  });
  app.get(`${root}/recovery`,async c => {
    if (Object.keys(c.req.query()).some(key => !["offset","limit"].includes(key))) throw new StudioInputError("Unsupported recovery query");
    return c.json(await readProductionRecovery(db,c.req.param("id"),position(c.req.query("offset")),position(c.req.query("limit"))));
  });
  app.get(`${root}/source`,async c => {
    const query = c.req.query();
    fields(query,["audience","thinking","snapshot","fromCursor","limit","afterSequence","offset","catalogOffset","thoughtOffset","visualOffset","refreshPublished"]);
    if (query.thinking !== "on" && query.thinking !== "off") throw new StudioInputError("thinking must be on or off");
    if (query.refreshPublished !== undefined && query.refreshPublished !== "true") throw new StudioInputError("Invalid publication refresh");
    const game = await kind(db,c.req.param("id")),snapshot = parseSnapshot(query.snapshot);
    if (game.gameKind === "werewolf") {
      if (query.audience !== "mystery" && query.audience !== "omniscient") throw new StudioInputError("Invalid Werewolf audience");
      const page = await readWerewolfProductionSource(db,game.id,{audience:query.audience,thinking:query.thinking === "on",
        snapshot:snapshot === undefined ? undefined : decodeWerewolfProductionSnapshot(snapshot),fromCursor:position(query.fromCursor),limit:position(query.limit),refreshVisuals:query.refreshPublished === "true"});
      return c.json({...page,annotations:await readMomentAnnotations(db,page.catalog)});
    }
    if (query.audience !== "public") throw new StudioInputError("Influence uses its public audience");
    const page = await readInfluenceProductionSource(db,game.id,{snapshot:snapshot === undefined ? undefined : decodeInfluenceProductionSnapshot(snapshot),
      afterSequence:position(query.afterSequence),offset:position(query.offset),catalogOffset:position(query.catalogOffset),thoughtOffset:position(query.thoughtOffset),
      visualOffset:position(query.visualOffset),
      limit:position(query.limit),refreshVisuals:query.refreshPublished === "true"});
    return c.json({...page,annotations:await readMomentAnnotations(db,page.catalog)});
  });
  app.get(`${root}/source/media/:asset`,async c => {
    const snapshot = decodeWerewolfProductionSnapshot(parseSnapshot(c.req.query("snapshot")));
    const media = await readWerewolfProductionMedia(db,c.req.param("id"),c.req.param("asset"),{snapshot});
    c.header("Content-Type",media.contentType);return c.body(media.bytes);
  });
  app.get(`${root}/source/characters/:player`,async c => {
    const snapshot = decodeWerewolfProductionSnapshot(parseSnapshot(c.req.query("snapshot")));
    const image = c.req.query("image");
    if (image !== undefined && image !== "body" && image !== "portrait") throw new StudioInputError("Invalid character image");
    const media = await readWerewolfProductionCharacter(db,c.req.param("id"),c.req.param("player"),{snapshot,image});
    c.header("Content-Type",media.contentType);return c.body(media.bytes);
  });
  app.post(`${root}/moments/:moment/annotation`,async c => {
    let body:Record<string,unknown>;
    try {body = object(await c.req.json());} catch {throw new StudioInputError("Invalid annotation JSON");}
    fields(body,["snapshot","audience","thinking","expectedRevision","tags"]);
    let replacement:ReturnType<typeof decodeAnnotationReplacement>;
    try {replacement = decodeAnnotationReplacement({expectedRevision:body.expectedRevision,tags:body.tags});}
    catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid annotation");}
    let authorizedCatalog:ProductionCatalog|undefined;
    try {
      return c.json(await db.transaction(async tx => {
        const source = await completeSource(tx,c.req.param("id"),body);
        try {resolveProductionMomentIds(source.catalog,[c.req.param("moment")]);}
        catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid moment");}
        authorizedCatalog = source.catalog;
        return replaceMomentAnnotation(tx,source.catalog,c.req.param("moment"),c.get("user").id,replacement);
      },{isolationLevel:"repeatable read"}));
    } catch (error) {
      const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
      if (authorizedCatalog && cause && typeof cause === "object" && "code" in cause && cause.code === "40001") {
        const momentId = c.req.param("moment"),catalog = authorizedCatalog;
        const [current] = await readMomentAnnotations(db,{...catalog,moments:catalog.moments.filter(moment => moment.id === momentId)});
        throw new AnnotationConflict(current ?? {momentId,tags:{},revision:0});
      }
      throw error;
    }
  });
  app.post(`${root}/selection`,async c=>c.json(await freezeProductionSelection(db,c.req.param("id"),await c.req.json())));
  app.post(`${root}/selection/validate`,async c=>{
    const {descriptor}=await validateProductionSelection(db,c.req.param("id"),await c.req.json());
    return c.json({valid:true,hash:descriptor.hash,momentIds:descriptor.momentIds});
  });
  app.post(`${root}/render-orders`,async c=> {
    const body=object(await c.req.json());fields(body,["descriptor","requestKey","files"]);
    if(typeof body.requestKey!=="string"||body.files!==undefined&&!Array.isArray(body.files))throw new StudioInputError("Invalid render order");
    return c.json(await orderProductionRender(db,c.get("user").id,c.req.param("id"),{descriptor:body.descriptor,requestKey:body.requestKey,
      files:((body.files??[]) as unknown[]).map(renderFile)},config),202);
  });
  app.post(`${root}/renders`,async c=> {
    const execution=config.execution??renderExecutionConfig();
    if(!studioRenderEnabled(execution))return c.json({error:"Cloud exports are not selected for this environment"},503);
    const body=object(await c.req.json());fields(body,["descriptor","input","requestKey"]);
    const validation=await app.request(new URL(`/api/admin/production/games/${encodeURIComponent(c.req.param("id"))}/selection/validate`,c.req.url),{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:c.req.header("Authorization") ?? ""},body:JSON.stringify(body.descriptor)});
    if(!validation.ok) return new Response(validation.body,{status:validation.status,headers:validation.headers});
    const descriptor=decodeProductionExport(body.descriptor);
    const input=body.input as Record<string,unknown>;
    if(input?.workload!=="studio-export"||input.selectionHash!==descriptor.hash||Object.hasOwn(input,"preparation")) throw new StudioInputError("Prepared bundle must match the frozen selection");
    const digest=renderWorkerDigest(execution);
    if(!digest) return c.json({error:"Render worker image has not been admitted"},503);
    const row=await createRenderJob(db,{gameId:descriptor.gameId,userId:c.get("user").id,requestKey:String(body.requestKey),input,rendererDigest:digest});
    return c.json(renderJobView(row),202);
  });
  app.post(`${root}/trailer-render`,async c=> {
    if((config.execution??renderExecutionConfig()).targets?.trailer!=="aws-batch")return c.json({error:"Batch trailers are not selected for this environment"},503);
    const body=object(await c.req.json());fields(body,["requestKey"]);
    const digest=process.env.RENDER_JOB_WORKER_DIGEST;
    if(!digest)return c.json({error:"Render worker image has not been admitted"},503);
    return c.json(await db.transaction(async tx=> {
      const [release]=await tx.select().from(schema.postgameMediaRenderRelease).where(eq(schema.postgameMediaRenderRelease.id,1)).for("update");
      if(!release)throw new RenderJobError("Renderer release has not been accepted");
      const [media]=await tx.select().from(schema.gamePostgameMedia).where(eq(schema.gamePostgameMedia.gameId,c.req.param("id"))).for("update");
      if(!media||media.status!=="queued")throw new RenderJobError("A queued canonical trailer render is required");
      const job=await createRenderJob(tx,{gameId:media.gameId,userId:c.get("user").id,requestKey:String(body.requestKey),rendererDigest:digest,
        input:{version:1,workload:"trailer",gameId:media.gameId,renderVersion:media.renderVersion}});
      if(job.state==="uploading_inputs")await tx.update(schema.renderJobs).set({state:"queued"}).where(eq(schema.renderJobs.id,job.id));
      return renderJobView(job.state==="uploading_inputs"?{...job,state:"queued"}:job);
    }),202);
  });
  app.get(`${root}/scenes`,async c => {
    fields(c.req.query(),["offset","limit","audience"]);
    const audience = c.req.query("audience");
    if (audience !== "public" && audience !== "mystery" && audience !== "omniscient") throw new StudioInputError("Invalid scene audience");
    return c.json(await readProductionScenes(db,c.req.param("id"),{audience,offset:position(c.req.query("offset")),limit:position(c.req.query("limit"))}));
  });
  app.get(`${root}/scenes/:key`,async c => {
    fields(c.req.query(),["versionId","audience","offset","limit"]);
    const audience = c.req.query("audience");
    if (audience !== "public" && audience !== "mystery" && audience !== "omniscient") throw new StudioInputError("Invalid scene audience");
    return c.json(await readProductionScene(db,c.req.param("id"),c.req.param("key"),{audience,versionId:c.req.query("versionId"),offset:position(c.req.query("offset")),limit:position(c.req.query("limit"))}));
  });
  return app;
}
