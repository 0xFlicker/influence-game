import type {ProductionAudience,ProductionCatalog,ProductionTags} from "@influence/engine/production-moments";
import type {WerewolfProductionThought} from "@influence/engine/production-moments/werewolf-source";
import type {InfluenceProductionThought} from "@influence/engine/production-moments/influence-source";
import type {ReplaySource,InfluenceExportGame,ReadReplayJson} from "./source";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import type {GameWatchReplayFrame,TranscriptEntry} from "../api";
import type {VisualWatchData} from "../../app/games/[slug]/components/visual-watch-model";

export interface ProductionSnapshot {
  [key:string]:unknown;
  gameId:string;gameKind:"influence"|"werewolf";audience:ProductionAudience;
  throughEventSequence:number;throughCursor?:number;publicationCutoff:string;sourceHash:string;
}
export interface ProductionAnnotation {momentId:string;tags:ProductionTags;revision:number}
interface PageHeader {
  snapshot:ProductionSnapshot;status:"completed"|"suspended";title?:string;
  catalog:ProductionCatalog;annotations:ProductionAnnotation[];
}
interface WerewolfPage extends PageHeader {
  window:WerewolfWatchWindow;provenance:{cursor:number;eventSequence:number}[];
  thoughts:WerewolfProductionThought[];nextCursor:number|null;
}
interface InfluencePage extends PageHeader {
  game:InfluenceExportGame;messages:TranscriptEntry[];frames:GameWatchReplayFrame[];visual:VisualWatchData;
  acceptedThoughts:InfluenceProductionThought[];nextSequence:number|null;nextMessageOffset:number|null;
  nextCatalogOffset:number|null;nextThoughtOffset:number|null;nextVisualOffset:number|null;
  totalFrames:number;totalMessages:number;totalMoments:number;totalThoughts:number;totalScenes:number;
}
export interface ProductionSourceInput {
  gameId:string;gameKind:"influence"|"werewolf";audience:ProductionAudience;thinking:boolean;
  snapshot?:ProductionSnapshot;refreshVisuals?:boolean;
}
export interface LoadedProductionReplay {
  snapshot:ProductionSnapshot;status:"completed"|"suspended";title?:string;source:ReplaySource;catalog:ProductionCatalog;
  provenance:{cursor:number;eventSequence:number}[];thoughts:WerewolfProductionThought[];
  acceptedThoughts:InfluenceProductionThought[];annotations:ProductionAnnotation[];
}

/** Both hosts use this bounded adapter; no browser, filesystem or credentials live here. */
export async function loadProductionReplaySource(read:ReadReplayJson,input:ProductionSourceInput):Promise<LoadedProductionReplay> {
  if (input.audience === "mystery" && input.thinking) throw new Error("Mystery cannot include private thinking");
  const root = `/api/admin/production/games/${encodeURIComponent(input.gameId)}/source`;
  const moments = new Map<string,ProductionCatalog["moments"][number]>(),annotations = new Map<string,ProductionAnnotation>();
  let snapshot = input.snapshot,status:"completed"|"suspended" = "completed",title:string|undefined;
  const header = (page:PageHeader,first:boolean) => {
    if (page.snapshot.gameId !== input.gameId || page.snapshot.gameKind !== input.gameKind || page.snapshot.audience !== input.audience
      || page.catalog.gameId !== input.gameId || page.catalog.gameKind !== input.gameKind || page.catalog.audience !== input.audience)
      throw new Error("Source does not match this editing scope");
    if (snapshot && !(input.refreshVisuals && first) && snapshot.sourceHash !== page.snapshot.sourceHash) throw new Error("Fixed source changed while loading");
    if (!/^sha256:[a-f0-9]{64}$/.test(page.snapshot.sourceHash) || !["completed","suspended"].includes(page.status)) throw new Error("Invalid production source snapshot");
    snapshot = page.snapshot;if (first) {status = page.status;title = page.title;}
    else if (status !== page.status) throw new Error("Game status changed while loading its fixed source");
    for (const moment of page.catalog.moments) {
      if (moments.has(moment.id)) throw new Error("Repeated production catalog page");
      moments.set(moment.id,moment);
    }
    page.annotations.forEach(row => annotations.set(row.momentId,row));
  };
  const query = (first:boolean) => {
    const params = new URLSearchParams({audience:input.audience,thinking:input.thinking ? "on" : "off"});
    if (snapshot) params.set("snapshot",JSON.stringify(snapshot));
    if (input.refreshVisuals && first) params.set("refreshPublished","true");
    return params;
  };
  let source:ReplaySource;
  const provenance:LoadedProductionReplay["provenance"] = [],thoughts:WerewolfProductionThought[] = [],acceptedThoughts:InfluenceProductionThought[] = [];
  if (input.gameKind === "werewolf") {
    const windows:WerewolfWatchWindow[] = [];let next = 1;
    while (true) {
      const params = query(next === 1);params.set("fromCursor",String(next));params.set("limit","64");
      const page = await read<WerewolfPage>(`${root}?${params}`);header(page,next === 1);
      if (page.window.gameId !== input.gameId || page.window.audience !== input.audience || page.window.latestCursor !== snapshot!.throughCursor
        || page.window.fromCursor !== next || page.window.moments.length !== Math.max(0,page.window.throughCursor-next+1)
        || page.window.moments.some((moment,index) => moment.cursor !== next+index)) throw new Error("Production source history has a gap");
      windows.push(page.window);provenance.push(...page.provenance);thoughts.push(...page.thoughts);
      if (page.nextCursor === null) {
        if (page.window.throughCursor !== snapshot!.throughCursor) throw new Error("Production source history is incomplete");
        break;
      }
      if (!Number.isSafeInteger(page.nextCursor) || page.nextCursor !== page.window.throughCursor+1 || page.nextCursor <= next) throw new Error("Source pagination did not advance");
      next = page.nextCursor;
    }
    source = {kind:"werewolf",title,windows,thoughts};
  } else {
    const messages:TranscriptEntry[] = [],frames:GameWatchReplayFrame[] = [],scenes:VisualWatchData["scenes"] = [];
    const bindings:Record<string,string> = {};
    let game:InfluenceExportGame|undefined,visual:VisualWatchData|undefined;
    let afterSequence = 0,offset = 0,catalogOffset = 0,thoughtOffset = 0,visualOffset = 0,first = true;
    while (true) {
      const params = query(first);
      Object.entries({afterSequence,offset,catalogOffset,thoughtOffset,visualOffset,limit:256}).forEach(([key,value]) => params.set(key,String(value)));
      const page = await read<InfluencePage>(`${root}?${params}`);header(page,first);
      if (page.frames.some((frame,index) => frame.sequence !== afterSequence+index+1)) throw new Error("Influence canonical source history has a gap");
      game = page.game;visual = page.visual;messages.push(...page.messages);frames.push(...page.frames);
      acceptedThoughts.push(...page.acceptedThoughts);scenes.push(...page.visual.scenes);
      Object.assign(bindings,page.visual.bindings);
      if ([page.nextSequence,page.nextMessageOffset,page.nextCatalogOffset,page.nextThoughtOffset,page.nextVisualOffset].every(value => value === null)) break;
      const next = [page.nextSequence ?? page.snapshot.throughEventSequence,page.nextMessageOffset ?? page.totalMessages,
        page.nextCatalogOffset ?? page.totalMoments,page.nextThoughtOffset ?? page.totalThoughts,page.nextVisualOffset ?? page.totalScenes];
      if (next.every((value,index) => value === [afterSequence,offset,catalogOffset,thoughtOffset,visualOffset][index])) throw new Error("Source pagination did not advance");
      [afterSequence,offset,catalogOffset,thoughtOffset,visualOffset] = next as [number,number,number,number,number];first = false;
    }
    if (!game || !visual) throw new Error("Missing Influence production source");
    if (frames.length !== snapshot!.throughEventSequence) throw new Error("Influence canonical source history is incomplete");
    source = {kind:"influence",game,messages,frames,visual:{...visual,scenes,bindings},thoughts:{}};
  }
  if (!snapshot) throw new Error("Missing fixed source snapshot");
  return {snapshot,status,title,source,catalog:{gameId:input.gameId,gameKind:input.gameKind,audience:input.audience,moments:[...moments.values()]},
    provenance,thoughts,acceptedThoughts,annotations:[...annotations.values()]};
}
