import {expect, test} from "bun:test";
import {createFormatKernelViewerScenario, FORMAT_KERNEL_VIEWER_SCENARIO_IDS} from "@influence/engine/fixtures/format-kernel-viewer";
import {compileFormatPresentationPrefix} from "../app/games/[slug]/components/format-presentation-model";
import {buildClassicPresentationCues, compileReplayFrameLookup} from "../app/games/[slug]/components/influence-replay-cues";
import {buildStoryScenes} from "../app/games/[slug]/components/house-story";
import {compileSafetyBounceLobbyLookup} from "../app/games/[slug]/components/safety-bounce-scene-model";
import {paceVisualBallots} from "../app/games/[slug]/components/visual-watch-model";
import {compileVoteLedgers, voteSceneIdentity, type RevealedVote} from "../app/games/[slug]/components/vote-ledger-model";
import type {PresentationCue} from "../app/games/[slug]/components/types";
import type {GameWatchReplayFrame, TranscriptEntry} from "../lib/api";
import {buildExportCues} from "../lib/replay-export/cues";

function receipt(cue: PresentationCue): RevealedVote | null {
  if (cue.source === "format" && cue.visualBallot) return {voterId:cue.visualBallot.voterId,targetId:cue.visualBallot.targetId,choice:"empower"};
  if (cue.source === "format" && cue.kind === "format_roll_call") return {voterId:cue.ballot.voterId,targetId:cue.ballot.targetId,
    choice:cue.ballot.targetId === null ? "forfeit" : cue.ballot.polarity === "save" ? "save" : "exit"};
  if (cue.source === "endgame" && cue.ballot) return {voterId:cue.ballot.voterId,targetId:cue.ballot.targetId,choice:cue.ballot.purpose === "winner" ? "winner" : "exit"};
  return null;
}

for (const id of FORMAT_KERNEL_VIEWER_SCENARIO_IDS.filter(id => !id.startsWith("malformed_"))) {
  test(`indexed vote receipts match the prior prefix scan during arbitrary seeks: ${id}`, () => {
    const scenario = createFormatKernelViewerScenario(id);
    const compilation = compileFormatPresentationPrefix({gameId:"g",gameKernel:"format",roster:scenario.roster,decisions:scenario.decisions});
    expect(compilation.diagnostic).toBeNull();
    const players = scenario.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false}));
    const cues = paceVisualBallots(compilation.cues,players);
    const ledgers = compileVoteLedgers(cues);
    const order = [...cues.keys(), ...cues.keys()].sort((a,b) => (a * 17 % cues.length) - (b * 17 % cues.length));
    for (const cursor of order) {
      const cue = cues[cursor]!, group = voteSceneIdentity(cue), current = receipt(cue);
      if (!group || !current) {
        expect(ledgers[cursor]).toBeNull();
        continue;
      }
      const expected = cues.slice(0,cursor+1).filter(entry => !entry.voteSummary && voteSceneIdentity(entry) === group)
        .flatMap(entry => {const vote=receipt(entry); return vote ? [vote] : [];});
      const total = cue.source === "format" && cue.kind === "format_roll_call" ? cue.rollCallCount
        : cues.filter(entry => !entry.voteSummary && voteSceneIdentity(entry) === group).length;
      expect(ledgers[cursor]).toMatchObject({current,total,votes:expected,complete:cue.voteSummary});
      expect(compileVoteLedgers(cues)[cursor]).toEqual(ledgers[cursor]);
    }
  });
}

function frame(sequence:number): GameWatchReplayFrame {
  return {schemaVersion:3,gameId:"g",slug:"g",sequence,timestamp:sequence,eventType:"game.started",round:1,phase:"LOBBY",players:[],
    counts:{totalPlayers:0,alivePlayers:0,eliminatedPlayers:0,unknownPlayers:0}};
}

test("indexed canonical frame lookup preserves findLast precedence without future state", () => {
  const frames = [frame(4),frame(1),frame(3),frame(3)];
  const lookup = compileReplayFrameLookup(frames);
  for (const sequence of [4,0,2,3,null,1,Infinity,NaN,3,0]) {
    expect(lookup(sequence)).toBe(frames.findLast(current => sequence !== null && current.sequence <= sequence));
  }
  expect(compileReplayFrameLookup([])(10)).toBeUndefined();
});

test("indexed lobby binding keeps source-order ties, rounds and exact revealed prefix", () => {
  const row = (id:number,entrySequence:number|undefined,sequence:number,round=1):TranscriptEntry => ({id,entrySequence,firstDurableEventSequence:sequence,
    gameId:"g",round,phase:"LOBBY",scope:"public",fromPlayerId:"a",fromPlayerName:"A",toPlayerIds:null,text:`row ${id}`,timestamp:id});
  const scenes = buildStoryScenes([row(1,10,9),row(2,10,2),row(3,5,1),row(4,undefined,3),row(5,99,1,2)]);
  const cues = buildClassicPresentationCues(scenes,[]);
  const lookup = compileSafetyBounceLobbyLookup(cues,scenes);
  for (const sequence of [9,1,2,0,8,3,9,2]) {
    const expected = cues.filter(cue => cue.round === 1 && cue.phase === "LOBBY" && cue.canonicalSequence !== null && cue.canonicalSequence <= sequence)
      .map(cue => scenes[cue.sceneIndex]!.messages[cue.messageIndex]!).filter(message => message.entrySequence !== undefined)
      .toSorted((a,b) => b.entrySequence! - a.entrySequence!)[0];
    expect(lookup(1,sequence)).toEqual(expected ? [expected] : []);
  }
  expect(lookup(2,1)[0]?.id).toBe(5);
  expect(lookup(3,99)).toEqual([]);
});

test("a fixed accepted empty prefix produces no visual cues", () => {
  expect(buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"suspended",gameKernel:"classic",players:[]},messages:[],frames:[],thoughts:{},
    visual:{enabled:false,status:null,portraits:{},scenes:[],publicationSnapshot:{}}})).toEqual([]);
});
