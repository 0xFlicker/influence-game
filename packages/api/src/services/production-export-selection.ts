import {createHash} from "node:crypto";
import {decodeProductionSelection,resolveProductionMomentIds,type ProductionCatalog} from "@influence/engine/production-moments";
import {decodeProductionSettings} from "@influence/engine/production-moments/settings";
import {decodeProductionCopy,decodeProductionExport,stableProductionJson,type ProductionExportDescriptor} from "@influence/engine/production-moments/export";
import {decodeProductionRecordings,type ProductionRecording} from "@influence/engine/production-moments/recordings";
import type {DrizzleDB} from "../db/index.js";
import {completeProductionSource as completeSource} from "./production-editorial-source.js";
import {resolveAnnotatedSelection} from "./production-annotations.js";
import {readAudioPublication} from "./audio-publication.js";
import {productionMomentContent} from "./production-moment-content.js";
import {WerewolfGameError} from "./werewolf-games.js";
import type {VisualTransaction} from "./visual-execution-boundary.js";
export class StudioInputError extends Error {}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new StudioInputError("Request must be an object");
  return value as Record<string,unknown>;
}
function fields(body:Record<string,unknown>,allowed:readonly string[]) {
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw new StudioInputError("Unsupported request field");
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

export async function freezeProductionSelection(db:DrizzleDB,id:string,input:unknown) {
    let body:Record<string,unknown>;
    try {body = object(input);} catch {throw new StudioInputError("Invalid selection JSON");}
    fields(body,["snapshot","audience","thinking","selection","settings","copy","expectedMomentIds","recordings"]);
    if (!Array.isArray(body.expectedMomentIds) || body.expectedMomentIds.length > 50000
      || body.expectedMomentIds.some(id => typeof id !== "string" || !id || id.length > 8192)
      || new Set(body.expectedMomentIds).size !== body.expectedMomentIds.length)
      throw new StudioInputError("Export requires the exact moment IDs reviewed in preview");
    const expectedMomentIds = body.expectedMomentIds as string[];
    let selection,settings,copy,recordings;
    try {selection = decodeProductionSelection(body.selection);settings = decodeProductionSettings(body.settings);copy = decodeProductionCopy(body.copy);recordings = decodeProductionRecordings(body.recordings ?? []);}
    catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid selection");}
    return db.transaction(async tx => {
        const source = await completeSource(tx,id,body);
        await assertCompleteExportSource(tx,id,source,{audience:body.audience,thinking:body.thinking});
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
      },{isolationLevel:"repeatable read",accessMode:"read only"});
}
export async function validateProductionSelection(db:DrizzleDB,id:string,input:unknown) {
    let descriptor:ProductionExportDescriptor;
    try {descriptor = decodeProductionExport(input);} catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid selection");}
    const {hash,...frozen} = descriptor;
    if (hash !== descriptorHash(frozen)) throw new StudioInputError("Frozen selection checksum mismatch");
    return db.transaction(async tx => {
      const source = await completeSource(tx,id,{snapshot:descriptor.sourceSnapshot,audience:descriptor.audience,
        thinking:typeof descriptor.sourceSnapshot.thinking === "boolean" ? descriptor.sourceSnapshot.thinking : descriptor.selection.thinking});
      if (source.status !== "completed" || source.catalog.gameId !== descriptor.gameId || source.catalog.gameKind !== descriptor.gameKind) throw new WerewolfGameError("Frozen export requires its completed source game",409);
      await assertCompleteExportSource(tx,id,source,{audience:descriptor.audience,
        thinking:typeof descriptor.sourceSnapshot.thinking === "boolean" ? descriptor.sourceSnapshot.thinking : descriptor.selection.thinking});
      let moments;
      try {moments = resolveProductionMomentIds(source.catalog,descriptor.momentIds);validateRecordingMoments(source.catalog,descriptor.momentIds,descriptor.recordings);await validateGeneratedRecordings(tx,source,descriptor.recordings);}
      catch (error) {throw new StudioInputError(error instanceof Error ? error.message : "Invalid frozen moment");}
      if (moments.some((moment,index) => moment.id !== descriptor.momentIds[index])) throw new StudioInputError("Frozen selection must preserve source order");
      return {descriptor,source};
    },{isolationLevel:"repeatable read",accessMode:"read only"});
}
