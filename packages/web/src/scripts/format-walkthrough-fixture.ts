import {createFormatKernelViewerScenario, type FormatKernelViewerScenarioId} from "@influence/engine/fixtures/format-kernel-viewer";
import type {GameWatchReplayFrame} from "../lib/api";
import type {ReplaySource} from "../lib/replay-export/source";

export function formatWalkthroughFixture(id: FormatKernelViewerScenarioId, followup?: "resolved" | "unfinished") {
  const fixture = createFormatKernelViewerScenario(id);
  const selection = fixture.decisions.find(event => event.type === "format.selected")!;
  const menu = fixture.decisions.find(event => event.type === "format.menu_offered")!;
  const accepted = followup === "unfinished" ? fixture.decisions.filter(event => event.sequence <= selection.sequence) : fixture.decisions;
  const next = accepted.at(-1)!.sequence + 1;
  const round = selection.round + 1;
  const decisions = followup ? [...accepted, {...menu,sequence:next,round},{...selection,sequence:next+1,round}] : accepted;
  const players = fixture.roster.map(player => ({...player, persona:"", status:"alive" as const, shielded:false,
    avatarUrl:"/avatars/personas/strategic.png"}));
  const result = accepted.find(event => event.type === "format.resolved");
  const frames: GameWatchReplayFrame[] = decisions.map(event => {
    const roster = players.map(player => ({...player,status:result?.type === "format.resolved" && event.sequence > result.sequence
      && player.id === result.payload.eliminatedId ? "eliminated" as const : "alive" as const}));
    const eliminatedPlayers = roster.filter(player => player.status === "eliminated").length;
    return {schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type, timestamp:Date.parse(event.timestamp),
      round:event.round,phase:event.phase ?? "INIT",players:roster,viewerDecisionEvent:event,
      counts:{totalPlayers:players.length,alivePlayers:players.length-eliminatedPlayers,eliminatedPlayers,unknownPlayers:0}};
  });
  const source: Extract<ReplaySource,{kind:"influence"}> = {kind:"influence",projectionVersion:9,
    game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages:[],frames,thoughts:{},
    visual:{enabled:false,status:null,portraits:{},scenes:[]}};
  return {source, selection, decisions};
}
