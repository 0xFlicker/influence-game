import { describe, it, expect } from "bun:test";
import {
  phaseToRoomType,
  phaseColor,
  ENDGAME_PHASES,
  PHASE_LABELS,
  DRAMATIC_PHASES,
  CHAT_FEED_PHASES,
} from "../app/games/[slug]/components/constants";
import type { PhaseKey } from "../lib/api";

describe("phaseToRoomType", () => {
  it("maps lobby phases to 'lobby'", () => {
    expect(phaseToRoomType("INTRODUCTION")).toBe("lobby");
    expect(phaseToRoomType("LOBBY")).toBe("lobby");
    expect(phaseToRoomType("RUMOR")).toBe("lobby");
  });

  it("maps whisper to 'private_rooms'", () => {
    expect(phaseToRoomType("WHISPER")).toBe("private_rooms");
  });

  it("maps vote/power/reveal/council to 'tribunal'", () => {
    expect(phaseToRoomType("VOTE")).toBe("tribunal");
    expect(phaseToRoomType("POWER")).toBe("tribunal");
    expect(phaseToRoomType("REVEAL")).toBe("tribunal");
    expect(phaseToRoomType("COUNCIL")).toBe("tribunal");
  });

  it("maps diary room to 'diary'", () => {
    expect(phaseToRoomType("DIARY_ROOM")).toBe("diary");
  });

  it("maps endgame phases to 'endgame'", () => {
    expect(phaseToRoomType("PLEA")).toBe("endgame");
    expect(phaseToRoomType("JURY_VOTE")).toBe("endgame");
    expect(phaseToRoomType("END")).toBe("endgame");
  });

  it("defaults to 'lobby' for unmapped phases", () => {
    expect(phaseToRoomType("INIT")).toBe("lobby");
  });
});

describe("phaseColor", () => {
  it("returns 'text-phase' for any phase", () => {
    expect(phaseColor("LOBBY")).toBe("text-phase");
    expect(phaseColor("VOTE")).toBe("text-phase");
  });
});

describe("ENDGAME_PHASES", () => {
  it("contains all endgame phases", () => {
    const expected: PhaseKey[] = [
      "PLEA", "ACCUSATION", "DEFENSE", "OPENING_STATEMENTS",
      "JURY_QUESTIONS", "CLOSING_ARGUMENTS", "JURY_VOTE", "END",
    ];
    for (const phase of expected) {
      expect(ENDGAME_PHASES.has(phase)).toBe(true);
    }
  });

  it("does not contain non-endgame phases", () => {
    expect(ENDGAME_PHASES.has("LOBBY")).toBe(false);
    expect(ENDGAME_PHASES.has("WHISPER")).toBe(false);
    expect(ENDGAME_PHASES.has("VOTE")).toBe(false);
  });
});

describe("PHASE_LABELS", () => {
  it("has a label for every PhaseKey", () => {
    const allPhases: PhaseKey[] = [
      "INIT", "INTRODUCTION", "LOBBY", "WHISPER", "RUMOR", "VOTE",
      "POWER", "REVEAL", "COUNCIL", "DIARY_ROOM", "PLEA", "ACCUSATION",
      "DEFENSE", "OPENING_STATEMENTS", "JURY_QUESTIONS", "CLOSING_ARGUMENTS",
      "JURY_VOTE", "END",
    ];
    for (const phase of allPhases) {
      expect(typeof PHASE_LABELS[phase]).toBe("string");
      expect(PHASE_LABELS[phase].length).toBeGreaterThan(0);
    }
  });
});

describe("DRAMATIC_PHASES", () => {
  it("contains the expected dramatic phases", () => {
    expect(DRAMATIC_PHASES.has("VOTE")).toBe(true);
    expect(DRAMATIC_PHASES.has("POWER")).toBe(true);
    expect(DRAMATIC_PHASES.has("REVEAL")).toBe(true);
    expect(DRAMATIC_PHASES.has("COUNCIL")).toBe(true);
    expect(DRAMATIC_PHASES.has("JURY_VOTE")).toBe(true);
  });

  it("does not contain non-dramatic phases", () => {
    expect(DRAMATIC_PHASES.has("LOBBY")).toBe(false);
    expect(DRAMATIC_PHASES.has("WHISPER")).toBe(false);
  });
});

describe("CHAT_FEED_PHASES", () => {
  it("contains expected chat feed phases", () => {
    expect(CHAT_FEED_PHASES.has("INTRODUCTION")).toBe(true);
    expect(CHAT_FEED_PHASES.has("LOBBY")).toBe(true);
    expect(CHAT_FEED_PHASES.has("RUMOR")).toBe(true);
  });

  it("does not contain non-chat-feed phases", () => {
    expect(CHAT_FEED_PHASES.has("WHISPER")).toBe(false);
    expect(CHAT_FEED_PHASES.has("VOTE")).toBe(false);
  });
});
