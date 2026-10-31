import {GameState, Phase} from "@influence/engine";
import {projectViewerDecisionEvent} from "@influence/engine/viewer-presentation";
import {expect, test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {createFormatKernelViewerScenario, FORMAT_KERNEL_VIEWER_SCENARIO_IDS} from "@influence/engine/fixtures/format-kernel-viewer";
import {FORMAT_PRESENTATION_METADATA} from "@influence/engine/format-presentation-metadata";
import {compileFormatPresentationPrefix} from "../app/games/[slug]/components/format-presentation-model";
import {FormatPresentation} from "../app/games/[slug]/components/format-presentation";
import {assertReplayFrameOwnership, assertEventProducedPresentation, FORMAT_EVENT_PRESENTATION, VIEWER_EVENT_OWNERS} from "../app/games/[slug]/components/presentation-ownership";
import type {FormatPresentationCue} from "../app/games/[slug]/components/types";

// Adding a cue requires an executable fixture, not just a renderer label.
const REQUIRED_FORMAT_CUES = {
  empowered_tally:true, empowered_tie:true, format_menu:true, format_selected:true,
  safety_bounce_started:true, safety_bounce_pointer:true,
  two_names_empowered_intro:true, two_names_initial_names:true, two_names_override_draw:true,
  two_names_mingle_complete:true, two_names_override_declined:true, two_names_override_removed:true,
  two_names_replacement:true, two_names_plea:true,
  format_aggregate:true, format_roll_call:true, format_tiebreak:true, format_deciding_vote:true, format_elimination:true,
} satisfies Record<FormatPresentationCue["kind"], true>;

test("THOU SHALT NOT BREAK AN OLD GAME: every format prefix renders under historical and current roots", () => {
  const seen = new Set<string>();
  for (const id of FORMAT_KERNEL_VIEWER_SCENARIO_IDS) {
    const fixture = createFormatKernelViewerScenario(id);
    if (fixture.expected.status === "malformed") continue;
    for (const revision of [undefined, 1, 2, 3]) {
      for (let length = 1; length <= fixture.decisions.length; length++) {
        const result = compileFormatPresentationPrefix({gameId:"coverage", gameKernel:"format", gameSchemaVersion:revision,
          roster:fixture.roster, formatManifest:Object.keys(FORMAT_PRESENTATION_METADATA) as Array<keyof typeof FORMAT_PRESENTATION_METADATA>,
          decisions:fixture.decisions.slice(0,length)});
        expect(result.diagnostic).toBeNull();
        for (const cue of result.cues) {
          seen.add(cue.kind);
          const html = renderToStaticMarkup(<FormatPresentation cue={cue} roster={fixture.roster} currentStateEntry={false}/>);
          expect(html.length).toBeGreaterThan(0);
          expect(html).not.toContain("solo-studio-backdrop");
        }
      }
    }
  }
  const roster = ["a","b","c","d"].map(id=>({id,name:id}));
  const state = new GameState(roster);
  state.startRound();
  state.recordPhaseEntered(Phase.VOTE);
  state.recordVote("a","b"); state.recordVote("b","a");
  state.recordVote("c","a"); state.recordVote("d","b");
  state.tallyEmpowerVotes();
  state.clearEmpowerVote("c"); state.clearEmpowerVote("d");
  state.recordEmpowerReVote("c","a"); state.recordEmpowerReVote("d","b");
  state.setEmpowered("a","wheel");
  const decisions = state.getCanonicalEvents().flatMap(event => {
    const decision = projectViewerDecisionEvent(event);
    return decision ? [decision] : [];
  });
  for (const revision of [undefined,1,2,3]) {
    const result = compileFormatPresentationPrefix({gameId:"empower",gameKernel:"format",gameSchemaVersion:revision,roster,decisions});
    expect(result.diagnostic).toBeNull();
    for (const cue of result.cues) {
      seen.add(cue.kind);
      expect(renderToStaticMarkup(<FormatPresentation cue={cue} roster={roster} currentStateEntry={false}/>).length).toBeGreaterThan(0);
    }
  }
  expect([...seen].sort()).toEqual(Object.keys(REQUIRED_FORMAT_CUES).sort());
});

test("a registered event whose renderer pipeline drops a required cue fails for new roots only", () => {
  expect(Object.keys(FORMAT_EVENT_PRESENTATION).sort()).toEqual(Object.keys(VIEWER_EVENT_OWNERS).sort());
  const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
  const event = fixture.decisions.find(event=>event.type === "format.safety_bounce_pointer")!;
  expect(() => assertEventProducedPresentation(event, [], 3)).toThrow("missing-rendered-cue");
  for (const revision of [undefined, 1, 2]) expect(() => assertEventProducedPresentation(event, [], revision)).not.toThrow();
});


test("invalid format presentation stops v3 playback while historical diagnostics stay readable", () => {
  const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
  const decisions = fixture.decisions.map(event => event.type === "format.selected"
    ? {...event,payload:{...event.payload,formatId:"unimplemented-format"}} : event) as typeof fixture.decisions;
  const compile = (gameSchemaVersion: number) => compileFormatPresentationPrefix({
    gameId:"unsupported",gameKernel:"format",gameSchemaVersion,roster:fixture.roster,decisions,
  });
  expect(() => compile(3)).toThrow("invalid-presentation");
  expect(compile(1).status).toBe("incomplete");
  expect(compile(2).status).toBe("incomplete");
});


test("unknown phases stop new playback without changing historical frame tolerance", () => {
  const frame = {schemaVersion:3,sequence:7,eventType:"round.started",phase:"FUTURE_PHASE"} as unknown as import("../lib/api").GameWatchReplayFrame;
  expect(() => assertReplayFrameOwnership([frame],3)).toThrow("unknown-phase");
  for (const revision of [undefined,1,2]) expect(() => assertReplayFrameOwnership([frame],revision)).not.toThrow();
});
