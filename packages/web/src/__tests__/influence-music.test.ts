import {expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {influenceMusic, influenceOpeningAudio, INFLUENCE_MUSIC} from "../app/games/[slug]/components/influence-music";
import {influenceOpening} from "../app/games/[slug]/components/influence-opening";
import {compileFormatPresentationPrefix} from "../app/games/[slug]/components/format-presentation-model";
import {createMajorityEliminationTieViewerDecisions, FORMAT_KERNEL_VIEWER_GAME_ID, FORMAT_KERNEL_VIEWER_ROSTER} from "@influence/engine/fixtures/format-kernel-viewer";
import type {ClassicPresentationCue, EndgamePresentationCue} from "../app/games/[slug]/components/types";
const speech: ClassicPresentationCue = {source:"classic", kind:"classic_transcript", key:"speech", canonicalSequence:1, round:1, phase:"MINGLE", stage:"done", sceneIndex:0, messageIndex:0, baseDurationMs:4000};

test("phase score stays continuous across speakers and uses only presented facts", () => {
  expect(influenceMusic("g", speech)?.title).toBe("Good Company");
  expect(influenceMusic("g", {...speech, key:"other", messageIndex:2, canonicalSequence:9})).toEqual(influenceMusic("g", speech));
  expect(influenceMusic("other-game", speech)?.key).not.toBe(influenceMusic("g", speech)?.key);
  expect(influenceMusic("g", {...speech, round:2})?.key).not.toBe(influenceMusic("g", speech)?.key);
  for (const phase of ["FORMAT_MENU", "FORMAT_PICK", "POWER"] as const) expect(influenceMusic("g", {...speech, phase})?.title).toBe("Terms and Conditions");
  for (const phase of ["PLEA", "VOTE", "COUNCIL", "JURY_VOTE"] as const) expect(influenceMusic("g", {...speech, phase})?.title).toBe("Names on the Table");
  for (const phase of ["DIARY_ROOM", "RETROSPECTIVE"] as const) expect(influenceMusic("g", {...speech, phase})?.title).toBe("The Empty Chair");
  expect(influenceMusic("g", speech, {presentationPurpose:"farewell", scope:"public"})?.title).toBe("The Empty Chair");
  expect(influenceMusic("g", speech, {scope:"diary"})?.title).toBe("The Empty Chair");
  expect(influenceMusic("g", {...speech, phase:"END"})).toBeNull();
  expect(influenceMusic("g", null)).toBeNull();
});

test("canonical format ballots, tiebreaks and exits override the broad format phase", () => {
  const {cues} = compileFormatPresentationPrefix({gameId:FORMAT_KERNEL_VIEWER_GAME_ID, gameKernel:"format", roster:FORMAT_KERNEL_VIEWER_ROSTER, decisions:createMajorityEliminationTieViewerDecisions()});
  for (const kind of ["format_menu", "format_selected", "format_roll_call", "format_tiebreak", "format_elimination"] as const) {
    const cue = cues.find(c => c.kind === kind);
    expect(cue).toBeDefined();
    expect(influenceMusic("g", cue!)?.title).toBe(kind === "format_elimination" ? "The Empty Chair" : kind === "format_menu" || kind === "format_selected" ? "Terms and Conditions" : "Names on the Table");
  }
});

test("winner music requires a visible canonical result and restarts after retrospective completion", () => {
  const winner: EndgamePresentationCue = {source:"endgame", kind:"endgame_winner", key:"winner", phase:"END", round:5, canonicalSequence:50, playerId:"a", baseDurationMs:4000};
  const section = influenceMusic("g", winner)!;
  expect(section.title).toBe("The Last Word"); expect(section.repeat).toBe(false); expect(section.continueAtEnd).toBe(true);
  expect(influenceMusic("g", {...speech, phase:"RETROSPECTIVE"})?.title).toBe("The Empty Chair");
  expect(influenceMusic("g", {...winner, phase:"RETROSPECTIVE", canonicalSequence:80})?.key).not.toBe(section.key);
  expect(influenceMusic("g", {...winner, kind:"endgame_ballot"})?.title).toBe("Names on the Table");
  expect(influenceMusic("g", {...winner, kind:"endgame_elimination"})?.title).toBe("The Empty Chair");
});

test("intro uses one unbroken source with the first cast at 20 seconds and a final fade", () => {
  const cues = influenceOpening("g", [{id:"a",name:"A"}]);
  const first = cues[0]!, title = cues[1]!, cast = cues[2]!, last = cues.at(-1)!;
  expect(influenceOpeningAudio(first, 0)[0]?.gain).toBe(0);
  expect(influenceOpeningAudio(first, first.baseDurationMs)).toEqual(influenceOpeningAudio(title, 0));
  expect(influenceOpeningAudio(cast, 0)[0]).toMatchObject({time:20, gain:1, src:INFLUENCE_MUSIC.opening.src});
  expect(influenceOpeningAudio(last, last.baseDurationMs - 1000)[0]?.gain).toBe(.5);
  expect(influenceOpeningAudio(last, last.baseDurationMs)[0]?.gain).toBe(0);
  expect(influenceMusic("g", cast)).toBeNull(); expect(influenceOpeningAudio(null, 0)).toEqual([]);
  for (const track of Object.values(INFLUENCE_MUSIC)) expect(existsSync(new URL(`../../public${track.src}`, import.meta.url))).toBe(true);
});
