import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  FORMAT_PRESENTATION_METADATA,
  type LaunchFormatId,
} from "@influence/engine/format-presentation-metadata";
import { FormatPresentation } from "../app/games/[slug]/components/format-presentation";
import { activeFormatIdForPresentationCursor } from "../app/games/[slug]/components/dramatic-replay-viewer";
import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
  FormatPresentationSnapshot,
} from "../app/games/[slug]/components/types";

const roster: FormatPresentationRosterPlayer[] = [
  { id: "p1", name: "Atlas With A Deliberately Long Strategic Name" },
  { id: "p2", name: "Lyra" },
  { id: "p3", name: "Echo" },
];

describe("FormatPresentation", () => {
  it("renders only the Empowered aggregate and roster-ordered named receipts", () => {
    const html = renderToString(
      <FormatPresentation
        cue={empoweredCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const text = withoutReactMarkers(html);

    expect(text).toContain("Empowered tally");
    expect(text).toContain("Atlas With A Deliberately Long Strategic Name");
    expect(text).toContain("Lyra");
    expect(text).toContain("Echo");
    expect(text.indexOf("Atlas With A Deliberately Long Strategic Name")).toBeLessThan(
      text.lastIndexOf("Lyra"),
    );
    expect(html).toContain('data-empower-receipt="p1"');
    expect(html).toContain('data-empower-receipt="p2"');
    expect(html).toContain('data-empower-receipt="p3"');
    expect(text).toContain("Revote");
    expect(text).not.toContain("Expose");
    expect(text).not.toContain("At risk");
    expect(text).not.toContain("Shield");
    expect(text).not.toContain("Power");
    expect(text).not.toContain("Council");
  });

  it("keeps both offered cards in canonical order and expands only the selected rules", () => {
    const menuHtml = renderToString(
      <FormatPresentation
        cue={menuCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const choiceHtml = renderToString(
      <FormatPresentation
        cue={selectedCue("choice_legible")}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const selectedHtml = renderToString(
      <FormatPresentation
        cue={selectedCue("rules_reveal")}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(menuHtml.indexOf("Vote Bomb")).toBeLessThan(
      menuHtml.indexOf("Safety Bounce"),
    );
    expect(menuHtml).toContain('data-format-card="vote_bomb"');
    expect(menuHtml).toContain('data-format-card="safety_bounce"');
    expect(menuHtml).not.toContain("Zero votes is safe");

    expect(choiceHtml).toContain(
      `data-format-card="safety_bounce" data-card-state="unselected" data-selection-stage="choice_legible" data-unselected-fade="deferred"`,
    );
    expect(choiceHtml).not.toContain("opacity-35");
    expect(choiceHtml).not.toContain("Zero votes is safe");
    expect(selectedHtml).toContain(
      `data-format-card="vote_bomb" data-card-state="selected" data-selection-stage="rules_reveal"`,
    );
    expect(selectedHtml).toContain(
      `data-format-card="safety_bounce" data-card-state="unselected" data-selection-stage="rules_reveal" data-unselected-fade="applied"`,
    );
    expect(selectedHtml).toContain(
      FORMAT_PRESENTATION_METADATA.vote_bomb.conciseRules,
    );
    expect(selectedHtml).not.toContain(
      FORMAT_PRESENTATION_METADATA.safety_bounce.conciseRules,
    );
    expect(selectedHtml).toContain('tabindex="0"');
  });

  it("offers Majority Elimination with catalog copy and renders highest-total scoring only", () => {
    const offer = renderToString(
      <FormatPresentation
        cue={majorityMenuCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const selection = renderToString(
      <FormatPresentation
        cue={majoritySelectedCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const resolution = renderToString(
      <FormatPresentation
        cue={majorityAggregateCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(offer).toContain('data-format-card="majority_elimination"');
    expect(offer).toContain("Majority Elimination");
    expect(selection).toContain(
      FORMAT_PRESENTATION_METADATA.majority_elimination.conciseRules,
    );
    expect(resolution).toContain("Highest total · elimination eligible");
    expect(resolution).toContain("Below the high vote");
    expect(resolution).toContain('data-aggregate-player="p2"');
    expect(resolution).toContain('data-aggregate-state="eligible"');
    expect(`${offer}${selection}${resolution}`).not.toMatch(
      /zero votes|zero-vote|\bVulnerable\b|\bPower\b|\bCouncil\b/i,
    );
  });

  it("renders Even Votes parity eligibility without Vote Bomb zero-safety copy", () => {
    const resolution = renderToString(
      <FormatPresentation
        cue={evenVotesAggregateCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(resolution).toContain("Even Votes aggregate");
    expect(resolution).toContain("Highest even total · elimination eligible");
    expect(resolution).toContain("Odd total · safe");
    expect(resolution).toContain("Even total · below danger");
    expect(resolution).not.toContain("Zero votes · safe");
    expect(resolution).not.toContain("Fewest positive");
  });

  it("renders a one-format automatic selection without a fake offered pair", () => {
    const cue = majoritySelectedCue();
    const html = renderToString(
      <FormatPresentation
        cue={{
          ...cue,
          before: snapshot({ empoweredId: "p1" }),
        }}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(html).toContain('data-format-auto-selected="majority_elimination"');
    expect(html).toContain("Majority Elimination");
    expect(html).toContain(
      FORMAT_PRESENTATION_METADATA.majority_elimination.conciseRules,
    );
    expect(html).not.toContain("offers two formats");
  });

  it("enters directly at the offered pair before selection and active label after selection", () => {
    const beforeSelection = renderToString(
      <FormatPresentation
        cue={menuCue()}
        roster={roster}
        currentStateEntry
      />,
    );
    const afterSelection = renderToString(
      <FormatPresentation
        cue={selectedCue()}
        roster={roster}
        currentStateEntry
      />,
    );
    const afterText = withoutReactMarkers(afterSelection);

    expect(beforeSelection).toContain("Vote Bomb");
    expect(beforeSelection).toContain("Safety Bounce");
    expect(beforeSelection).not.toContain('data-active-format="vote_bomb"');

    expect(afterSelection).toContain('data-active-format="vote_bomb"');
    expect(afterText).toContain("Active format");
    expect(afterText).toContain("Vote Bomb");
    expect(afterSelection).not.toContain("Zero votes is safe");
    expect(afterSelection).not.toContain("button");
  });

  it("keeps the active format visible on later canonical cues without an alternate reduced-motion tree", () => {
    const html = renderToString(
      <FormatPresentation
        cue={aggregateCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(html).toContain('data-active-format="vote_bomb"');
    expect(html).toContain('data-format-cue="format_aggregate"');
    expect(html).toContain("Zero votes · safe");
    expect(html).toContain("Fewest positive · eligible");
    expect(html).not.toContain("Zero votes is safe");
  });

  it("renders Save-or-Eliminate math and sole-vulnerable Safety Bounce explicitly", () => {
    const saveHtml = renderToString(
      <FormatPresentation
        cue={saveOrEliminateAggregateCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const soleHtml = renderToString(
      <FormatPresentation
        cue={soleVulnerableAggregateCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(saveHtml).toContain("Saves");
    expect(saveHtml).toContain("Eliminates");
    expect(saveHtml).toContain("Net");
    expect(saveHtml).toContain("Elimination eligible");
    expect(saveHtml).toContain('data-aggregate-player="p2"');
    expect(saveHtml).toContain('data-aggregate-state="eligible"');

    expect(soleHtml).toContain('data-resolution-pool="safe"');
    expect(soleHtml).toContain('data-resolution-pool="vulnerable"');
    expect(soleHtml).toContain('data-final-ballot="not_applicable"');
    expect(soleHtml).toContain("sole Vulnerable agent");
    expect(soleHtml).not.toContain("Roll call");
  });

  it("keeps the roster-ordered roll-call ledger cumulative and emphasizes the current receipt", () => {
    const html = renderToString(
      <FormatPresentation
        cue={rollCallCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(html).toContain('data-roll-call-ledger="true"');
    expect(html).toContain('data-ledger-voter="p1" data-ledger-current="false"');
    expect(html).toContain('data-ledger-voter="p2" data-ledger-current="true"');
    expect(html.indexOf('data-ledger-voter="p1"')).toBeLessThan(
      html.indexOf('data-ledger-voter="p2"'),
    );
    expect(html).toContain("Atlas With A Deliberately Long Strategic Name");
    expect(html).toContain("Lyra");
    expect(html).toContain("Echo");
    expect(html).toContain('data-ballot-polarity="eliminate"');
  });

  it("names the empowered tiebreak receipt and eliminated agent", () => {
    const tiebreak = renderToString(
      <FormatPresentation
        cue={tiebreakCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );
    const elimination = renderToString(
      <FormatPresentation
        cue={eliminationCue()}
        roster={roster}
        currentStateEntry={false}
      />,
    );

    expect(withoutReactMarkers(tiebreak)).toContain(
      "Atlas With A Deliberately Long Strategic Name breaks the tie",
    );
    expect(withoutReactMarkers(tiebreak)).toContain("Tied: Lyra · Echo");
    expect(withoutReactMarkers(elimination)).toContain("Echo is eliminated");
    expect(elimination).toContain('data-resolution-kind="clear"');
  });

  it("keeps the active label through same-round social cues and resets it for a new round", () => {
    const selected = selectedCue();
    const sameRoundSocial = {
      source: "classic" as const,
      key: "social-round-1",
      canonicalSequence: 8,
      round: 1,
      phase: "FORMAT_MINGLE" as const,
      kind: "classic_transcript" as const,
      stage: "done" as const,
      baseDurationMs: 1,
      sceneIndex: 0,
      messageIndex: 0,
    };
    const nextRoundSocial = {
      ...sameRoundSocial,
      key: "social-round-2",
      canonicalSequence: 20,
      round: 2,
      sceneIndex: 1,
    };
    const cues = [selected, sameRoundSocial, nextRoundSocial];

    expect(activeFormatIdForPresentationCursor(cues, 1, 1)).toBe("vote_bomb");
    expect(activeFormatIdForPresentationCursor(cues, 2, 2)).toBeNull();
  });
});

function snapshot(
  overrides: Partial<FormatPresentationSnapshot> = {},
): FormatPresentationSnapshot {
  return {
    round: 1,
    phase: "VOTE",
    canonicalSequence: 0,
    empoweredId: null,
    empoweredTally: null,
    offeredFormatIds: null,
    activeFormatId: null,
    safetyBounce: null,
    resolution: null,
    revealedBallots: [],
    eliminatedId: null,
    ...overrides,
  };
}

function baseCue(
  sequence: number,
  phase: FormatPresentationCue["phase"],
  before: FormatPresentationSnapshot,
  after: FormatPresentationSnapshot,
) {
  return {
    source: "format" as const,
    key: `game-1:${sequence}`,
    canonicalSequence: sequence,
    round: 1,
    phase,
    baseDurationMs: 1,
    before,
    after,
  };
}

function empoweredCue(): Extract<FormatPresentationCue, { kind: "empowered_tally" }> {
  const counts = { p1: 2, p2: 1, p3: 0 };
  return {
    ...baseCue(
      4,
      "VOTE",
      snapshot(),
      snapshot({
        canonicalSequence: 4,
        empoweredId: "p1",
        empoweredTally: counts,
      }),
    ),
    kind: "empowered_tally",
    empoweredId: "p1",
    counts,
    receipts: [
      { voterId: "p1", targetId: "p2", revoteTargetId: "p1" },
      { voterId: "p2", targetId: "p1", revoteTargetId: "p1" },
      { voterId: "p3", targetId: "p1", revoteTargetId: null },
    ],
  };
}

function menuCue(): Extract<FormatPresentationCue, { kind: "format_menu" }> {
  const offered: [LaunchFormatId, LaunchFormatId] = [
    "vote_bomb",
    "safety_bounce",
  ];
  return {
    ...baseCue(
      5,
      "FORMAT_MENU",
      snapshot({ empoweredId: "p1" }),
      snapshot({
        phase: "FORMAT_MENU",
        canonicalSequence: 5,
        empoweredId: "p1",
        offeredFormatIds: offered,
      }),
    ),
    kind: "format_menu",
    empoweredId: "p1",
    offeredFormatIds: offered,
  };
}

function majorityMenuCue(): Extract<FormatPresentationCue, { kind: "format_menu" }> {
  const offered: [LaunchFormatId, LaunchFormatId] = [
    "majority_elimination",
    "save_or_eliminate",
  ];
  return {
    ...baseCue(
      5,
      "FORMAT_MENU",
      snapshot({ empoweredId: "p1" }),
      snapshot({
        phase: "FORMAT_MENU",
        canonicalSequence: 5,
        empoweredId: "p1",
        offeredFormatIds: offered,
      }),
    ),
    kind: "format_menu",
    empoweredId: "p1",
    offeredFormatIds: offered,
  };
}

function majoritySelectedCue(): Extract<FormatPresentationCue, { kind: "format_selected" }> {
  const menu = majorityMenuCue();
  return {
    ...baseCue(
      6,
      "FORMAT_PICK",
      menu.after,
      snapshot({
        ...menu.after,
        phase: "FORMAT_PICK",
        canonicalSequence: 6,
        activeFormatId: "majority_elimination",
      }),
    ),
    kind: "format_selected",
    stage: "rules_reveal",
    empoweredId: "p1",
    formatId: "majority_elimination",
  };
}

function majorityAggregateCue(): Extract<FormatPresentationCue, { kind: "format_aggregate" }> {
  const before = resolvedBefore("majority_elimination");
  const resolution = {
    formatId: "majority_elimination" as const,
    empoweredId: "p1",
    eliminatedId: "p2",
    resolutionKind: "auto" as const,
    tiedPlayerIds: ["p2"],
    tiebreakerId: null,
    aggregate: {
      capability: "sealed_elim" as const,
      totals: { p1: 0, p2: 2, p3: 1 },
      eligiblePlayerIds: ["p1", "p2", "p3"],
    },
  };
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      before,
      { ...before, canonicalSequence: 10, resolution },
    ),
    kind: "format_aggregate",
    resolution,
    ballotPresentationStatus: "revealed",
  };
}

function evenVotesAggregateCue(): Extract<FormatPresentationCue, { kind: "format_aggregate" }> {
  const before = resolvedBefore("even_votes");
  const resolution = {
    formatId: "even_votes" as const,
    empoweredId: "p1",
    eliminatedId: "p2",
    resolutionKind: "auto" as const,
    tiedPlayerIds: ["p2"],
    tiebreakerId: null,
    aggregate: {
      capability: "sealed_elim" as const,
      totals: { p1: 0, p2: 2, p3: 1 },
      eligiblePlayerIds: ["p1", "p2"],
    },
  };
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      before,
      { ...before, canonicalSequence: 10, resolution },
    ),
    kind: "format_aggregate",
    resolution,
    ballotPresentationStatus: "revealed",
  };
}

function selectedCue(
  stage: "choice_legible" | "rules_reveal" = "rules_reveal",
): Extract<FormatPresentationCue, { kind: "format_selected" }> {
  const offered: [LaunchFormatId, LaunchFormatId] = [
    "vote_bomb",
    "safety_bounce",
  ];
  return {
    ...baseCue(
      6,
      "FORMAT_PICK",
      snapshot({
        phase: "FORMAT_MENU",
        canonicalSequence: 5,
        empoweredId: "p1",
        offeredFormatIds: offered,
      }),
      snapshot({
        phase: "FORMAT_PICK",
        canonicalSequence: 6,
        empoweredId: "p1",
        offeredFormatIds: offered,
        activeFormatId: "vote_bomb",
      }),
    ),
    kind: "format_selected",
    stage,
    empoweredId: "p1",
    formatId: "vote_bomb",
  };
}

function aggregateCue(): Extract<FormatPresentationCue, { kind: "format_aggregate" }> {
  const before = snapshot({
    phase: "FORMAT_RESOLVE",
    canonicalSequence: 9,
    empoweredId: "p1",
    offeredFormatIds: ["vote_bomb", "safety_bounce"],
    activeFormatId: "vote_bomb",
  });
  const resolution = {
    formatId: "vote_bomb" as const,
    empoweredId: "p1",
    eliminatedId: "p3",
    resolutionKind: "auto" as const,
    tiedPlayerIds: ["p3"],
    tiebreakerId: null,
    aggregate: {
      capability: "sealed_elim" as const,
      totals: { p1: 0, p2: 2, p3: 1 },
      eligiblePlayerIds: ["p2", "p3"],
    },
  };
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      before,
      { ...before, canonicalSequence: 10, resolution },
    ),
    kind: "format_aggregate",
    resolution,
    ballotPresentationStatus: "revealed",
  };
}

function saveOrEliminateAggregateCue(): Extract<
  FormatPresentationCue,
  { kind: "format_aggregate" }
> {
  const before = resolvedBefore("save_or_eliminate");
  const resolution = {
    formatId: "save_or_eliminate" as const,
    empoweredId: "p1",
    eliminatedId: "p2",
    resolutionKind: "auto" as const,
    tiedPlayerIds: ["p2"],
    tiebreakerId: null,
    aggregate: {
      capability: "sealed_polarity" as const,
      nets: { p1: 1, p2: -1, p3: 0 },
      savesReceived: { p1: 1, p2: 0, p3: 0 },
      eliminateReceived: { p1: 0, p2: 1, p3: 0 },
    },
  };
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      before,
      { ...before, canonicalSequence: 10, resolution },
    ),
    kind: "format_aggregate",
    resolution,
    ballotPresentationStatus: "revealed",
  };
}

function soleVulnerableAggregateCue(): Extract<
  FormatPresentationCue,
  { kind: "format_aggregate" }
> {
  const before = {
    ...resolvedBefore("safety_bounce"),
    safetyBounce: {
      starterId: "p1",
      currentActorId: "p3",
      safePlayerIds: ["p1", "p3"],
      vulnerablePlayerIds: ["p2"],
      benchPlayerIds: [],
    },
  };
  const resolution = {
    formatId: "safety_bounce" as const,
    empoweredId: "p1",
    eliminatedId: "p2",
    resolutionKind: "auto" as const,
    tiedPlayerIds: [],
    tiebreakerId: null,
    aggregate: {
      capability: "public_chain" as const,
      starterId: "p1",
      safePlayerIds: ["p1", "p3"],
      vulnerablePlayerIds: ["p2"],
      voteTotals: {},
    },
  };
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      before,
      { ...before, canonicalSequence: 10, resolution },
    ),
    kind: "format_aggregate",
    resolution,
    ballotPresentationStatus: "not_applicable",
  };
}

function rollCallCue(): Extract<
  FormatPresentationCue,
  { kind: "format_roll_call" }
> {
  const first = { voterId: "p1", targetId: "p2", polarity: "save" as const };
  const current = {
    voterId: "p2",
    targetId: "p3",
    polarity: "eliminate" as const,
  };
  const before = {
    ...resolvedBefore("save_or_eliminate"),
    revealedBallots: [first],
  };
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      before,
      { ...before, revealedBallots: [first, current] },
    ),
    kind: "format_roll_call",
    ballot: current,
    rollCallIndex: 1,
    rollCallCount: 3,
    pacing: "decisive",
  };
}

function tiebreakCue(): Extract<
  FormatPresentationCue,
  { kind: "format_tiebreak" }
> {
  const state = resolvedBefore("save_or_eliminate");
  return {
    ...baseCue(10, "FORMAT_RESOLVE", state, state),
    kind: "format_tiebreak",
    tiebreakerId: "p1",
    tiedPlayerIds: ["p2", "p3"],
  };
}

function eliminationCue(): Extract<
  FormatPresentationCue,
  { kind: "format_elimination" }
> {
  const state = resolvedBefore("save_or_eliminate");
  return {
    ...baseCue(
      10,
      "FORMAT_RESOLVE",
      state,
      { ...state, eliminatedId: "p3" },
    ),
    kind: "format_elimination",
    eliminatedId: "p3",
    resolutionKind: "clear",
  };
}

function resolvedBefore(
  activeFormatId: LaunchFormatId,
): FormatPresentationSnapshot {
  return snapshot({
    phase: "FORMAT_RESOLVE",
    canonicalSequence: 9,
    empoweredId: "p1",
    offeredFormatIds: activeFormatId === "save_or_eliminate"
      ? ["save_or_eliminate", "vote_bomb"]
      : ["safety_bounce", "vote_bomb"],
    activeFormatId,
  });
}

function withoutReactMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}
