import { describe, it, expect } from "bun:test";
import {
  parseVoteMsg,
  parseEmpowered,
  parseCouncilVoteMsg,
  parsePowerAction,
  parseJuryVoteMsg,
  parseJuryTally,
  parseWinnerAnnouncement,
  parseJuryQuestion,
  parseJuryAnswer,
  parseEliminationVote,
  parseEmpowerTied,
  parseReVoteResolved,
  parseWheelDecides,
  isParseableStructuredMsg,
  wsEntryToTranscriptEntry,
} from "../app/games/[slug]/components/message-parsing";

describe("parseVoteMsg", () => {
  it("parses a standard vote message", () => {
    expect(parseVoteMsg("Alice votes: empower=Bob, expose=Charlie")).toEqual({
      voter: "Alice",
      empower: "Bob",
      expose: "Charlie",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseVoteMsg("hello world")).toBeNull();
  });
});

describe("parseEmpowered", () => {
  it("parses empowered announcement", () => {
    expect(parseEmpowered("Empowered: Alice")).toEqual({ name: "Alice" });
  });

  it("returns null for non-matching text", () => {
    expect(parseEmpowered("Not empowered")).toBeNull();
  });
});

describe("parseCouncilVoteMsg", () => {
  it("parses council vote", () => {
    expect(parseCouncilVoteMsg("Alice council vote -> Bob")).toEqual({
      voter: "Alice",
      target: "Bob",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseCouncilVoteMsg("random text")).toBeNull();
  });
});

describe("parsePowerAction", () => {
  it("parses protect action", () => {
    expect(parsePowerAction("Alice power action: protect -> Bob")).toEqual({
      agent: "Alice",
      action: "protect",
      target: "Bob",
    });
  });

  it("parses eliminate action", () => {
    expect(parsePowerAction("Rex power action: eliminate -> Charlie")).toEqual({
      agent: "Rex",
      action: "eliminate",
      target: "Charlie",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parsePowerAction("no action here")).toBeNull();
  });
});

describe("parseJuryVoteMsg", () => {
  it("parses jury vote", () => {
    expect(parseJuryVoteMsg("Alice (juror) votes for: Bob")).toEqual({
      juror: "Alice",
      target: "Bob",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseJuryVoteMsg("not a jury vote")).toBeNull();
  });
});

describe("parseJuryTally", () => {
  it("parses jury tally", () => {
    expect(parseJuryTally("Jury votes for Alice: 3")).toEqual({
      candidate: "Alice",
      votes: 3,
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseJuryTally("no tally")).toBeNull();
  });
});

describe("parseWinnerAnnouncement", () => {
  it("parses winner announcement", () => {
    expect(parseWinnerAnnouncement("*** THE WINNER IS: Alice ***")).toEqual({
      winner: "Alice",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseWinnerAnnouncement("no winner")).toBeNull();
  });
});

describe("parseJuryQuestion", () => {
  it("parses jury question", () => {
    expect(parseJuryQuestion("[QUESTION to Alice] Why did you betray Bob?")).toEqual({
      finalist: "Alice",
      question: "Why did you betray Bob?",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseJuryQuestion("just a question")).toBeNull();
  });
});

describe("parseJuryAnswer", () => {
  it("parses jury answer", () => {
    expect(parseJuryAnswer("[ANSWER to Bob] I had to survive.")).toEqual({
      juror: "Bob",
      answer: "I had to survive.",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseJuryAnswer("not an answer")).toBeNull();
  });
});

describe("parseEliminationVote", () => {
  it("parses elimination vote", () => {
    expect(parseEliminationVote("Alice votes to eliminate: Bob")).toEqual({
      voter: "Alice",
      target: "Bob",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseEliminationVote("not a vote")).toBeNull();
  });
});

describe("parseEmpowerTied", () => {
  it("parses tie with two names", () => {
    expect(parseEmpowerTied("Empower TIED between: Alice, Bob. Re-vote!")).toEqual({
      names: ["Alice", "Bob"],
    });
  });

  it("parses tie with three names", () => {
    expect(parseEmpowerTied("Empower TIED between: Alice, Bob, Charlie. Re-vote!")).toEqual({
      names: ["Alice", "Bob", "Charlie"],
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseEmpowerTied("no tie")).toBeNull();
  });
});

describe("parseReVoteResolved", () => {
  it("parses re-vote resolved", () => {
    expect(parseReVoteResolved("Re-vote resolved: Alice empowered")).toEqual({
      name: "Alice",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseReVoteResolved("nothing resolved")).toBeNull();
  });
});

describe("parseWheelDecides", () => {
  it("parses wheel decision", () => {
    expect(parseWheelDecides("Re-vote still tied! THE WHEEL decides: Bob empowered")).toEqual({
      name: "Bob",
    });
  });

  it("returns null for non-matching text", () => {
    expect(parseWheelDecides("no wheel")).toBeNull();
  });
});

describe("isParseableStructuredMsg", () => {
  it("returns true for parseable messages", () => {
    expect(isParseableStructuredMsg("Alice votes: empower=Bob, expose=Charlie")).toBe(true);
    expect(isParseableStructuredMsg("Empowered: Alice")).toBe(true);
    expect(isParseableStructuredMsg("Alice council vote -> Bob")).toBe(true);
    expect(isParseableStructuredMsg("*** THE WINNER IS: Alice ***")).toBe(true);
    expect(isParseableStructuredMsg("Alice votes to eliminate: Bob")).toBe(true);
  });

  it("returns false for non-parseable messages", () => {
    expect(isParseableStructuredMsg("Hello everyone, let's talk strategy.")).toBe(false);
    expect(isParseableStructuredMsg("I think we should ally")).toBe(false);
  });
});

describe("wsEntryToTranscriptEntry", () => {
  it("converts a WS entry to TranscriptEntry", () => {
    const wsEntry = {
      round: 2,
      phase: "LOBBY",
      from: "player-uuid-1",
      scope: "public" as const,
      to: ["player-uuid-2"],
      roomId: 1,
      text: "Hello everyone",
      timestamp: 1700000000000,
    };

    const result = wsEntryToTranscriptEntry(wsEntry, "game-123", 42);

    expect(result).toEqual({
      id: 42,
      gameId: "game-123",
      round: 2,
      phase: "LOBBY",
      fromPlayerId: "player-uuid-1",
      fromPlayerName: null,
      scope: "public",
      toPlayerIds: ["player-uuid-2"],
      roomId: 1,
      roomMetadata: undefined,
      text: "Hello everyone",
      thinking: null,
      timestamp: 1700000000000,
    });
  });

  it("sets fromPlayerId to null for system messages", () => {
    const wsEntry = {
      round: 1,
      phase: "VOTE",
      from: "SYSTEM",
      scope: "system" as const,
      text: "Voting has begun",
      timestamp: 1700000000000,
    };

    const result = wsEntryToTranscriptEntry(wsEntry, "game-456", 1);

    expect(result.fromPlayerId).toBeNull();

    const houseResult = wsEntryToTranscriptEntry({ ...wsEntry, from: "House" }, "game-456", 2);
    expect(houseResult.fromPlayerId).toBeNull();
  });

  it("sets toPlayerIds to null when 'to' is undefined", () => {
    const wsEntry = {
      round: 1,
      phase: "LOBBY",
      from: "player-1",
      scope: "public" as const,
      text: "Hi",
      timestamp: 1700000000000,
    };

    const result = wsEntryToTranscriptEntry(wsEntry, "game-789", 5);

    expect(result.toPlayerIds).toBeNull();
  });

  it("preserves whisper room metadata from live events", () => {
    const roomMetadata = {
      rooms: [
        { roomId: 1, round: 1, beat: 1, playerIds: ["player-1", "player-2", "player-3"] },
        { roomId: 2, round: 1, beat: 1, playerIds: [] },
      ],
      excluded: [],
    };

    const result = wsEntryToTranscriptEntry({
      round: 1,
      phase: "WHISPER",
      from: "House",
      scope: "system" as const,
      roomMetadata,
      text: "Beat 1: Room 1: Atlas, Vera, Finn | Room 2: Empty",
      timestamp: 1700000000000,
    }, "game-rooms", 7);

    expect(result.roomMetadata).toEqual(roomMetadata);
  });
});
