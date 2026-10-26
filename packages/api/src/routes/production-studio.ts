import {productionEditorial} from "../services/production-editorial.js";
import {completeProductionSource as completeSource, ProductionEditorialInputError} from "../services/production-editorial-source.js";
import {resumeLiveAudio,LiveAudioBlocked} from "../services/audio-live.js";
import {readAudioPublication, readPublishedAudioBytes} from "../services/audio-publication.js";
import {audioBytesResponse} from "./audio.js";
import {productionMomentContent} from "../services/production-moment-content.js";
import { previewAudioTrack, queueAudioBackfill, retryAudioTrack, AudioTrackConflict } from "../services/audio-tracks.js";
import {createHash} from "node:crypto";
import {Hono} from "hono";
import {createMiddleware} from "hono/factory";
import {eq,or} from "drizzle-orm";
import {decodeProductionSelection,resolveProductionMomentIds,type ProductionCatalog} from "@influence/engine/production-moments";
import {decodeProductionSettings} from "@influence/engine/production-moments/settings";
import {decodeProductionCopy,decodeProductionExport,stableProductionJson,type ProductionExportDescriptor} from "@influence/engine/production-moments/export";
import {decodeProductionRecordings,type ProductionRecording} from "@influence/engine/production-moments/recordings";
import {schema,type DrizzleDB} from "../db/index.js";
import {getPermissionsForUser} from "../db/rbac.js";
import {requireAuth,type AuthEnv} from "../middleware/auth.js";
import {AnnotationConflict,decodeAnnotationReplacement,readMomentAnnotations,replaceMomentAnnotation,resolveAnnotatedSelection} from "../services/production-annotations.js";
import {decodeInfluenceProductionSnapshot,readInfluenceProductionSource,InfluenceProductionSourceError} from "../services/influence-production-source.js";
import {decodeWerewolfProductionSnapshot,readWerewolfProductionSource,readWerewolfProductionMedia,readWerewolfProductionCharacter} from "../services/werewolf-production-source.js";
import {readProductionScenes,readProductionScene} from "../services/production-scenes.js";
import {readProductionRecovery} from "../services/production-recovery.js";
import {ReplayVisualError} from "../services/visual-replay-production.js";
import {WerewolfGameError} from "../services/werewolf-games.js";
import type {VisualTransaction} from "../services/visual-execution-boundary.js";

class StudioInputError extends Error {}
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

function descriptorHash(value:Omit<ProductionExportDescriptor,"hash">) {
  return `sha256:${createHash("sha256").update(stableProductionJson(value)).digest("hex")}`;
}
async function assertCompleteExportSource(tx:VisualTransaction,id:string,source:Awaited<ReturnType<typeof completeSource>>,access:Record<string,unknown>) {
  if (source.status !== "completed") throw new WerewolfGameError("Export requires a completed game; paused previews remain available",409);
  const latest = await completeSource(tx,id,access);
  if (source.snapshot.throughEventSequence !== latest.snapshot.throughEventSequence
    || source.snapshot.gameKind === "influence" && latest.snapshot.gameKind === "influence"
      && (source.snapshot.throughTurnSequence !== latest.snapshot.throughTurnSequence
        || stableProductionJson(source.snapshot.transcriptPrefix) !== stableProductionJson(latest.snapshot.transcriptPrefix)))
    throw new WerewolfGameError("Export requires the complete accepted game history. Refresh the source.",409);
}
function validateRecordingMoments(catalog:ProductionCatalog,ids:readonly string[],recordings:readonly ProductionRecording[]) {
  const selected = new Set(ids);
  for (const recording of recordings) {
    resolveProductionMomentIds(catalog,[recording.momentId]);
    // Playback cues own speech identity; the catalog's actor can be the subject
    // of House narration. Do not reconstruct audio policy from moment kinds.
    if (!selected.has(recording.momentId))
      throw new Error("Recording belongs to a moment outside the selected cut");
  }
}

async function validateGeneratedRecordings(db:Pick<DrizzleDB,"select">,source:Awaited<ReturnType<typeof completeSource>>,recordings:readonly ProductionRecording[]) {
  const catalog = source.catalog;
  const generated = recordings.filter(recording => recording.versionId);
  if (!generated.length) return;
  const track = await readAudioPublication(db,catalog.gameId,catalog.audience,catalog.audience !== "mystery",true,generated.map(recording => recording.versionId!));
  for (const recording of generated) {
    const clip = track?.clips.find(clip => clip.momentId === recording.momentId && clip.versionId === recording.versionId);
    if (!clip || clip.speakerId !== recording.speakerId || clip.textHash !== recording.textHash || clip.sha256 !== recording.sha256 || clip.durationMs !== recording.durationMs)
      throw new StudioInputError("Generated recording does not match its authorized stored version");
    const moment = catalog.moments.find(moment => moment.id === recording.momentId);
    const content = moment && productionMomentContent(source, moment);
    if (!content?.text || content.speakerId !== recording.speakerId || createHash("sha256").update(content.text).digest("hex") !== recording.textHash)
      throw new StudioInputError("Generated recording does not match its frozen source text");
  }
}

/** Editorial operations remain Producer/Sysop-only; legacy visual grants live in their existing routes. */
export function createProductionStudioRoutes(db:DrizzleDB) {
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
    if (error instanceof AudioTrackConflict || error instanceof LiveAudioBlocked) return c.json({error:error.message},409);
    if (error instanceof AnnotationConflict) return c.json({error:error.message,current:error.current},409);
    if (error instanceof WerewolfGameError) return c.json({error:error.message},error.status);
    if (error instanceof ReplayVisualError) return c.json({error:error.message,code:error.code},error.status);
    if (error instanceof ProductionEditorialInputError || error instanceof StudioInputError || error instanceof InfluenceProductionSourceError) return c.json({error:error.message},400);
    console.error("[production-studio]",error);
    return c.json({error:"Production request failed. Refresh to check saved state."},500);
  });
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
  app.post(`${root}/selection`,async c => {
    let body:Record<string,unknown>;
    try {body = object(await c.req.json());} catch {throw new StudioInputError("Invalid selection JSON");}
    fields(body,["snapshot","audience","thinking","selection","settings","copy","expectedMomentIds","recordings"]);
    if (!Array.isArray(body.expectedMomentIds) || body.expectedMomentIds.length > 50000
      || body.expectedMomentIds.some(id => typeof id !== "string" || !id || id.length > 8192)
      || new Set(body.expectedMomentIds).size !== body.expectedMomentIds.length)
      throw new StudioInputError("Export requires the exact moment IDs reviewed in preview");
    const expectedMomentIds = body.expectedMomentIds as string[];
    let selection,settings,copy,recordings;
    try {selection = decodeProductionSelection(body.selection);settings = decodeProductionSettings(body.settings);copy = decodeProductionCopy(body.copy);recordings = decodeProductionRecordings(body.recordings ?? []);}
    catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid selection");}
    return c.json(await db.transaction(async tx => {
        const source = await completeSource(tx,c.req.param("id"),body);
        await assertCompleteExportSource(tx,c.req.param("id"),source,{audience:body.audience,thinking:body.thinking});
        let resolved;
        try {
          resolved = await resolveAnnotatedSelection(tx,source.catalog,selection);
          for (const id of Object.keys(settings.profile.overrides)) resolveProductionMomentIds(source.catalog,[id]);
          validateRecordingMoments(source.catalog,resolved.momentIds,recordings);
          await validateGeneratedRecordings(tx,source,recordings);
        } catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid selection");}
        if (resolved.momentIds.length !== expectedMomentIds.length || resolved.momentIds.some((id,index) => id !== expectedMomentIds[index]))
          throw new WerewolfGameError("Saved tags changed this cut. Refresh tags and review the cut before exporting.",409);
        const frozen:Omit<ProductionExportDescriptor,"hash"> = {schema:"house.production-selection",version:1,gameId:source.catalog.gameId,
          gameKind:source.catalog.gameKind,audience:source.catalog.audience,sourceSnapshot:{...source.snapshot},momentIds:resolved.momentIds,
          selection,settings,copy,recordings,annotations:resolved.annotations};
        return {...frozen,hash:descriptorHash(frozen)};
      },{isolationLevel:"repeatable read",accessMode:"read only"}));
  });
  // Exact frozen IDs are reauthorized without consulting current predicate membership.
  app.post(`${root}/selection/validate`,async c => {
    let descriptor:ProductionExportDescriptor;
    try {descriptor = decodeProductionExport(await c.req.json());} catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid selection");}
    const {hash,...frozen} = descriptor;
    if (hash !== descriptorHash(frozen)) throw new StudioInputError("Frozen selection checksum mismatch");
    return c.json(await db.transaction(async tx => {
      const source = await completeSource(tx,c.req.param("id"),{snapshot:descriptor.sourceSnapshot,audience:descriptor.audience,
        thinking:typeof descriptor.sourceSnapshot.thinking === "boolean" ? descriptor.sourceSnapshot.thinking : descriptor.selection.thinking});
      if (source.status !== "completed" || source.catalog.gameId !== descriptor.gameId || source.catalog.gameKind !== descriptor.gameKind) throw new WerewolfGameError("Frozen export requires its completed source game",409);
      await assertCompleteExportSource(tx,c.req.param("id"),source,{audience:descriptor.audience,
        thinking:typeof descriptor.sourceSnapshot.thinking === "boolean" ? descriptor.sourceSnapshot.thinking : descriptor.selection.thinking});
      let moments;
      try {moments = resolveProductionMomentIds(source.catalog,descriptor.momentIds);validateRecordingMoments(source.catalog,descriptor.momentIds,descriptor.recordings);await validateGeneratedRecordings(tx,source,descriptor.recordings);}
      catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid frozen moment");}
      if (moments.some((moment,index) => moment.id !== descriptor.momentIds[index])) throw new StudioInputError("Frozen selection must preserve source order");
      return {valid:true,hash,momentIds:descriptor.momentIds};
    },{isolationLevel:"repeatable read",accessMode:"read only"}));
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
