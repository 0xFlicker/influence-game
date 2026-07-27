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
    expect(html).not.toContain("Zero votes is safe");
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
    eliminatedId: "p2",
    resolutionKind: "clear" as const,
    tiedPlayerIds: [],
    tiebreakerId: null,
    saveOrEliminate: null,
    voteBomb: { totals: { p1: 0, p2: 2, p3: 1 }, zeroSafePlayerIds: ["p1"] },
    safetyBounce: null,
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
  };
}

function withoutReactMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}
