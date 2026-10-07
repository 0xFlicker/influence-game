import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createFormatKernelViewerScenario } from "@influence/engine/fixtures/format-kernel-viewer";
import { Phase } from "@influence/engine";
import type { GamePlayer, ViewerDecisionEvent } from "../lib/api";
import { compileFormatPresentationPrefix } from "../app/games/[slug]/components/format-presentation-model";
import { paceVisualBallots } from "../app/games/[slug]/components/visual-watch-model";
import { findCueForAdjacentScene } from "../app/games/[slug]/components/dramatic-replay-viewer";
import { voteLedgerForCue, voteLedgerRows } from "../app/games/[slug]/components/vote-ledger-model";
import { VoteLedger, VotePresentation } from "../app/games/[slug]/components/vote-presentation";
import {NomineeSelection, type NomineeSelectionBeat} from "../app/games/[slug]/components/nominee-selection";
import { votePresentationTiming } from "../app/games/[slug]/components/vote-presentation-timing";
import { soloPresentationDurationMs, SOLO_EXIT_MS, SOLO_READ_START_MS } from "../app/games/[slug]/components/solo-presentation-timing";

function fixture(scenarioId: "save_or_eliminate_clear" | "two_names_declined" = "save_or_eliminate_clear") {
  const scenario = createFormatKernelViewerScenario(scenarioId);
  const players: GamePlayer[] = scenario.roster.map(player => ({ ...player, persona: "diplomat", status: "alive", shielded: false }));
  const counts = Object.fromEntries(players.map(player => [player.id, 0]));
  const votes: ViewerDecisionEvent[] = players.map((player, index) => {
    const target = player.id === "atlas" ? "lyra" : "atlas";
    counts[target]! += 1;
    return { type: "vote.cast", phase: Phase.VOTE, sequence: index + 1, round: 1, timestamp: "2026-09-26T00:00:00Z", payload: { voterId: player.id, empowerTarget: target } };
  });
  votes.push({ type: "vote.empower_tally_resolved", phase: Phase.VOTE, sequence: votes.length + 1, round: 1, timestamp: "2026-09-26T00:00:00Z",
    payload: { counts, empowered: "atlas", tied: null, method: "plurality", cumulativeEmpowerVotes: counts } });
  const compiled = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: players,
    decisions: [...votes, ...scenario.decisions.map(event => ({ ...event, sequence: event.sequence + votes.length }))],
    formatManifest: ["two_names", "vote_bomb", "save_or_eliminate"] });
  expect(compiled.diagnostic).toBeNull();
  return { players, cues: paceVisualBallots(compiled.cues, players) };
}

test("format ledger exposes only the current prefix, and rewinding removes future receipts and totals", () => {
  const { cues } = fixture();
  const start = cues.findIndex(cue => cue.source === "format" && cue.kind === "format_roll_call");
  const first = voteLedgerForCue(cues, start)!;
  const third = voteLedgerForCue(cues, start + 2)!;
  expect(first.votes).toHaveLength(1);
  expect(third.votes).toHaveLength(3);
  expect(voteLedgerRows(first.votes).reduce((sum, row) => sum + row.votes.length, 0)).toBe(1);
  expect(voteLedgerForCue(cues, start)).toEqual(first);
  expect(voteLedgerForCue(cues, start + first.total)).toMatchObject({complete:true, total:first.total});
  expect(voteLedgerForCue(cues, start + first.total + 1)).toBeNull();
  expect(voteLedgerRows([{ voterId: "a", targetId: "b", choice: "save" }, { voterId: "c", targetId: "b", choice: "exit" }]))
    .toMatchObject([{ targetId: "b", saves: 1, exits: 1 }]);
});

test("Empower receipts accumulate before its result without exposing the tally's remaining mappings", () => {
  const { cues } = fixture("two_names_declined");
  const start = cues.findIndex(cue => cue.source === "format" && cue.visualBallot);
  const first = voteLedgerForCue(cues, start)!;
  expect(first.title).toBe("Empower vote");
  expect(first.votes).toHaveLength(1);
  const last = voteLedgerForCue(cues, start + first.total - 1)!;
  expect(last.votes).toHaveLength(first.total);
  expect(voteLedgerForCue(cues, start)).toEqual(first);
});

test("scene Prev/Next skips the entire roll call while every ballot remains in the cue sequence", () => {
  const { cues } = fixture("two_names_declined");
  for (const first of [cues.findIndex(cue => cue.source === "format" && cue.visualBallot), cues.findIndex(cue => cue.source === "format" && cue.kind === "format_roll_call")]) {
    const count = voteLedgerForCue(cues, first)!.total;
    expect(findCueForAdjacentScene(cues, first, 1)).toBe(first + count + 1);
    expect(findCueForAdjacentScene(cues, first + count - 1, 1)).toBe(first + count + 1);
    expect(findCueForAdjacentScene(cues, first + count + 1, -1)).toBe(first);
    expect(cues.slice(first, first + count)).toHaveLength(count);
  }
});

test("a ballot joins the ledger with its spoken reveal, then collection follows held director time", () => {
  const { players, cues } = fixture();
  const start = cues.findIndex(cue => cue.source === "format" && cue.kind === "format_roll_call");
  const ledger = voteLedgerForCue(cues, start + 1)!;
  const player = players.find(player => player.id === ledger.current.voterId)!;
  const target = players.find(player => player.id === ledger.current.targetId)!;
  const beat = { kind: "portrait" as const, purpose: "Ballot" as const, player, speech: { id: "ballot", playerId: player.id, speaker: player.name, text: target.name } };
  const before = renderToString(<VotePresentation beat={beat} ledger={ledger} roster={players} elapsedMs={SOLO_READ_START_MS - 1} />);
  expect(before).not.toContain(`data-ledger-voter="${player.id}"`);
  const after = renderToString(<VotePresentation beat={beat} ledger={ledger} roster={players} elapsedMs={SOLO_READ_START_MS} />);
  expect(after).toContain(`data-ledger-voter="${player.id}"`);
  const duration = soloPresentationDurationMs(target.name);
  expect(votePresentationTiming(duration - SOLO_EXIT_MS, duration).progress).toBe(0);
  const held = votePresentationTiming(duration - 375, duration);
  expect(held.progress).toBeCloseTo(.5);
  expect(votePresentationTiming(duration - 375, duration)).toEqual(held);
  expect(votePresentationTiming(duration, duration).progress).toBe(1);
  expect(votePresentationTiming(duration - 375, duration, true).progress).toBe(1);
});

test("Hear more and unavailable receipts stay distinct and never become speech", () => {
  const player = {id:"a", name:"Ada", persona:"observer"};
  const votes = [{voterId:"a",targetId:null,choice:"abstain" as const},{voterId:"b",targetId:null,choice:"unavailable" as const}];
  const html = renderToString(<VotePresentation beat={{kind:"portrait", purpose:"Ballot", player,
    speech:{id:"silent",playerId:"a",speaker:"Ada",text:""}}}
    ledger={{title:"Day vote",votes,current:votes[1]!,total:2,polarity:false}} roster={[player,{id:"b",name:"Ben"}]}
    silent elapsedMs={1800} />);
  expect(html).toContain("Hear more");
  expect(html).toContain("Unavailable");
  expect(html).not.toContain("data-speech-bubble");
  expect(voteLedgerRows(votes)).toHaveLength(2);
});


test("eligible zero-vote candidates stay visible without inventing receipts", () => {
  const html = renderToString(<VoteLedger title="Even Votes" votes={[{voterId:"a",targetId:"b",choice:"exit"}]} total={1}
    roster={[{id:"a",name:"Ada"},{id:"b",name:"Ben"}]} eligibility={{ids:["a"],label:"Highest even count"}} />);
  expect(html).toContain('data-vote-target="a" data-vote-eligible="true"');
  expect(html).toContain('data-running-total="a" class="max-w-full shrink-0 break-words text-amber-100">0');
  expect((html.match(/data-ledger-voter=/g) ?? []).length).toBe(1);
});


test("nominee selection uses elapsed playback time, supports rewind and reduced motion without body art", () => {
  const player: GamePlayer = {id:"a",name:"Ada",persona:"observer",status:"alive",shielded:false};
  const beat: NomineeSelectionBeat = {kind:"nominee-selection",chooser:player,nominees:[player,{...player,id:"b",name:"Ben"}],selectedId:"b"};
  const render = (elapsedMs:number,reducedMotion=false) => renderToString(<NomineeSelection beat={beat} elapsedMs={elapsedMs} reducedMotion={reducedMotion} />);
  expect(render(0)).not.toContain('data-selected="true"');
  expect(render(700)).toContain('data-selected="true" data-eliminated="false"');
  expect(render(2000)).toContain('data-selected="true" data-eliminated="true"');
  expect(render(0)).not.toContain('data-selected="true"');
  expect(render(0,true)).toContain('data-selected="true" data-eliminated="true"');
  expect(renderToString(<NomineeSelection beat={{...beat,selectedId:null}} elapsedMs={9000} />)).not.toContain('data-selected="true"');
});
