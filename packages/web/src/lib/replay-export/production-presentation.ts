import {assembleProductionCatalog,productionMomentKey,resolveProductionMomentIds,type ProductionCatalog,type ProductionMoment} from "@influence/engine/production-moments";
import {buildInfluenceProductionSources,type InfluenceProductionThought} from "@influence/engine/production-moments/influence-source";
import {buildWerewolfProductionSources,type WerewolfProductionThought} from "@influence/engine/production-moments/werewolf-source";
import {soloPresentationDurationMs} from "../../app/games/[slug]/components/solo-presentation-timing";
import {SILENT_BALLOT_DURATION_MS} from "../../app/games/[slug]/components/vote-presentation-timing";
import {buildExportCues,type ExportCue} from "./cues";
import {assertMysteryWindow,assertNoPrivateFields,type ReplaySource} from "./source";
import {thinkingSegment,type PresentationMoment} from "./presentation";
import {influenceProductionReference} from "./influence-production-reference";

export async function bindInfluenceProductionPresentation(input:{
  source:Extract<ReplaySource,{kind:"influence"}>;catalog:ProductionCatalog;thoughts:readonly InfluenceProductionThought[];
}):Promise<PresentationMoment[]> {
  const {source,catalog} = input;
  if (catalog.gameId !== source.game.id || catalog.gameKind !== "influence" || catalog.audience !== "public")
    throw new Error("Production catalog does not match its authorized source");
  const sources = buildInfluenceProductionSources({gameId:source.game.id,gameKernel:source.game.gameKernel ?? "classic",
    transcripts:source.messages,frames:source.frames,thoughts:input.thoughts});
  const expected = assembleProductionCatalog({gameId:source.game.id,gameKind:"influence",audience:"public",sources});
  const validated = resolveProductionMomentIds(expected,catalog.moments.map(moment => moment.id));
  if (validated.length !== expected.moments.length || validated.some((moment,index) => moment.id !== catalog.moments[index]?.id))
    throw new Error("Production catalog changed; reload its fixed source snapshot");
  const base = buildExportCues(source);
  const cuesByKey = new Map(base.filter(cue => cue.picture.kind === "influence").map(cue => [cue.timing.key,cue]));
  const transcripts = new Map(source.messages.map(message => [String(message.id),message]));
  const byMoment = new Map<string,ExportCue>();
  for (const cue of base) {
    if (cue.picture.kind === "influence-opening") continue;
    if (cue.picture.kind !== "influence") throw new Error("Cross-game production picture");
    const ref = influenceProductionReference(cue.picture.cue,
      key => {const picture = cuesByKey.get(key)?.picture;return picture?.kind === "influence" ? picture.cue : undefined;},
      presentation => {const source = cuesByKey.get(presentation.key)?.source;return source?.kind === "influence" && source.transcriptId !== undefined ? transcripts.get(String(source.transcriptId)) : undefined;});
    const id = productionMomentKey(catalog.gameId,ref.source,ref.part);
    if (byMoment.has(id)) throw new Error("Ambiguous Influence presentation source");
    byMoment.set(id,cue);
  }
  const thoughts = new Map(input.thoughts.map(thought => [`${thought.eventSequence}:${thought.actorId}`,thought]));
  const nextPictures: (ExportCue|undefined)[] = new Array(validated.length);
  let nextPicture:ExportCue|undefined;
  for (let index = validated.length-1;index >= 0;index--) {
    nextPictures[index] = nextPicture;
    nextPicture = byMoment.get(validated[index]!.id) ?? nextPicture;
  }
  let priorPicture:ExportCue|undefined;
  return validated.map((moment,index) => {
    if (moment.source.kind === "opening") return {id:moment.id, segments:base.filter(cue => cue.picture.kind === "influence-opening").map(cue => ({...cue, momentId:moment.id}))};
    if (moment.kind !== "thinking") {
      const cue = byMoment.get(moment.id);
      if (!cue) throw new Error(`Production picture is missing: ${moment.id}`);
      priorPicture = cue;
      return {id:moment.id,segments:[{...cue,momentId:moment.id}]};
    }
    const text = moment.source.kind === "influence-transcript" ? transcripts.get(moment.source.transcriptId)?.thinking
      : moment.source.kind === "influence-event" ? thoughts.get(`${moment.source.eventSequence}:${moment.actorId}`)?.thinking : null;
    // A thought's camera is permitted framing context; its neighboring response is never serialized.
    const context = nextPictures[index] ?? priorPicture;
    if (!text || !context) throw new Error(`Unavailable accepted thinking: ${moment.id}`);
    return {id:moment.id,segments:[thinkingSegment(context,moment.id,text,moment.actorId)]};
  });
}

/** Game-owned source projections have already reduced ALL accepted history.
 * This binds the shared semantic catalog to pictures without reinterpreting rules. */
export async function bindWerewolfProductionPresentation(input: {
  source: Extract<ReplaySource,{kind:"werewolf"}>;
  catalog: ProductionCatalog;
  provenance: readonly {cursor:number;eventSequence:number}[];
  thoughts: readonly WerewolfProductionThought[];
}): Promise<PresentationMoment[]> {
  const {source,catalog} = input;
  const window = source.windows[0];
  if (!window || catalog.gameKind !== "werewolf" || catalog.gameId !== window.gameId || catalog.audience !== window.audience)
    throw new Error("Production catalog does not match its authorized source");
  if (window.audience === "mystery") {
    source.windows.forEach(assertMysteryWindow);
    assertNoPrivateFields(source.thoughts); assertNoPrivateFields(input.thoughts);
  }
  const base = buildExportCues(source);
  const expected = assembleProductionCatalog({gameId:window.gameId,gameKind:"werewolf",audience:window.audience,
    sources:buildWerewolfProductionSources({gameId:window.gameId,audience:window.audience,
      moments:source.windows.flatMap(page => page.moments),provenance:input.provenance,thoughts:input.thoughts,
      opening:base.some(cue => cue.picture.kind === "werewolf-opening")})});
  const validated = resolveProductionMomentIds(expected,catalog.moments.map(moment => moment.id));
  if (validated.length !== expected.moments.length || validated.some((moment,index) => moment.id !== catalog.moments[index]?.id))
    throw new Error("Production catalog changed; reload its fixed source snapshot");
  const byCursor = new Map<number,ExportCue[]>();
  for (const cue of base) if (cue.source.kind === "werewolf" && !(cue.picture.kind === "werewolf" && cue.picture.cue.reprise)) {
    const rows = byCursor.get(cue.source.cursor) ?? [];
    rows.push(cue); byCursor.set(cue.source.cursor,rows);
  }
  const cursors = new Map(input.provenance.map(row => [row.eventSequence,row.cursor]));
  const thoughts = new Map(input.thoughts.map(thought => [thought.eventSequence,thought]));
  if (thoughts.size !== input.thoughts.length) throw new Error("Ambiguous accepted thinking source");
  const pictureCursors = [...byCursor.keys()].sort((a,b) => a-b);
  const framingAt = (cursor:number):ExportCue|undefined => {
    const exact = byCursor.get(cursor)?.[0];if (exact) return exact;
    // A legal silent action can be released at a phase-only audience cursor.
    // Select framing from the already reduced prefix; thinkingSegment strips its dialogue.
    let low = 0,high = pictureCursors.length;
    while (low < high) {const mid = Math.floor((low+high)/2);if (pictureCursors[mid]! < cursor) low = mid+1;else high = mid;}
    const nearest = pictureCursors[low] ?? pictureCursors.at(-1);
    return nearest === undefined ? undefined : byCursor.get(nearest)?.[0];
  };
  const segmentsFor = (moment: ProductionMoment): ExportCue[] => {
    if (moment.source.kind === "opening") return base.filter(cue => cue.picture.kind === "werewolf-opening");
    if (moment.source.kind === "werewolf-action") {
      if (catalog.audience !== "omniscient") throw new Error("Mystery cannot compile private thinking");
      const thought = thoughts.get(moment.source.eventSequence);
      const context = thought && framingAt(thought.cursor);
      if (!thought || !context || thought.actorId !== moment.actorId) throw new Error(`Unavailable accepted thinking: ${moment.id}`);
      return [thinkingSegment(context,moment.id,thought.thinking,thought.actorId)];
    }
    if (moment.source.kind !== "werewolf-event") throw new Error("Cross-game production picture");
    const cursor = cursors.get(moment.source.eventSequence);
    const candidates = cursor === undefined ? [] : byCursor.get(cursor) ?? [];
    const matches = candidates.filter(cue => {
      if (cue.picture.kind !== "werewolf") return false;
      const picture = cue.picture.cue;
      switch (moment.part.kind) {
        case "speech": return Boolean(cue.speech) && !picture.ballot && !picture.nightAction;
        case "ballot": return !picture.ballot?.complete && picture.ballot?.current.voterId === moment.actorId;
        case "tally": return picture.ballot?.complete === true;
        case "protect": case "investigate": case "hunt": return picture.nightAction?.kind === moment.part.kind;
        case "outcome": return !picture.nightAction && !picture.ballot && ["vote","night"].includes(picture.moment.entry.kind);
        case "pack_vote": return picture.moment.entry.kind === "pack_vote";
        case "result": return picture.moment.entry.kind === "result";
        default: return false;
      }
    });
    if (!matches.length && moment.part.kind === "ballot" && moment.part.purpose === "pack") {
      const aggregate = candidates.find(cue => cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "pack_vote");
      if (!aggregate || aggregate.picture.kind !== "werewolf" || aggregate.picture.cue.moment.entry.kind !== "pack_vote")
        throw new Error(`Unavailable pack ballot source: ${moment.id}`);
      const entry = aggregate.picture.cue.moment.entry;
      const votes = entry.result.ballots.map(ballot => ({voterId:ballot.voterId,targetId:ballot.targetId,
        choice:ballot.targetId ? "exit" as const : "abstain" as const}));
      const index = votes.findIndex(vote => vote.voterId === moment.actorId);
      if (index < 0) throw new Error(`Missing accepted pack voter: ${moment.id}`);
      const current = votes[index]!;
      const target = aggregate.picture.cue.moment.snapshot.players.find(player => player.id === current.targetId);
      const duration = current.targetId ? soloPresentationDurationMs(target?.name ?? "Unknown player") : SILENT_BALLOT_DURATION_MS;
      return [{...aggregate,speech:null,picture:{...aggregate.picture,cue:{...aggregate.picture.cue,
        transformation:undefined,key:moment.id,baseDurationMs:duration,
        ballot:{title:"Pack ballot",votes:votes.slice(0,index+1),current,total:votes.length,polarity:false}}},
        timing:{key:moment.id,kind:"ballot",baseDurationMs:duration,thinking:null,speech:null}}];
    }
    if (matches.length !== 1) throw new Error(`Production picture is missing or ambiguous: ${moment.id}`);
    return matches;
  };
  // Validate the complete binding before selecting; handcrafted private/cross-game catalogs cannot hide behind omission.
  return validated.map(moment => ({id:moment.id,segments:segmentsFor(moment).map(cue => ({...cue,momentId:moment.id}))}));
}
