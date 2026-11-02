import {expect, test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {createFormatKernelViewerScenario} from "@influence/engine/fixtures/format-kernel-viewer";
import {completedCurrentWerewolfFixture, completedWerewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfProductionWatch} from "@influence/engine/werewolf/watch";
import {buildExportCues} from "./cues";
import {thinkingSegment, compilePresentation} from "./presentation";
import {parseTimingProfile} from "./timing";
import type {GameWatchReplayFrame} from "../api";
import {SafetyChain} from "../../app/games/[slug]/components/safety-chain";
import {SceneThinkingProvider} from "../../components/watch/watch-thinking";
import {WerewolfContentFrame, WerewolfHouseLayout} from "../../components/games/werewolf/werewolf-watch-stage";

test("a thought-only Safety Bounce cut retains the pre-choice cast and pools without the omitted response", () => {
  const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
  const players = fixture.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false}));
  const frames:GameWatchReplayFrame[] = fixture.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,
    counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0}}));
  const cues = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages:[],frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}});
  const pointers = cues.filter(cue => cue.picture.kind === "influence" && cue.picture.beat?.kind === "safety-chain" && cue.picture.beat.cue.kind === "safety_bounce_pointer");
  expect(pointers.length).toBeGreaterThan(1);
  for (const cue of pointers) {
    if (cue.picture.kind !== "influence" || cue.picture.beat?.kind !== "safety-chain" || cue.picture.beat.cue.kind !== "safety_bounce_pointer") throw new Error("Expected pointer");
    const beat = cue.picture.beat;
    const actorId = cue.picture.beat.cue.actorId;
    const thought = thinkingSegment(cue,"thought","I need to keep my commitment.",actorId);
    if (thought.picture.kind !== "thinking" || !thought.picture.chain) throw new Error("Missing chain framing");
    expect(thought.picture.chain.board).toEqual(beat.cue.before.safetyBounce!);
    expect(thought.picture.chain.roster.map(player => player.id)).toEqual(players.map(player => player.id));
    expect(thought.picture.chain).not.toHaveProperty("cue");
    expect(thought.picture.chain).not.toHaveProperty("speech");
    expect(thought.picture.chain).not.toHaveProperty("targetId");
    expect(thought.picture.chain).not.toHaveProperty("after");
    const compiled = compilePresentation({source:[{id:"thought",segments:[thought]},{id:"response",segments:[cue]}],selectedIds:["thought"],profile:parseTimingProfile(),fps:30,assets:{},music:false});
    expect(compiled.cues).toHaveLength(1);
    expect(compiled.cues[0]!.speech).toBeNull();
    expect(compiled.audio.clips).toEqual([]);
    const html = renderToStaticMarkup(<SceneThinkingProvider thought={{text:"I need to keep my commitment.",speaker:actorId,elapsedMs:500,durationMs:3000,opacity:1,focus:1}}><SafetyChain beat={thought.picture.chain} elapsedMs={650}/></SceneThinkingProvider>);
    expect(html).toContain("data-safety-chain");
    expect(html).toContain("Safe · ");
    expect(html).toContain("Vulnerable · ");
    expect(html).not.toContain("data-accepted-target");
    expect(html).not.toContain(" picks ");
  }
});

test("Werewolf export results reserve one House caption and use compact cast layouts for both audiences", async () => {
  const histories = [await completedCurrentWerewolfFixture("export-results-parity",11),await completedWerewolfResultsFixture("village","export-win-parity")];
  for (const events of histories) for (const audience of ["mystery","omniscient"] as const) {
    const projected = projectWerewolfProductionWatch(events,audience);
    const cues = buildExportCues({kind:"werewolf",windows:[{...projected,audience,status:"completed",slug:"parity",publicationCutoff:"now",media:{}}],thoughts:[]});
    let checked = 0;
    for (const item of cues) {
      if (item.picture.kind !== "werewolf") continue;
      const {cue} = item.picture;
      if (!cue.reprise && (cue.ballot || cue.nightAction || !["night","vote","result"].includes(cue.moment.entry.kind))) continue;
      const html = renderToStaticMarkup(<WerewolfHouseLayout cue={cue} elapsed={6000} logoUrl="/frozen-logo.png"><WerewolfContentFrame compactResults hideHouseCaption cue={cue} scene={null} elapsed={6000} reduced/></WerewolfHouseLayout>);
      expect(html).not.toContain("data-house-narration");
      if (cue.reprise) {
        expect(html).toContain("data-werewolf-ending");
        expect(html).not.toContain("How the game unfolded");
        expect(html).not.toContain("data-house-message");
        for (const player of cue.moment.snapshot.players) expect(html).toContain(player.name);
      } else {
        expect(html.match(/data-house-message="true"/g)).toHaveLength(1);
        expect(html).toContain("/frozen-logo.png");
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  }
});
