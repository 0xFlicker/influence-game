import {decodeProductionSelection,validateProductionTags,type ProductionSelection,type ProductionTags} from "./index";
import {decodeProductionSettings,type ProductionPresentationSettings} from "./settings";
import {decodeProductionRecordings,type ProductionRecording} from "./recordings";

export interface ProductionExportDescriptor {
  schema:"house.production-selection";version:1;gameId:string;gameKind:"influence"|"werewolf";
  audience:"public"|"mystery"|"omniscient";sourceSnapshot:Record<string,unknown>;momentIds:string[];
  selection:ProductionSelection;settings:ProductionPresentationSettings;copy:{title?:string};
  recordings:ProductionRecording[];
  annotations:{momentId:string;tags:ProductionTags;revision:number}[];
  hash:string;
}
export function stableProductionJson(value:unknown):string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableProductionJson).join(",")}]`;
  const record = value as Record<string,unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableProductionJson(record[key])}`).join(",")}}`;
}
export function decodeProductionCopy(value:unknown):{title?:string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Production copy must be an object");
  const copy = value as Record<string,unknown>;
  if (Object.keys(copy).some(key => key !== "title") || copy.title !== undefined && (typeof copy.title !== "string" || copy.title.length > 300))
    throw new Error("Production copy requires a bounded title");
  return typeof copy.title === "string" ? {title:copy.title} : {};
}
/** Source snapshots and exact IDs are validated against current grants by the API.
 * A local descriptor contains data only: no origin, request URL, credential or executable path. */
export function decodeProductionExport(value:unknown):ProductionExportDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Production selection must be an object");
  const input = value as Record<string,unknown>;
  if (Object.keys(input).sort().join() !== "annotations,audience,copy,gameId,gameKind,hash,momentIds,recordings,schema,selection,settings,sourceSnapshot,version"
    || input.schema !== "house.production-selection" || input.version !== 1 || typeof input.gameId !== "string" || !input.gameId || input.gameId.length > 200
    || !["influence","werewolf"].includes(String(input.gameKind)) || !["public","mystery","omniscient"].includes(String(input.audience))
    || (input.gameKind === "influence" ? input.audience !== "public" : input.audience === "public")
    || !input.sourceSnapshot || typeof input.sourceSnapshot !== "object" || Array.isArray(input.sourceSnapshot)
    || !Array.isArray(input.momentIds) || input.momentIds.length > 50000 || input.momentIds.some(id => typeof id !== "string" || !id || id.length > 8192)
    || new Set(input.momentIds).size !== input.momentIds.length
    || typeof input.hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input.hash)) throw new Error("Invalid or obsolete production selection");
  const selection = decodeProductionSelection(input.selection);
  const recordings = decodeProductionRecordings(input.recordings);
  if (recordings.some(recording => !(input.momentIds as string[]).includes(recording.momentId))) throw new Error("Frozen recording belongs to an omitted moment");
  if (!Array.isArray(input.annotations) || input.annotations.length !== input.momentIds.length) throw new Error("Frozen cut requires its selected annotation revisions");
  const annotations = input.annotations.map((value,index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid frozen annotation");
    const row = value as {momentId:string;tags:ProductionTags;revision:number};
    if (Object.keys(row).sort().join() !== "momentId,revision,tags" || row.momentId !== (input.momentIds as string[])[index]
      || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > 2147483647) throw new Error("Invalid frozen annotation");
    return {momentId:row.momentId,tags:validateProductionTags(row.tags),revision:row.revision};
  });
  if (input.audience === "mystery" && selection.thinking) throw new Error("Mystery cannot select private thinking");
  return {schema:"house.production-selection",version:1,gameId:input.gameId,gameKind:input.gameKind as "influence"|"werewolf",
    audience:input.audience as ProductionExportDescriptor["audience"],sourceSnapshot:input.sourceSnapshot as Record<string,unknown>,
    momentIds:input.momentIds as string[],selection,settings:decodeProductionSettings(input.settings),copy:decodeProductionCopy(input.copy),recordings,annotations,hash:input.hash};
}
