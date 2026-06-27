import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { GameDetail, GameWatchState, TranscriptEntry } from "../lib/api";
import {
  buildDiaryArchiveEntries,
  buildReplayTranscriptSlice,
  isReplayAtFinalResults,
  MatchWatchShell,
} from "../app/games/[slug]/components/match-watch-shell";
import { buildReplayScenes } from "../app/games/[slug]/components/spectacle-viewer";

function game(): GameDetail {
  return {
    id: "game-1",
    slug: "vast-violet-code",
    gameNumber: 12,
    status: "completed",
    currentRound: 1,
    maxRounds: 8,
    currentPhase: "MINGLE",
    players: [
      {
        id: "p1",
        name: "Atlas",
        persona: "observer",
        status: "alive",
        shielded: false,
      },
      {
        id: "p2",
        name: "Lyra",
        persona: "strategic",
        status: "eliminated",
        shielded: false,
      },
    ],
    modelTier: "standard",
    visibility: "public",
    viewerMode: "replay",
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

function entry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "MINGLE",
    fromPlayerId: "p1",
    fromPlayerName: "Atlas",
    scope: "mingle",
    toPlayerIds: ["p2"],
    roomId: 1,
    text: "Lyra, can I count on you before votes?",
    timestamp: 1,
    ...overrides,
  };
}

describe("MatchWatchShell", () => {
  it("renders persistent replay watch chrome around the embedded theater", () => {
    const currentGame = game();
    const html = renderToString(
      <MatchWatchShell
        game={currentGame}
        messages={[entry()]}
        live={false}
        connStatus="replay"
      />,
    );
    const textHtml = withoutReactTextMarkers(html);

    expect(html).toContain('data-testid="match-watch-shell"');
    expect(html).toContain("INFLUENCE");
    expect(html).toContain("Watch Room");
    expect(html).toContain("VAST-VIOLET-CODE");
    expect(textHtml).toContain("Round 1 Replay");
    expect(html).toContain("Cast &amp; Status");
    expect(html).toContain('aria-label="Cast selection"');
    expect(textHtml).toContain("1 alive / 1 out");
    expect(html).toContain("Strategy Lens");
    expect(html).toContain("Audience Lens");
    expect(html).toContain("Thinking");
    expect(html).toContain("Strategy");
    expect(html).toContain("Diary");
    expect(html).not.toContain("Receipts");
    expect(textHtml).toContain("Atlas is alive in round 1.");
    expect(html).toContain("data-replay-controls");
    expect(html).toContain("Speed:");
    expect(html).toContain("Atlas");
    expect(html).toContain("Lyra");
    expect(html).toContain("relative h-full min-h-0 overflow-hidden");
    expect(html).not.toContain("Relationship Field");
    expect(html).not.toContain("Public Thinking");
    expect(html).not.toContain("Public Strategy");
    expect(html).not.toContain("Public Receipts");
    expect(html).toContain('href="/games"');
    expect(html).toContain('aria-label="Exit watch room"');
    expect(html).toContain('title="Exit"');
  });

  it("renders live shell state from durable watch state without replay copy", () => {
    const durableWatchState: GameWatchState = {
      ...watchState(),
      currentPhase: "MINGLE",
    };
    const currentGame = {
      ...game(),
      status: "in_progress" as const,
      currentRound: 2,
      currentPhase: "MINGLE" as const,
      players: durableWatchState.players,
      watchState: durableWatchState,
    };
    const html = renderToString(
      <MatchWatchShell
        game={currentGame}
        messages={[entry({ round: 2, phase: "MINGLE", text: "Mingle is live." })]}
        live
        connStatus="live"
      />,
    );
    const textHtml = withoutReactTextMarkers(html);

    expect(html).toContain('data-watch-mode="live"');
    expect(textHtml).toContain("Round 2 Live");
    expect(html).toContain("Mingle");
    expect(html).toContain("<strong class=\"text-xs text-white/95\">3</strong>Alive");
    expect(html).toContain("<strong class=\"text-xs text-white/95\">1</strong>Out");
    expect(textHtml).toContain("Empowered");
    expect(textHtml).toContain("Selected");
    expect(textHtml).toContain("Exposed x2");
    expect(html).not.toContain('title="Alive"');
    expect(textHtml).not.toContain("Atlas carries a quiet, gravitational strategy.");
    expect(textHtml).not.toContain("Lyra gathers pressure with social warmth.");
    expect(html).not.toContain("Durable Projection");
    expect(html).toContain("Mingle is live.");
    expect(html).toContain("Thinking");
    expect(html).toContain("Strategy");
    expect(html).toContain("Diary");
    expect(html).not.toContain("Receipts");
    expect(html).not.toContain("Relationship Field");
    expect(html).not.toContain("Public Thinking");
    expect(html).not.toContain("Public Strategy");
    expect(html).not.toContain("Public Receipts");
  });

  it("builds newest-first diary archive entries with paired House questions", () => {
    const entries = buildDiaryArchiveEntries([
      entry({ id: 10, phase: "LOBBY", scope: "public", text: "Lobby opens.", timestamp: 100 }),
      entry({
        id: 11,
        phase: "DIARY_ROOM",
        fromPlayerId: "House -> Atlas",
        fromPlayerName: null,
        scope: "diary",
        text: "Atlas, who do you trust?",
        timestamp: 200,
      }),
      entry({
        id: 12,
        phase: "DIARY_ROOM",
        fromPlayerId: "Atlas",
        fromPlayerName: "Atlas",
        scope: "diary",
        text: "I trust Lyra for now.",
        timestamp: 210,
      }),
      entry({ id: 13, phase: "VOTE", scope: "public", text: "Votes open.", timestamp: 300 }),
      entry({
        id: 14,
        phase: "DIARY_ROOM",
        round: 2,
        fromPlayerId: "House -> Lyra",
        fromPlayerName: null,
        scope: "diary",
        text: "Lyra, what changed?",
        timestamp: 400,
      }),
      entry({
        id: 15,
        phase: "DIARY_ROOM",
        round: 2,
        fromPlayerId: "Lyra",
        fromPlayerName: "Lyra",
        scope: "diary",
        text: "Atlas gave me a real receipt.",
        timestamp: 410,
      }),
    ]);

    expect(entries.map((diary) => diary.playerName)).toEqual(["Lyra", "Atlas"]);
    expect(entries.map((diary) => diary.round)).toEqual([2, 1]);
    expect(entries[0]?.questionText).toBe("Lyra, what changed?");
    expect(entries[0]?.answerText).toBe("Atlas gave me a real receipt.");
    expect(entries[1]?.questionText).toBe("Atlas, who do you trust?");
    expect(entries[1]?.answerText).toBe("I trust Lyra for now.");
  });

  it("keeps diary-room transcript entries out of replay theater scenes", () => {
    const scenes = buildReplayScenes([
      entry({ id: 1, phase: "LOBBY", scope: "public", text: "Lobby opens.", timestamp: 100 }),
      entry({
        id: 2,
        phase: "DIARY_ROOM",
        fromPlayerId: "House -> Atlas",
        fromPlayerName: null,
        scope: "diary",
        text: "Atlas, what are you hiding?",
        timestamp: 200,
      }),
      entry({
        id: 3,
        phase: "DIARY_ROOM",
        fromPlayerId: "Atlas",
        fromPlayerName: "Atlas",
        scope: "diary",
        text: "A lot.",
        timestamp: 210,
      }),
      entry({ id: 4, phase: "VOTE", scope: "public", text: "Votes open.", timestamp: 300 }),
    ]);

    expect(scenes.map((scene) => scene.phase)).toEqual(["LOBBY", "VOTE"]);
    expect(scenes.flatMap((scene) => scene.messages).map((message) => message.scope)).not.toContain("diary");
  });

  it("limits diary archive source rows to the current replay cursor", () => {
    const transcript = [
      entry({ id: 1, phase: "LOBBY", scope: "public", text: "Lobby opens.", timestamp: 100 }),
      entry({
        id: 2,
        phase: "DIARY_ROOM",
        fromPlayerId: "House -> Atlas",
        fromPlayerName: null,
        scope: "diary",
        text: "Atlas, what did you notice?",
        timestamp: 200,
      }),
      entry({
        id: 3,
        phase: "DIARY_ROOM",
        fromPlayerId: "Atlas",
        fromPlayerName: "Atlas",
        scope: "diary",
        text: "Lyra is gathering votes.",
        timestamp: 210,
      }),
      entry({ id: 4, phase: "VOTE", scope: "public", text: "Votes open.", timestamp: 300 }),
      entry({
        id: 5,
        phase: "DIARY_ROOM",
        round: 2,
        fromPlayerId: "House -> Lyra",
        fromPlayerName: null,
        scope: "diary",
        text: "Lyra, what changed?",
        timestamp: 400,
      }),
      entry({
        id: 6,
        phase: "DIARY_ROOM",
        round: 2,
        fromPlayerId: "Lyra",
        fromPlayerName: "Lyra",
        scope: "diary",
        text: "Atlas lost the room.",
        timestamp: 410,
      }),
      entry({ id: 7, phase: "POWER", scope: "public", text: "Power opens.", timestamp: 500 }),
    ];

    const throughLobby = buildReplayTranscriptSlice(transcript, [transcript[0]!]);
    const throughVote = buildReplayTranscriptSlice(transcript, [transcript[0]!, transcript[3]!]);
    const throughPower = buildReplayTranscriptSlice(transcript, [transcript[0]!, transcript[3]!, transcript[6]!]);

    expect(buildDiaryArchiveEntries(throughLobby)).toEqual([]);
    expect(buildDiaryArchiveEntries(throughVote).map((diary) => diary.playerName)).toEqual(["Atlas"]);
    expect(buildDiaryArchiveEntries(throughPower).map((diary) => diary.playerName)).toEqual(["Lyra", "Atlas"]);
  });

  it("detects when replay playback has reached the final results moment", () => {
    const transcript = [
      entry({ id: 1, phase: "LOBBY", timestamp: 100 }),
      entry({ id: 2, phase: "VOTE", timestamp: 200 }),
      entry({ id: 3, phase: "END", text: "Atlas wins.", timestamp: 300 }),
    ];

    expect(isReplayAtFinalResults(transcript, [transcript[0]!, transcript[1]!])).toBe(false);
    expect(isReplayAtFinalResults(transcript, transcript)).toBe(true);
    expect(isReplayAtFinalResults(transcript, [transcript[0]!, transcript[2]!])).toBe(true);
  });

  it("keeps final results detection off before replay playback starts", () => {
    const transcript = [entry({ id: 1, phase: "END", text: "Atlas wins.", timestamp: 100 })];

    expect(isReplayAtFinalResults([], [])).toBe(false);
    expect(isReplayAtFinalResults(transcript, [])).toBe(false);
    expect(isReplayAtFinalResults(transcript, null)).toBe(false);
  });
});

function watchState(): GameWatchState {
  return {
    schemaVersion: 2,
    gameId: "game-1",
    slug: "vast-violet-code",
    status: "in_progress",
    source: "durable_projection",
    currentRound: 2,
    currentPhase: "VOTE",
    maxRounds: 8,
    eventCursor: {
      sequence: 3,
      source: "trusted_prefix",
      eventType: "vote.opened",
      createdAt: "2026-06-20T00:01:00.000Z",
    },
    projection: {
      availability: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      eventCount: 3,
      trustedEventCount: 3,
      validPrefixLength: 3,
      lastTrustedSequence: 3,
      diagnostics: [],
    },
    players: [
      {
        id: "p1",
        name: "Atlas",
        persona: "Atlas carries a quiet, gravitational strategy.",
        personaKey: "observer",
        pressureStatus: "empowered",
        status: "alive",
        shielded: false,
      },
      {
        id: "p2",
        name: "Lyra",
        persona: "Lyra gathers pressure with social warmth.",
        personaKey: "strategic",
        pressureStatus: "empowered_selected",
        exposeScore: 2,
        status: "alive",
        shielded: false,
      },
      {
        id: "p3",
        name: "Echo",
        persona: "Echo keeps grudges indexed.",
        personaKey: "contrarian",
        pressureStatus: "locked_at_risk",
        exposeScore: 2,
        status: "alive",
        shielded: false,
      },
      {
        id: "p4",
        name: "Rex",
        persona: "Rex has already left the board.",
        personaKey: "aggressive",
        status: "eliminated",
        shielded: false,
      },
    ],
    counts: {
      totalPlayers: 4,
      alivePlayers: 3,
      eliminatedPlayers: 1,
      unknownPlayers: 0,
    },
    final: {
      status: "not_final",
    },
  };
}

function withoutReactTextMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}
