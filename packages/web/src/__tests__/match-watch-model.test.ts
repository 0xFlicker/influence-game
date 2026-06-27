import { describe, expect, it } from "bun:test";
import type { GameDetail, GameWatchReplayFrame, GameWatchState, PhaseKey, TranscriptEntry } from "../lib/api";
import {
  applyWatchStateToGameDetail,
  buildMatchWatchModel,
  getMatchWatchRouteDecision,
  shouldApplyWatchStateUpdate,
  watchStatusToPlayerState,
} from "../app/games/[slug]/components/match-watch-model";

function baseGame(): GameDetail {
  return {
    id: "game-1",
    slug: "public-game",
    gameNumber: 7,
    status: "in_progress",
    currentRound: 1,
    maxRounds: 8,
    currentPhase: "INTRODUCTION",
    players: [
      {
        id: "p1",
        name: "Alice",
        persona: "strategic",
        status: "alive",
        shielded: false,
      },
      {
        id: "p2",
        name: "Bob",
        persona: "diplomat",
        status: "alive",
        shielded: false,
      },
    ],
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

function watchState(overrides: Partial<GameWatchState> = {}): GameWatchState {
  return {
    schemaVersion: 2,
    gameId: "game-1",
    slug: "public-game",
    status: "in_progress",
    source: "durable_projection",
    currentRound: 2,
    currentPhase: "VOTE",
    maxRounds: 8,
    eventCursor: {
      sequence: 12,
      source: "trusted_prefix",
      eventType: "phase_changed",
      createdAt: "2026-06-20T00:01:00.000Z",
    },
    projection: {
      availability: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      eventCount: 12,
      trustedEventCount: 12,
      validPrefixLength: 12,
      lastTrustedSequence: 12,
      diagnostics: [],
    },
    players: [
      {
        id: "p1",
        name: "Alice",
        persona: "Alice watches the table carefully.",
        personaKey: "observer",
        status: "alive",
        shielded: true,
        pressureStatus: "empowered",
      },
      {
        id: "p2",
        name: "Bob",
        persona: "diplomat",
        personaKey: "diplomat",
        status: "eliminated",
        shielded: false,
      },
    ],
    counts: {
      totalPlayers: 2,
      alivePlayers: 1,
      eliminatedPlayers: 1,
      unknownPlayers: 0,
    },
    final: {
      status: "not_final",
    },
    ...overrides,
  };
}

function transcriptEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "VOTE",
    fromPlayerId: null,
    fromPlayerName: null,
    scope: "system",
    toPlayerIds: null,
    text: "Voting is open.",
    timestamp: 1,
    ...overrides,
  };
}

function replayPressureMessages(phase: PhaseKey = "MINGLE"): TranscriptEntry[] {
  return [
    transcriptEntry({
      id: 1,
      text: "Alice votes: empower=Alice, expose=Bob",
    }),
    transcriptEntry({
      id: 2,
      text: "Bob votes: empower=Alice, expose=Cara",
    }),
    transcriptEntry({
      id: 3,
      text: "Cara votes: empower=Alice, expose=Bob",
    }),
    transcriptEntry({
      id: 4,
      text: "Dax votes: empower=Bob, expose=Dax",
    }),
    transcriptEntry({
      id: 5,
      text: "Empowered: Alice",
    }),
    transcriptEntry({
      id: 6,
      text: "Initial Council pair resolved before Mingle: Bob and Cara (exposure_bench)",
    }),
    transcriptEntry({
      id: 7,
      text: "Post-vote pressure: Alice is empowered. Council candidates: Bob (2), Cara (1). At-risk if a shield is granted: Dax (1).",
    }),
    transcriptEntry({
      id: 8,
      phase,
      text: "The room reacts to the vote.",
    }),
  ];
}

function replayFrame(
  players: GameWatchReplayFrame["players"],
  overrides: Partial<Omit<GameWatchReplayFrame, "players" | "counts">> = {},
): GameWatchReplayFrame {
  const alivePlayers = players.filter((player) => player.status === "alive").length;
  const eliminatedPlayers = players.filter((player) => player.status === "eliminated").length;
  return {
    schemaVersion: 1,
    gameId: "game-1",
    slug: "public-game",
    sequence: 1,
    eventType: "power.candidates_resolved",
    timestamp: 1,
    round: 1,
    phase: "MINGLE",
    ...overrides,
    players,
    counts: {
      totalPlayers: players.length,
      alivePlayers,
      eliminatedPlayers,
      unknownPlayers: players.length - alivePlayers - eliminatedPlayers,
    },
  };
}

describe("match watch model", () => {
  it("applies watch state as the authoritative shell state", () => {
    const next = applyWatchStateToGameDetail(baseGame(), watchState());

    expect(next.currentRound).toBe(2);
    expect(next.currentPhase).toBe("VOTE");
    expect(next.players.find((player) => player.id === "p1")?.shielded).toBe(true);
    expect(next.players.find((player) => player.id === "p1")).toMatchObject({
      persona: "Alice watches the table carefully.",
      personaKey: "observer",
      pressureStatus: "empowered",
    });
    expect(next.players.find((player) => player.id === "p2")?.status).toBe("eliminated");
    expect(next.watchState?.eventCursor.sequence).toBe(12);
  });

  it("guards stale watch state cursors", () => {
    const state = watchState();

    expect(shouldApplyWatchStateUpdate(13, state, "in_progress", "not_final")).toBe(false);
    expect(shouldApplyWatchStateUpdate(12, state, "in_progress", "not_final")).toBe(false);
    expect(shouldApplyWatchStateUpdate(11, state, "in_progress", "not_final")).toBe(true);
  });

  it("applies same-cursor terminal status transitions", () => {
    const state = watchState({
      status: "completed",
      currentPhase: "END",
      final: {
        status: "final",
        winner: {
          id: "p1",
          name: "Alice",
          source: "durable_projection",
        },
      },
      winner: {
        id: "p1",
        name: "Alice",
      },
    });

    expect(shouldApplyWatchStateUpdate(12, state, "in_progress", "not_final")).toBe(true);
    expect(shouldApplyWatchStateUpdate(12, state, "completed", "final")).toBe(false);
  });

  it("keeps unknown watch status from inventing a player transition", () => {
    expect(watchStatusToPlayerState("unknown", "eliminated")).toBe("eliminated");
    expect(watchStatusToPlayerState("unknown")).toBe("unknown");
  });

  it("clears stale pressure fields when the newest watch state omits them", () => {
    const next = applyWatchStateToGameDetail(
      {
        ...baseGame(),
        players: baseGame().players.map((player) => ({
          ...player,
          pressureStatus: "locked_at_risk" as const,
          exposeScore: 2,
        })),
      },
      watchState({
        players: [
          {
            id: "p1",
            name: "Alice",
            persona: "strategic",
            status: "alive",
            shielded: false,
          },
          {
            id: "p2",
            name: "Bob",
            persona: "diplomat",
            status: "alive",
            shielded: false,
          },
        ],
      }),
    );

    expect(next.players.some((player) => player.pressureStatus || player.exposeScore !== undefined)).toBe(false);
  });

  it("routes live games and explicit completed transcript replays into the shell", () => {
    const liveDecision = getMatchWatchRouteDecision(baseGame(), []);
    expect(liveDecision).toEqual({
      eligible: true,
      mode: "live",
      reason: "live_game",
    });

    const completedGame = {
      ...baseGame(),
      status: "completed" as const,
      currentPhase: "END" as const,
    };
    const replayTranscript = [
      {
        id: 1,
        gameId: "game-1",
        round: 1,
        phase: "END" as const,
        fromPlayerId: null,
        fromPlayerName: null,
        scope: "system" as const,
        toPlayerIds: null,
        text: "Game over.",
        timestamp: 1,
      },
    ];

    expect(getMatchWatchRouteDecision(completedGame, replayTranscript)).toEqual({
      eligible: false,
      mode: null,
      reason: "completed_choice",
    });

    const replayDecision = getMatchWatchRouteDecision(completedGame, replayTranscript, "replay");

    expect(replayDecision).toEqual({
      eligible: true,
      mode: "replay",
      reason: "replay_transcript",
    });
  });

  it("keeps waiting, non-entry terminal, and empty completed replay games out of the shell", () => {
    expect(getMatchWatchRouteDecision({
      ...baseGame(),
      status: "waiting",
    }, [])).toEqual({
      eligible: false,
      mode: null,
      reason: "waiting",
    });

    expect(getMatchWatchRouteDecision({
      ...baseGame(),
      status: "completed",
      currentPhase: "END",
    }, [], "replay")).toEqual({
      eligible: false,
      mode: null,
      reason: "no_replay_transcript",
    });

    expect(getMatchWatchRouteDecision({
      ...baseGame(),
      status: "cancelled",
      currentPhase: "END",
    }, [transcriptEntry()])).toEqual({
      eligible: false,
      mode: null,
      reason: "non_entry_terminal",
    });
  });

  it("builds shell display state from watch state before transcript fallbacks", () => {
    const game = applyWatchStateToGameDetail(baseGame(), watchState());
    const model = buildMatchWatchModel({
      game,
      messages: [],
      live: true,
      connStatus: "live",
      selectedPlayerId: "p2",
    });

    expect(model.mode).toBe("live");
    expect(model.roundLabel).toBe("Round 2");
    expect(model.phase).toBe("VOTE");
    expect(model.phaseLabel).toBe("Voting");
    expect(model.counts).toEqual({
      totalPlayers: 2,
      alivePlayers: 1,
      eliminatedPlayers: 1,
      unknownPlayers: 0,
    });
    expect(model.selectedPlayer?.player.name).toBe("Bob");
    expect(model.selectedPlayer?.statusLabel).toBe("Out");
    expect(model.players.find((card) => card.player.id === "p1")?.statusTags.map((tag) => tag.label)).toEqual([
      "Empowered",
      "Shielded",
    ]);
    expect(model.sourceLabel).toBe("Durable Projection");
    expect(model.phaseSegments.find((segment) => segment.key === "VOTE")?.state).toBe("current");
    expect(model.phaseSegments.find((segment) => segment.key === "MINGLE")?.state).toBe("past");
  });

  it("builds pressure status tags for post-vote cast rows", () => {
    const model = buildMatchWatchModel({
      game: {
        ...baseGame(),
        currentPhase: "VOTE",
        players: [
          {
            id: "p1",
            name: "Alice",
            persona: "strategic",
            status: "alive",
            shielded: false,
            pressureStatus: "empowered",
          },
          {
            id: "p2",
            name: "Bob",
            persona: "diplomat",
            status: "alive",
            shielded: false,
            pressureStatus: "locked_at_risk",
            exposeScore: 2,
          },
        ],
      },
      messages: [],
      live: true,
      connStatus: "live",
    });

    expect(model.players.map((card) => card.detail)).toEqual(["Empowered", "Exposed x2"]);
    expect(model.players[0]?.statusTags[0]).toMatchObject({
      kind: "empowered",
      icon: "👑",
      label: "Empowered",
    });
    expect(model.players[1]?.statusTags[0]).toMatchObject({
      kind: "locked_at_risk",
      icon: "⚡",
      label: "Exposed x2",
      title: "2 expose votes locked this Council danger",
    });
  });

  it("does not render duplicate life-state tags when no pressure applies", () => {
    const model = buildMatchWatchModel({
      game: baseGame(),
      messages: [],
      live: true,
      connStatus: "live",
    });

    expect(model.players.map((card) => card.statusLabel)).toEqual(["Alive", "Alive"]);
    expect(model.players.map((card) => card.statusTags)).toEqual([[], []]);
    expect(model.players.map((card) => card.detail)).toEqual(["", ""]);
  });

  it("renders replay pressure tags from structured replay watch frames", () => {
    const players = [
      ...baseGame().players,
      {
        id: "p3",
        name: "Cara",
        persona: "watchful",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p4",
        name: "Dax",
        persona: "direct",
        status: "alive" as const,
        shielded: false,
      },
    ];
    const model = buildMatchWatchModel({
      game: {
        ...baseGame(),
        status: "completed",
        currentRound: 4,
        currentPhase: "END",
        players,
      },
      messages: [],
      live: false,
      connStatus: "replay",
      playbackState: {
        round: 1,
        phase: "MINGLE",
        players,
        visibleMessages: replayPressureMessages(),
      },
      replayFrames: [
        replayFrame([
          { ...players[0]!, pressureStatus: "empowered" },
          { ...players[1]!, pressureStatus: "locked_at_risk", exposeScore: 2 },
          { ...players[2]!, pressureStatus: "empowered_selected", exposeScore: 1 },
          { ...players[3]!, pressureStatus: "replacement_risk", exposeScore: 1 },
        ]),
      ],
    });

    expect(model.players.map((card) => [card.player.name, card.statusTags.map((tag) => tag.label)])).toEqual([
      ["Alice", ["Empowered"]],
      ["Bob", ["Exposed x2"]],
      ["Cara", ["Selected x1"]],
      ["Dax", ["Bench Risk x1"]],
    ]);
  });

  it("uses replay watch frames to keep tied exposed bench players selectable", () => {
    const players = [
      {
        id: "p1",
        name: "Arden",
        persona: "calm",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p2",
        name: "Thane",
        persona: "strategic",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p3",
        name: "Echo",
        persona: "loyal",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p4",
        name: "Nyx",
        persona: "deceptive",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p5",
        name: "Jace",
        persona: "honest",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p6",
        name: "Mira",
        persona: "social",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p7",
        name: "Atlas",
        persona: "paranoid",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p8",
        name: "Vera",
        persona: "aggressive",
        status: "alive" as const,
        shielded: false,
      },
    ];
    const model = buildMatchWatchModel({
      game: {
        ...baseGame(),
        status: "completed",
        currentRound: 4,
        currentPhase: "END",
        players,
      },
      messages: [],
      live: false,
      connStatus: "replay",
      playbackState: {
        round: 1,
        phase: "POWER",
        players,
        visibleMessages: [
          transcriptEntry({ id: 1, text: "Mira votes: empower=Atlas, expose=Nyx" }),
          transcriptEntry({ id: 2, text: "Jace votes: empower=Nyx, expose=Atlas" }),
          transcriptEntry({ id: 3, text: "Thane votes: empower=Atlas, expose=Nyx" }),
          transcriptEntry({ id: 4, text: "Vera votes: empower=Atlas, expose=Jace" }),
          transcriptEntry({ id: 5, text: "Nyx votes: empower=Arden, expose=Vera" }),
          transcriptEntry({ id: 6, text: "Arden votes: empower=Atlas, expose=Nyx" }),
          transcriptEntry({ id: 7, text: "Atlas votes: empower=Mira, expose=Thane" }),
          transcriptEntry({ id: 8, text: "Echo votes: empower=Atlas, expose=Nyx" }),
          transcriptEntry({ id: 9, text: "Empowered: Atlas" }),
          transcriptEntry({
            id: 10,
            text: "Initial Council pair resolved before Mingle: Nyx and Vera (higher_votes_choice)",
          }),
          transcriptEntry({
            id: 11,
            text: "Post-vote pressure: Atlas is empowered. Council candidates: Nyx (4), Vera (1). At-risk if a shield is granted: Jace (1).",
          }),
        ],
      },
      replayFrames: [
        replayFrame([
          players[0]!,
          { ...players[1]!, pressureStatus: "selectable_exposed", exposeScore: 1 },
          players[2]!,
          { ...players[3]!, pressureStatus: "locked_at_risk", exposeScore: 4 },
          { ...players[4]!, pressureStatus: "replacement_risk", exposeScore: 1 },
          players[5]!,
          { ...players[6]!, pressureStatus: "empowered", exposeScore: 1 },
          { ...players[7]!, pressureStatus: "empowered_selected", exposeScore: 1 },
        ], { phase: "POWER" }),
      ],
    });

    expect(model.players.map((card) => [card.player.name, card.statusTags.map((tag) => tag.label)])).toEqual([
      ["Arden", []],
      ["Thane", ["Exposed"]],
      ["Echo", []],
      ["Nyx", ["Exposed x4"]],
      ["Jace", ["Bench Risk x1"]],
      ["Mira", []],
      ["Atlas", ["Empowered"]],
      ["Vera", ["Selected x1"]],
    ]);
  });

  it("marks exactly two exposed replay candidates as exposed and everyone else as fallback risk", () => {
    const players = [
      ...baseGame().players,
      {
        id: "p3",
        name: "Cara",
        persona: "watchful",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p4",
        name: "Dax",
        persona: "direct",
        status: "alive" as const,
        shielded: false,
      },
    ];
    const model = buildMatchWatchModel({
      game: {
        ...baseGame(),
        status: "completed",
        currentRound: 4,
        currentPhase: "END",
        players,
      },
      messages: [],
      live: false,
      connStatus: "replay",
      playbackState: {
        round: 1,
        phase: "MINGLE",
        players,
        visibleMessages: [
          transcriptEntry({ id: 1, text: "Alice votes: empower=Alice, expose=Bob" }),
          transcriptEntry({ id: 2, text: "Bob votes: empower=Alice, expose=Cara" }),
          transcriptEntry({ id: 3, text: "Cara votes: empower=Alice, expose=Bob" }),
          transcriptEntry({ id: 4, text: "Dax votes: empower=Alice, expose=Bob" }),
          transcriptEntry({ id: 5, text: "Empowered: Alice" }),
          transcriptEntry({
            id: 6,
            text: "Initial Council pair resolved before Mingle: Bob and Cara (exposure_locked)",
          }),
          transcriptEntry({
            id: 7,
            text: "Post-vote pressure: Alice is empowered. Council candidates: Bob (3), Cara (1). At-risk if a shield is granted: none.",
          }),
        ],
      },
      replayFrames: [
        replayFrame([
          { ...players[0]!, pressureStatus: "empowered" },
          { ...players[1]!, pressureStatus: "locked_at_risk", exposeScore: 3 },
          { ...players[2]!, pressureStatus: "locked_at_risk", exposeScore: 1 },
          { ...players[3]!, pressureStatus: "fallback_risk" },
        ]),
      ],
    });

    expect(model.players.map((card) => [card.player.name, card.statusTags.map((tag) => tag.label)])).toEqual([
      ["Alice", ["Empowered"]],
      ["Bob", ["Exposed x3"]],
      ["Cara", ["Exposed"]],
      ["Dax", ["Fallback Risk"]],
    ]);
  });

  it("keeps shield fallback pull-ups distinct from empowered-selected replay candidates", () => {
    const players = [
      ...baseGame().players,
      {
        id: "p3",
        name: "Cara",
        persona: "watchful",
        status: "alive" as const,
        shielded: false,
      },
      {
        id: "p4",
        name: "Dax",
        persona: "direct",
        status: "alive" as const,
        shielded: false,
      },
    ];
    const model = buildMatchWatchModel({
      game: {
        ...baseGame(),
        status: "completed",
        currentRound: 4,
        currentPhase: "END",
        players,
      },
      messages: [],
      live: false,
      connStatus: "replay",
      playbackState: {
        round: 1,
        phase: "REVEAL",
        players,
        visibleMessages: [
          transcriptEntry({ id: 1, text: "Alice votes: empower=Alice, expose=Bob" }),
          transcriptEntry({ id: 2, text: "Bob votes: empower=Alice, expose=Cara" }),
          transcriptEntry({ id: 3, text: "Cara votes: empower=Alice, expose=Bob" }),
          transcriptEntry({ id: 4, text: "Dax votes: empower=Alice, expose=Bob" }),
          transcriptEntry({ id: 5, text: "Empowered: Alice" }),
          transcriptEntry({
            id: 6,
            text: "Initial Council pair resolved before Mingle: Bob and Cara (exposure_locked)",
          }),
          transcriptEntry({
            id: 7,
            text: "Post-vote pressure: Alice is empowered. Council candidates: Bob (3), Cara (1). At-risk if a shield is granted: none.",
          }),
          transcriptEntry({ id: 8, phase: "POWER", text: "Alice power action: protect -> Bob" }),
          transcriptEntry({ id: 9, phase: "POWER", text: "Bob is protected (shield granted)" }),
          transcriptEntry({ id: 10, phase: "REVEAL", text: "=== REVEAL PHASE === Council candidates: Cara vs Dax" }),
        ],
      },
      replayFrames: [
        replayFrame([
          { ...players[0]!, pressureStatus: "empowered" },
          { ...players[1]!, shielded: true },
          { ...players[2]!, pressureStatus: "locked_at_risk", exposeScore: 1 },
          { ...players[3]!, pressureStatus: "fallback_risk" },
        ], { phase: "REVEAL" }),
      ],
    });

    expect(model.players.map((card) => [card.player.name, card.statusTags.map((tag) => tag.label)])).toEqual([
      ["Alice", ["Empowered"]],
      ["Bob", ["Shielded"]],
      ["Cara", ["Exposed"]],
      ["Dax", ["Fallback Risk"]],
    ]);
  });

  it("clears replay pressure outside the vote-to-council window", () => {
    const model = buildMatchWatchModel({
      game: baseGame(),
      messages: [],
      live: false,
      connStatus: "replay",
      playbackState: {
        round: 1,
        phase: "LOBBY",
        players: baseGame().players.map((player) => ({
          ...player,
          pressureStatus: "locked_at_risk" as const,
          exposeScore: 2,
        })),
        visibleMessages: replayPressureMessages("LOBBY"),
      },
    });

    expect(model.players.map((card) => card.statusTags)).toEqual([[], []]);
    expect(model.players.map((card) => card.detail)).toEqual(["", ""]);
  });

  it("uses replay playback state over terminal watch state for completed replay chrome", () => {
    const game = applyWatchStateToGameDetail(baseGame(), watchState({
      status: "completed",
      currentRound: 4,
      currentPhase: "END",
      players: [
        {
          id: "p1",
          name: "Alice",
          persona: "strategic",
          status: "alive",
          shielded: true,
        },
        {
          id: "p2",
          name: "Bob",
          persona: "diplomat",
          status: "eliminated",
          shielded: false,
        },
      ],
      counts: {
        totalPlayers: 2,
        alivePlayers: 1,
        eliminatedPlayers: 1,
        unknownPlayers: 0,
      },
      final: {
        status: "final",
        winner: {
          id: "p1",
          name: "Alice",
          source: "durable_projection",
        },
      },
    }));
    const model = buildMatchWatchModel({
      game,
      messages: [],
      live: false,
      connStatus: "replay",
      playbackState: {
        round: 1,
        phase: "LOBBY",
        players: baseGame().players,
        visibleMessages: [
          {
            id: 2,
            gameId: "game-1",
            round: 1,
            phase: "LOBBY",
            fromPlayerId: "p2",
            fromPlayerName: "Bob",
            scope: "public",
            toPlayerIds: null,
            text: "This is still the lobby.",
            timestamp: 2,
          },
        ],
      },
    });

    expect(model.roundLabel).toBe("Round 1");
    expect(model.phase).toBe("LOBBY");
    expect(model.phaseLabel).toBe("Public Lobby");
    expect(model.counts.alivePlayers).toBe(2);
    expect(model.counts.eliminatedPlayers).toBe(0);
    expect(model.selectedPlayer?.player.name).toBe("Alice");
    expect(model.selectedPlayer?.detail).toBe("");
    expect(model.selectedPlayer?.statusTags).toEqual([]);
    expect(model.latestPublicMessage?.text).toBe("This is still the lobby.");
    expect(model.phaseSegments.find((segment) => segment.key === "LOBBY")?.state).toBe("current");
    expect(model.phaseSegments.find((segment) => segment.key === "END")?.state).toBe("future");
  });

  it("keeps the phase rail current for diary and jury subphases", () => {
    const diaryModel = buildMatchWatchModel({
      game: {
        ...baseGame(),
        currentPhase: "DIARY_ROOM",
      },
      messages: [],
      live: true,
      connStatus: "live",
    });
    const juryModel = buildMatchWatchModel({
      game: {
        ...baseGame(),
        status: "completed",
        currentPhase: "JURY_QUESTIONS",
      },
      messages: [],
      live: false,
      connStatus: "replay",
    });

    expect(diaryModel.phase).toBe("DIARY_ROOM");
    expect(diaryModel.phaseLabel).toBe("Diary Room");
    expect(diaryModel.phaseSegments.find((segment) => segment.key === "LOBBY")?.state).toBe("current");
    expect(juryModel.phase).toBe("JURY_QUESTIONS");
    expect(juryModel.phaseLabel).toBe("Jury Questions");
    expect(juryModel.phaseSegments.find((segment) => segment.key === "END")?.state).toBe("current");
  });

  it("keeps historical whisper separate from current mingle in the watch rail", () => {
    const model = buildMatchWatchModel({
      game: {
        ...baseGame(),
        currentPhase: "WHISPER",
      },
      messages: [],
      live: false,
      connStatus: "replay",
    });

    expect(model.phase).toBe("WHISPER");
    expect(model.phaseLabel).toBe("Whisper");
    expect(model.phaseSegments.map((segment) => segment.key)).toContain("WHISPER");
    expect(model.phaseSegments.find((segment) => segment.key === "WHISPER")?.state).toBe("current");
    expect(model.phaseSegments.map((segment) => segment.key)).not.toContain("MINGLE");
  });
});
