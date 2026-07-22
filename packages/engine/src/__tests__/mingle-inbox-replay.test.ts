import { describe, expect, test } from "bun:test";
import {
  buildMingleInboxReplayFromTranscript,
  hydrateMingleInboxFromReplay,
} from "../mingle-inbox-replay";
import type { TranscriptEntry } from "../game-runner.types";
import { Phase, type UUID } from "../types";

const PLAYERS = [
  { id: "atlas" as UUID, name: "Atlas" },
  { id: "echo" as UUID, name: "Echo" },
  { id: "mira" as UUID, name: "Mira" },
] as const;

function mingleEntry(params: {
  phase: Phase;
  round: number;
  from: string;
  to: string[];
  text: string;
}): TranscriptEntry {
  return {
    timestamp: Date.parse("2026-07-21T00:00:00.000Z"),
    round: params.round,
    phase: params.phase,
    from: params.from,
    to: params.to,
    text: params.text,
    scope: "mingle",
  };
}

describe("buildMingleInboxReplayFromTranscript", () => {
  test("rebuilds private inbox messages from Mingle I transcript rows", () => {
    const replay = buildMingleInboxReplayFromTranscript({
      transcriptReplay: [
        mingleEntry({
          phase: Phase.MINGLE_I,
          round: 1,
          from: "Atlas",
          to: ["Echo", "Mira"],
          text: "form with me",
        }),
        mingleEntry({
          phase: Phase.MINGLE_I,
          round: 1,
          from: "Echo",
          to: ["Atlas"],
          text: "deal",
        }),
      ],
      players: [...PLAYERS],
    });

    expect(replay.sourceRound).toBe(1);
    expect(replay.unresolvedRecipientNames).toEqual([]);
    expect(replay.entries).toEqual([
      {
        recipientId: "atlas",
        messages: [{ from: "Echo", text: "deal" }],
      },
      {
        recipientId: "echo",
        messages: [{ from: "Atlas", text: "form with me" }],
      },
      {
        recipientId: "mira",
        messages: [{ from: "Atlas", text: "form with me" }],
      },
    ]);
  });

  test("still rebuilds classic Mingle and post-vote Mingle messages", () => {
    const classic = buildMingleInboxReplayFromTranscript({
      transcriptReplay: [
        mingleEntry({
          phase: Phase.MINGLE,
          round: 1,
          from: "Atlas",
          to: ["Echo"],
          text: "classic",
        }),
      ],
      players: [...PLAYERS],
    });
    expect(classic.entries).toEqual([
      { recipientId: "echo", messages: [{ from: "Atlas", text: "classic" }] },
    ]);

    const postVote = buildMingleInboxReplayFromTranscript({
      transcriptReplay: [
        mingleEntry({
          phase: Phase.POST_VOTE_MINGLE,
          round: 1,
          from: "Mira",
          to: ["Atlas"],
          text: "post-vote",
        }),
      ],
      players: [...PLAYERS],
    });
    expect(postVote.entries).toEqual([
      { recipientId: "atlas", messages: [{ from: "Mira", text: "post-vote" }] },
    ]);
  });

  test("prefers the latest round that has mingle speech", () => {
    const replay = buildMingleInboxReplayFromTranscript({
      transcriptReplay: [
        mingleEntry({
          phase: Phase.MINGLE_I,
          round: 1,
          from: "Atlas",
          to: ["Echo"],
          text: "round-1 leftover",
        }),
        mingleEntry({
          phase: Phase.POST_VOTE_MINGLE,
          round: 2,
          from: "Echo",
          to: ["Mira"],
          text: "round-2 latest",
        }),
      ],
      players: [...PLAYERS],
    });

    expect(replay.sourceRound).toBe(2);
    expect(replay.entries).toEqual([
      { recipientId: "mira", messages: [{ from: "Echo", text: "round-2 latest" }] },
    ]);
  });

  test("records unresolved recipient names without inventing player ids", () => {
    const replay = buildMingleInboxReplayFromTranscript({
      transcriptReplay: [
        mingleEntry({
          phase: Phase.MINGLE_I,
          round: 1,
          from: "Atlas",
          to: ["Echo", "Ghost"],
          text: "secret",
        }),
      ],
      players: [...PLAYERS],
    });

    expect(replay.unresolvedRecipientNames).toEqual(["Ghost"]);
    expect(replay.entries).toEqual([
      { recipientId: "echo", messages: [{ from: "Atlas", text: "secret" }] },
    ]);
  });

  test("ignores non-mingle transcript noise", () => {
    const replay = buildMingleInboxReplayFromTranscript({
      transcriptReplay: [
        {
          timestamp: Date.parse("2026-07-21T00:00:00.000Z"),
          round: 1,
          phase: Phase.MINGLE_I,
          from: "House",
          text: "rooms allocated",
          scope: "system",
        },
        {
          timestamp: Date.parse("2026-07-21T00:00:01.000Z"),
          round: 1,
          phase: Phase.PRE_VOTE_HUDDLE,
          from: "Atlas",
          to: ["Echo"],
          text: "huddle talk",
          scope: "huddle",
        },
      ],
      players: [...PLAYERS],
    });

    expect(replay.sourceRound).toBeNull();
    expect(replay.entries).toEqual([]);
    expect(replay.unresolvedRecipientNames).toEqual([]);
  });

  test("hydrateMingleInboxFromReplay restores recipient maps", () => {
    const target = new Map<UUID, Array<{ from: string; text: string }>>();
    hydrateMingleInboxFromReplay(target, {
      version: 1,
      sourceRound: 1,
      entries: [
        { recipientId: "echo", messages: [{ from: "Atlas", text: "hi" }] },
      ],
      unresolvedRecipientNames: [],
    });

    expect([...target.entries()]).toEqual([
      ["echo", [{ from: "Atlas", text: "hi" }]],
    ]);
  });
});
