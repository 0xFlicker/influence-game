import { describe, expect, it } from "bun:test";
import type { TranscriptEntry } from "../lib/api";
import {
  getHouseSummaryExtraHoldMs,
  getJuryClosingStatementsExtraHoldMs,
  getJuryOpeningStatementsExtraHoldMs,
  getJuryQuestionsExtraHoldMs,
  HOUSE_SUMMARY_EXTRA_HOLD_MS,
  JURY_CLOSING_STATEMENTS_EXTRA_HOLD_MS,
  JURY_OPENING_STATEMENTS_EXTRA_HOLD_MS,
  JURY_QUESTIONS_EXTRA_HOLD_MS,
  isFinalJuryClosingStatementMessage,
  isFinalJuryQuestionAnswerMessage,
  isFinalJuryOpeningStatementMessage,
  isHouseSummaryMessage,
} from "../app/games/[slug]/components/dramatic-timing";
import { DRAMATIC_ADVANCE_SUPPRESS_SELECTOR } from "../app/games/[slug]/components/dramatic-interaction";

function entry(overrides: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 2,
    phase: "COUNCIL",
    fromPlayerId: null,
    fromPlayerName: null,
    scope: "system",
    toPlayerIds: null,
    text: "",
    timestamp: 1,
    ...overrides,
  };
}

describe("dramatic House summary timing", () => {
  it("adds the extra hold for legacy House MC summary lines", () => {
    const summary = entry({
      text: "[House MC] The House just watched the vote reshape every alliance in the room.",
    });

    expect(isHouseSummaryMessage(summary, [summary], 0)).toBe(true);
    expect(getHouseSummaryExtraHoldMs(summary, [summary], 0)).toBe(HOUSE_SUMMARY_EXTRA_HOLD_MS);
  });

  it("adds the extra hold for final long clean House prose", () => {
    const summary = entry({
      text: "The House has drawn a clear line through the room, and the vote has left everyone with a fresh debt to explain. Mira kept her hands clean in public, but the pressure now sits with the players who made the Council look inevitable. The next round will test whether that confidence turns into protection or backlash.",
    });

    expect(isHouseSummaryMessage(summary, [summary], 0)).toBe(true);
    expect(getHouseSummaryExtraHoldMs(summary, [summary], 0)).toBe(HOUSE_SUMMARY_EXTRA_HOLD_MS);
  });

  it("does not delay short system announcements or non-final prose", () => {
    const shortAnnouncement = entry({ text: "ELIMINATED: Atlas" });
    const longProse = entry({
      id: 2,
      text: "The House has drawn a clear line through the room, and the vote has left everyone with a fresh debt to explain. Mira kept her hands clean in public, but the pressure now sits with the players who made the Council look inevitable. The next round will test whether that confidence turns into protection or backlash.",
    });
    const finalMessage = entry({ id: 3, text: "Council complete." });

    expect(getHouseSummaryExtraHoldMs(shortAnnouncement, [shortAnnouncement], 0)).toBe(0);
    expect(getHouseSummaryExtraHoldMs(longProse, [longProse, finalMessage], 0)).toBe(0);
  });

  it("does not delay unrelated long endgame system prose", () => {
    const judgmentProse = entry({
      phase: "OPENING_STATEMENTS",
      text: "The House has reached its final stage, and the room now belongs to the last two players standing. The jury has seen every promise, every betrayal, and every survival instinct that brought this table here. This ceremony is dramatic, but it is not a between-round House recap.",
    });

    expect(getHouseSummaryExtraHoldMs(judgmentProse, [judgmentProse], 0)).toBe(0);
  });
});

describe("dramatic advance suppression selector", () => {
  it("ignores actual controls without treating broad data-controls containers as blockers", () => {
    expect(DRAMATIC_ADVANCE_SUPPRESS_SELECTOR).toContain("[data-replay-controls]");
    expect(DRAMATIC_ADVANCE_SUPPRESS_SELECTOR).toContain("button");
    expect(DRAMATIC_ADVANCE_SUPPRESS_SELECTOR).not.toContain("[data-controls]");
  });
});

describe("dramatic jury opening statements timing", () => {
  it("adds the extra hold for the final opening statement", () => {
    const first = entry({
      phase: "OPENING_STATEMENTS",
      fromPlayerId: "p1",
      fromPlayerName: "Arden",
      scope: "public",
      text: "I earned my place here by reading the room before it realized it was being read.",
    });
    const final = entry({
      id: 2,
      phase: "OPENING_STATEMENTS",
      fromPlayerId: "p2",
      fromPlayerName: "Mira",
      scope: "public",
      text: "I made the promises that held when the vote got expensive, and I deserve the jury's trust.",
    });

    expect(isFinalJuryOpeningStatementMessage(final, [first, final], 1)).toBe(true);
    expect(getJuryOpeningStatementsExtraHoldMs(final, [first, final], 1)).toBe(JURY_OPENING_STATEMENTS_EXTRA_HOLD_MS);
  });

  it("does not delay earlier opening statements or system setup lines", () => {
    const setup = entry({
      phase: "OPENING_STATEMENTS",
      scope: "system",
      text: "=== JUDGMENT: OPENING STATEMENTS ===",
    });
    const first = entry({
      id: 2,
      phase: "OPENING_STATEMENTS",
      fromPlayerId: "p1",
      fromPlayerName: "Arden",
      scope: "public",
      text: "I earned my place here by reading the room before it realized it was being read.",
    });
    const final = entry({
      id: 3,
      phase: "OPENING_STATEMENTS",
      fromPlayerId: "p2",
      fromPlayerName: "Mira",
      scope: "public",
      text: "I made the promises that held when the vote got expensive, and I deserve the jury's trust.",
    });

    expect(getJuryOpeningStatementsExtraHoldMs(setup, [setup, first, final], 0)).toBe(0);
    expect(getJuryOpeningStatementsExtraHoldMs(first, [setup, first, final], 1)).toBe(0);
  });
});

describe("dramatic jury questions timing", () => {
  it("adds the extra hold for the final jury answer", () => {
    const question = entry({
      phase: "JURY_QUESTIONS",
      fromPlayerId: "juror-1",
      fromPlayerName: "Sage",
      scope: "public",
      text: "[QUESTION to Mira] Which promise cost you the most?",
    });
    const answer = entry({
      id: 2,
      phase: "JURY_QUESTIONS",
      fromPlayerId: "finalist-1",
      fromPlayerName: "Mira",
      scope: "public",
      text: "[ANSWER to Sage] The promise that cost me most was keeping Arden close after I knew he could beat me.",
    });

    expect(isFinalJuryQuestionAnswerMessage(answer, [question, answer], 1)).toBe(true);
    expect(getJuryQuestionsExtraHoldMs(answer, [question, answer], 1)).toBe(JURY_QUESTIONS_EXTRA_HOLD_MS);
  });

  it("does not delay earlier jury questions or system setup lines", () => {
    const setup = entry({
      phase: "JURY_QUESTIONS",
      scope: "system",
      text: "=== JUDGMENT: JURY QUESTIONS ===",
    });
    const question = entry({
      id: 2,
      phase: "JURY_QUESTIONS",
      fromPlayerId: "juror-1",
      fromPlayerName: "Sage",
      scope: "public",
      text: "[QUESTION to Mira] Which promise cost you the most?",
    });
    const answer = entry({
      id: 3,
      phase: "JURY_QUESTIONS",
      fromPlayerId: "finalist-1",
      fromPlayerName: "Mira",
      scope: "public",
      text: "[ANSWER to Sage] The promise that cost me most was keeping Arden close after I knew he could beat me.",
    });

    expect(getJuryQuestionsExtraHoldMs(setup, [setup, question, answer], 0)).toBe(0);
    expect(getJuryQuestionsExtraHoldMs(question, [setup, question, answer], 1)).toBe(0);
  });
});

describe("dramatic jury closing statements timing", () => {
  it("adds the extra hold for the final closing statement", () => {
    const first = entry({
      phase: "CLOSING_ARGUMENTS",
      fromPlayerId: "p1",
      fromPlayerName: "Arden",
      scope: "public",
      text: "The story of this game is not who looked safest, but who made the hard calls when everyone could see them.",
    });
    const final = entry({
      id: 2,
      phase: "CLOSING_ARGUMENTS",
      fromPlayerId: "p2",
      fromPlayerName: "Mira",
      scope: "public",
      text: "I gave the jury the clearest proof that trust can survive pressure, and that is the game I played.",
    });

    expect(isFinalJuryClosingStatementMessage(final, [first, final], 1)).toBe(true);
    expect(getJuryClosingStatementsExtraHoldMs(final, [first, final], 1)).toBe(JURY_CLOSING_STATEMENTS_EXTRA_HOLD_MS);
  });

  it("does not delay earlier closing statements or system setup lines", () => {
    const setup = entry({
      phase: "CLOSING_ARGUMENTS",
      scope: "system",
      text: "=== JUDGMENT: CLOSING ARGUMENTS ===",
    });
    const first = entry({
      id: 2,
      phase: "CLOSING_ARGUMENTS",
      fromPlayerId: "p1",
      fromPlayerName: "Arden",
      scope: "public",
      text: "The story of this game is not who looked safest, but who made the hard calls when everyone could see them.",
    });
    const final = entry({
      id: 3,
      phase: "CLOSING_ARGUMENTS",
      fromPlayerId: "p2",
      fromPlayerName: "Mira",
      scope: "public",
      text: "I gave the jury the clearest proof that trust can survive pressure, and that is the game I played.",
    });

    expect(getJuryClosingStatementsExtraHoldMs(setup, [setup, first, final], 0)).toBe(0);
    expect(getJuryClosingStatementsExtraHoldMs(first, [setup, first, final], 1)).toBe(0);
  });
});
