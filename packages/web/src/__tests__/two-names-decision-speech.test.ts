import {expect, test} from "bun:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createFormatKernelViewerScenario} from "@influence/engine/fixtures/format-kernel-viewer";
import {twoNamesDecisionSpeechAction} from "@influence/engine/influence-decision-speech";
import {compileFormatPresentationPrefix} from "../app/games/[slug]/components/format-presentation-model";
import {composeInfluencePresentation} from "../app/games/[slug]/components/influence-presentation";
import {buildStoryScenes} from "../app/games/[slug]/components/house-story";
import {buildClassicPresentationCues} from "../app/games/[slug]/components/influence-replay-cues";
import {visualWatchPresentation} from "../app/games/[slug]/components/visual-watch-model";
import {VisualPresentationFrame} from "../app/games/[slug]/components/visual-presentation";
import {influenceThinkingActor} from "../app/games/[slug]/components/influence-thinking";
import {soloPresentationDurationMs} from "../app/games/[slug]/components/solo-presentation-timing";
import type {GamePlayer, TranscriptEntry} from "../lib/api";

for (const id of ["two_names_declined", "two_names_used_tie"] as const) test(`${id}: public decisions own their speech once, before reveal, with historical absence preserved`, () => {
  const fixture = createFormatKernelViewerScenario(id);
  const players: GamePlayer[] = fixture.roster.map(player => ({...player, persona:"",status:"alive",shielded:false}));
  const compiled = compileFormatPresentationPrefix({gameId:"g",gameKernel:"format",roster:players,decisions:fixture.decisions});
  const deliveries: TranscriptEntry[] = compiled.cues.flatMap((cue,index) => {
    const action = twoNamesDecisionSpeechAction(cue.kind);
    const actorId = "overrideHolderId" in cue ? cue.overrideHolderId : "empoweredId" in cue ? cue.empoweredId : null;
    return action && actorId ? [{id:index,entrySequence:100+index,gameId:"g",round:cue.round,phase:cue.phase,scope:"public",fromPlayerId:actorId,fromPlayerName:actorId,toPlayerIds:null,text:`My public reason for ${action}.`,thinking:`My thought for ${action}.`,timestamp:index,decisionSpeech:{actorId,action}}] : [];
  });
  const scenes = buildStoryScenes(deliveries);
  const cues = composeInfluencePresentation("g", [...compiled.cues,...buildClassicPresentationCues(scenes,[],players)],players,scenes,2);
  expect(cues.filter(cue => cue.source === "classic")).toHaveLength(0);
  expect(cues.filter(cue => cue.decisionSpeechEntry)).toHaveLength(deliveries.length);
  for (const cue of cues.filter(cue => cue.decisionSpeechEntry)) {
    const fullBodies = Object.fromEntries(players.map(player => [player.id, `/cutouts/${player.id}.png`]));
    const beat = visualWatchPresentation({enabled:false,status:null,portraits:{},fullBodies,scenes:[]},cue,null,players).beat!;
    expect(beat.kind).toBe("two-names-decision");
    expect(influenceThinkingActor(cue,beat)).toBe(cue.decisionSpeechEntry!.decisionSpeech!.actorId);
    const render = (elapsedMs:number,currentStateEntry=false) => renderToStaticMarkup(createElement(VisualPresentationFrame,{beat,rooms:[],elapsedMs,currentStateEntry}));
    const before = render(1000);
    expect(before).toContain("data-two-names-decision-speech");
    expect(before).toContain('data-room-backdrop="/visual/influence/rooms-v1/council.jpg"');
    expect(before).not.toContain("solo-studio-backdrop");
    expect(before).not.toContain("data-two-names-decision-reveal");
    expect(render(soloPresentationDurationMs(cue.spokenMessage!)+1)).toContain("data-two-names-decision-reveal");
    expect(render(soloPresentationDurationMs(cue.spokenMessage!)+1)).toContain('data-two-names-art="full-body"');
    expect(render(0,true)).toContain("data-two-names-decision-reveal");
  }
  const required = compiled.cues.map(cue => {
    const speech = deliveries.find(row => row.decisionSpeech!.action === twoNamesDecisionSpeechAction(cue.kind));
    return speech ? {...cue,requiredDecisionSpeech:speech.decisionSpeech} : cue;
  });
  expect(() => composeInfluencePresentation("g",required,players,[],2)).toThrow("missing-speech");
  expect(() => composeInfluencePresentation("g",required,players,[],1)).not.toThrow();
  expect(composeInfluencePresentation("g",required,players,[],2,{speechPrefixComplete:false}).some(cue => twoNamesDecisionSpeechAction(cue.kind))).toBe(false);
  expect(() => composeInfluencePresentation("g",compiled.cues,players,buildStoryScenes([...deliveries,{...deliveries[0]!,id:999}]),2)).toThrow("ambiguous-speech");
  expect(() => composeInfluencePresentation("g",compiled.cues,players,buildStoryScenes([{...deliveries[0]!,decisionSpeech:{...deliveries[0]!.decisionSpeech!,actorId:"wrong"}}]),2)).toThrow("unconsumed-speech");
});
