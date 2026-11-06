import {expect, test} from "bun:test";
import {createFormatKernelViewerScenario} from "@influence/engine/fixtures/format-kernel-viewer";
import {assembleProductionCatalog} from "@influence/engine/production-moments";
import {buildInfluenceProductionSources} from "@influence/engine/production-moments/influence-source";
import type {GameWatchReplayFrame, TranscriptEntry} from "../api";
import {buildExportCues} from "./cues";
import {bindInfluenceProductionPresentation} from "./production-presentation";
import {compilePresentation} from "./presentation";
import {parseTimingProfile, sampleTiming} from "./timing";
import type {ReplaySource} from "./source";

test("social cuts retain the selected format without carrying omitted speech or future picks", async () => {
  const fixture = createFormatKernelViewerScenario("majority_elimination_clear");
  const players = fixture.roster.map(player => ({...player, persona:"", status:"alive" as const, shielded:false}));
  const frames:GameWatchReplayFrame[] = fixture.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,
    timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,
    counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0}}));
  const base:TranscriptEntry = {id:1,entrySequence:1,firstDurableEventSequence:60,gameId:"g",round:2,phase:"MINGLE_I",scope:"mingle",
    fromPlayerId:"atlas",speakerPlayerId:"atlas",fromPlayerName:"Atlas",toPlayerIds:["lyra"],text:"Before the selection.",timestamp:1};
  const speech:TranscriptEntry = {...base,id:2,entrySequence:2,firstDurableEventSequence:61,phase:"FORMAT_MINGLE",text:"A private plan.",thinking:"I should listen first.",timestamp:2};
  const huddle:TranscriptEntry = {...speech,id:3,entrySequence:3,scope:"huddle",dialogueKind:"huddle_speech",text:"Our huddle.",timestamp:3,
    allianceSession:{sessionId:"s",allianceId:"a",allianceName:"Partners",memberIds:["atlas","lyra"]}};
  const messages = [base,speech,huddle];
  const source:Extract<ReplaySource,{kind:"influence"}> = {kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},
    messages,frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}};
  const cues = buildExportCues(source);
  const rules = cues.find(cue => cue.picture.kind === "influence" && cue.picture.cue.source === "format" && cue.picture.cue.kind === "format_selected" && cue.picture.cue.stage === "rules_reveal")!;
  expect(rules.timing.minimumDurationMs).toBeGreaterThanOrEqual(8000);
  expect(cues.find(cue => cue.speech?.text === base.text)?.activeFormatId).toBeUndefined();
  for (const message of [speech,huddle]) expect(cues.find(cue => cue.speech?.text === message.text)?.activeFormatId).toBe("majority_elimination");
  const catalog = assembleProductionCatalog({gameId:"g",gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId:"g",gameKernel:"format",transcripts:messages,frames})});
  const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
  const rulesMoment = bound.find(moment => moment.segments.some(cue => cue.timing.key === rules.timing.key))!;
  const rulesCut = compilePresentation({source:bound,selectedIds:[rulesMoment.id],profile:parseTimingProfile({motionScale:0.1}),fps:30,assets:{},music:false});
  expect(rulesCut.timeline[0]!.endMs - rulesCut.timeline[0]!.startMs).toBeGreaterThanOrEqual(8000);
  expect(sampleTiming(rulesCut.timeline[0]!, rulesCut.timeline[0]!.endMs / 2).elapsedMs).toBeCloseTo(rules.timing.baseDurationMs / 2);
  const thought = catalog.moments.find(moment => moment.kind === "thinking" && moment.source.kind === "influence-transcript" && moment.source.transcriptId === "3")!;
  const cut = compilePresentation({source:bound,selectedIds:[thought.id],profile:parseTimingProfile({}),fps:30,assets:{},music:false});
  expect(cut.cues[0]?.activeFormatId).toBe("majority_elimination");
  expect(JSON.stringify(cut)).not.toContain(huddle.text);
  expect(JSON.stringify(cut)).not.toContain(speech.text);
});
