import { describe, expect, it } from "bun:test";
import type { CanonicalGameEvent } from "../canonical-events";
import { replayCanonicalEvents } from "../game-projection";
import {
  appendRecentHouseNarrativeBeat,
  compileHouseNarrationContext,
  createEmptyHouseNarrativeContinuity,
  parseHouseNarrativeContinuity,
  type HouseNarrativeBeat,
  type HouseNarrativeContinuityV2,
} from "../house-summary-frontier";
import { Phase, PlayerStatus } from "../types";

const GAME_ID = "house-narration-context-game";
const ADA = "player-ada";
const BLAIR = "player-blair";

function event<T extends CanonicalGameEvent>(value: T): T {
  return value;
}

function formatPickEvents(): CanonicalGameEvent[] {
  return [
    event({
      sequence: 1,
      gameId: GAME_ID,
      round: 0,
      phase: Phase.INIT,
      type: "game.roster_initialized",
      timestamp: "2026-08-27T00:00:00.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        players: [
          { id: ADA, name: "Ada", status: PlayerStatus.ALIVE, shielded: false },
          { id: BLAIR, name: "Blair", status: PlayerStatus.ALIVE, shielded: false },
        ],
        formatManifest: ["vote_bomb", "save_or_eliminate"],
      },
    }),
    event({
      sequence: 2,
      gameId: GAME_ID,
      round: 1,
      phase: Phase.VOTE,
      type: "round.started",
      timestamp: "2026-08-27T00:00:01.000Z",
      source: "phase",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 1 },
    }),
    event({
      sequence: 3,
      gameId: GAME_ID,
      round: 1,
      phase: Phase.VOTE,
      type: "vote.empowered_set",
      timestamp: "2026-08-27T00:00:02.000Z",
      source: "phase",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { empowered: ADA, method: "initial" },
    }),
    event({
      sequence: 4,
      gameId: GAME_ID,
      round: 1,
      phase: Phase.FORMAT_MENU,
      type: "format.menu_offered",
      timestamp: "2026-08-27T00:00:03.000Z",
      source: "phase",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { empoweredId: ADA, offeredFormatIds: ["vote_bomb", "save_or_eliminate"] },
    }),
    event({
      sequence: 5,
      gameId: GAME_ID,
      round: 1,
      phase: Phase.FORMAT_PICK,
      type: "format.selected",
      timestamp: "2026-08-27T00:00:04.000Z",
      source: "phase",
      visibility: "public",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { empoweredId: ADA, formatId: "vote_bomb" },
    }),
  ];
}

const transcript = [
  {
    round: 1,
    phase: Phase.FORMAT_PICK,
    from: "Blair",
    scope: "public",
    text: "  Ada said Vote Bomb keeps eliminated players alive in her story.  ",
    entrySequence: 6,
    dialogueKind: "public_speech",
  },
  {
    round: 1,
    phase: Phase.FORMAT_PICK,
    from: "Ada",
    scope: "mingle",
    text: "  PRIVATE CONVERSATION CANARY: Vote Bomb left Blair eliminated but alive in Ada's telling.  ",
    entrySequence: 7,
    dialogueKind: "mingle_message",
  },
  {
    round: 1,
    phase: Phase.FORMAT_PICK,
    from: "Ada",
    scope: "system",
    text: "PRIVATE DECISION CANARY: selected Blair as the pressure target.",
    entrySequence: 8,
    dialogueKind: "sealed_decision",
  },
  {
    round: 1,
    phase: Phase.FORMAT_PICK,
    from: "House",
    scope: "system",
    text: "Old House summary must not feed the factual delta.",
    entrySequence: 9,
    dialogueKind: "house_summary",
  },
] as const;

const diaryEntries = [{
  round: 1,
  precedingPhase: Phase.VOTE,
  agentName: "Blair",
  question: "  Who was eliminated by Vote Bomb?  ",
  answer: "  PRIVATE DIARY CANARY: Blair says nobody is alive to that plan.  ",
}] as const;

function compile(beatClass: "ordinary" | "milestone") {
  const events = formatPickEvents();
  return compileHouseNarrationContext({
    actorCoordinate: "format_pick",
    round: 1,
    phase: Phase.FORMAT_PICK,
    beatClass,
    events,
    projection: replayCanonicalEvents(events),
    transcript,
    diaryEntries,
    afterCanonicalSequence: 2,
    afterDialogueSequence: 5,
  });
}

function beat(publicSummary: string, id = "house-beat/v2:1:format_pick:5:9"): HouseNarrativeBeat {
  return {
    version: 2,
    boundary: {
      version: 2,
      id,
      gameId: GAME_ID,
      actorCoordinate: "format_pick",
      round: 1,
      phase: Phase.FORMAT_PICK,
      beatClass: "ordinary",
      canonicalHead: 5,
      dialogueHead: 9,
    },
    publicSummary,
  };
}

describe("House narration context V2", () => {
  it("gives milestone House turns direct canonical, projection, public, private, and diary context", () => {
    const context = compile("milestone");

    expect(context.boundary).toMatchObject({ version: 2, beatClass: "milestone", canonicalHead: 5, dialogueHead: 9 });
    expect(context.canonicalEvents.map((entry) => entry.type)).toEqual([
      "vote.empowered_set",
      "format.menu_offered",
      "format.selected",
    ]);
    expect(context.canonicalEvents[1]?.data).toEqual({
      empowered: "Ada",
      offeredFormats: [
        { id: "short_list", name: "The Short List" },
        { id: "save_or_exit", name: "Save-or-Exit" },
      ],
    });
    expect(context.projection).toMatchObject({
      remainingPlayers: ["Ada", "Blair"],
      exitedPlayers: [],
      empowered: "Ada",
      selectedFormat: { id: "short_list", name: "The Short List" },
    });
    expect(context.publicDialogue).toEqual([expect.objectContaining({
      speaker: "Blair",
      text: "  Ada said Vote Bomb keeps eliminated players alive in her story.  ",
    })]);
    expect(context.privateDialogueAndDecisions.map((entry) => entry.text)).toEqual([
      "  PRIVATE CONVERSATION CANARY: Vote Bomb left Blair eliminated but alive in Ada's telling.  ",
      "PRIVATE DECISION CANARY: selected Blair as the pressure target.",
    ]);
    expect(context.diaryEntries).toEqual([expect.objectContaining({
      player: "Blair",
      question: "  Who was eliminated by Vote Bomb?  ",
      answer: "  PRIVATE DIARY CANARY: Blair says nobody is alive to that plan.  ",
    })]);
    expect(JSON.stringify(context.canonicalEvents)).not.toContain("vote_bomb");
    expect(JSON.stringify(context.canonicalEvents)).not.toContain("save_or_eliminate");
    expect(JSON.stringify(context)).not.toContain("Old House summary");
    expect(JSON.stringify(context)).not.toContain("sourceAlias");
    expect(JSON.stringify(context)).not.toContain("sourceValuesByAlias");
    expect(JSON.stringify(context)).not.toContain("claims");
  });

  it("keeps omniscient private conversations and diary answers out of ordinary beat context", () => {
    const context = compile("ordinary");

    expect(context.material).toBe(true);
    expect(context.publicDialogue).toHaveLength(1);
    expect(context.privateDialogueAndDecisions).toEqual([]);
    expect(context.diaryEntries).toEqual([]);
    expect(JSON.stringify(context)).not.toContain("PRIVATE CONVERSATION CANARY");
    expect(JSON.stringify(context)).not.toContain("PRIVATE DECISION CANARY");
    expect(JSON.stringify(context)).not.toContain("PRIVATE DIARY CANARY");
  });

  it("presents canonical format ballots with named voters and targets", () => {
    const events = [
      ...formatPickEvents(),
      event({
        sequence: 6,
        gameId: GAME_ID,
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.ballot_cast",
        timestamp: "2026-08-27T00:00:05.000Z",
        source: "phase",
        visibility: "producer",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          formatId: "vote_bomb",
          voterId: ADA,
          targetId: BLAIR,
          polarity: null,
        },
      }),
      event({
        sequence: 7,
        gameId: GAME_ID,
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.ballot_forfeited",
        timestamp: "2026-08-27T00:00:06.000Z",
        source: "phase",
        visibility: "producer",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          formatId: "restricted_history",
          voterId: BLAIR,
          reason: "history_exhausted",
        },
      }),
    ];
    const context = compileHouseNarrationContext({
      actorCoordinate: "format_resolve",
      round: 1,
      phase: Phase.FORMAT_RESOLVE,
      beatClass: "milestone",
      events,
      projection: replayCanonicalEvents(events),
      transcript: [],
      diaryEntries: [],
      afterCanonicalSequence: 5,
      afterDialogueSequence: 0,
    });

    expect(context.canonicalEvents).toEqual([
      expect.objectContaining({
        type: "format.ballot_cast",
        data: {
          format: { id: "short_list", name: "The Short List" },
          voter: "Ada",
          target: "Blair",
          polarity: null,
        },
      }),
      expect.objectContaining({
        type: "format.ballot_forfeited",
        data: {
          format: { id: "restricted_history", name: "Restricted History" },
          voter: "Blair",
          reason: "history_exhausted",
        },
      }),
    ]);
    expect(JSON.stringify(context.canonicalEvents)).not.toContain("player-ada");
    expect(JSON.stringify(context.canonicalEvents)).not.toContain("player-blair");
  });

  it("maps exit outcomes and omits canonical payloads without an explicit producer projection", () => {
    const baseEvents = formatPickEvents();
    const events: CanonicalGameEvent[] = [
      ...baseEvents,
      event({
        sequence: 6,
        gameId: GAME_ID,
        round: 1,
        phase: Phase.COUNCIL,
        type: "council.elimination_resolved",
        timestamp: "2026-08-27T00:00:05.000Z",
        source: "phase",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          empoweredId: ADA,
          candidates: [ADA, BLAIR],
          tally: { votes: { [ADA]: BLAIR, [BLAIR]: BLAIR } },
          eliminated: BLAIR,
          method: "plurality",
        },
      }),
      event({
        sequence: 7,
        gameId: GAME_ID,
        round: 1,
        phase: Phase.COUNCIL,
        type: "player.eliminated",
        timestamp: "2026-08-27T00:00:06.000Z",
        source: "phase",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: {
          playerId: BLAIR,
          playerName: "Blair",
          eliminatedRound: 1,
          juryMember: { playerId: BLAIR, playerName: "Blair", eliminatedRound: 1 },
        },
      }),
      event({
        sequence: 8,
        gameId: GAME_ID,
        round: 1,
        phase: Phase.COUNCIL,
        type: "player.elimination_message_recorded",
        timestamp: "2026-08-27T00:00:07.000Z",
        source: "phase",
        visibility: "public",
        payloadVersion: 1,
        sourcePointers: [],
        payload: { playerId: BLAIR, message: "Unprojected payload canary" },
      }),
    ];
    const context = compileHouseNarrationContext({
      actorCoordinate: "council",
      round: 1,
      phase: Phase.COUNCIL,
      beatClass: "milestone",
      events,
      projection: replayCanonicalEvents(baseEvents),
      transcript: [],
      diaryEntries: [],
      afterCanonicalSequence: 5,
      afterDialogueSequence: 0,
    });

    expect(context.canonicalEvents).toEqual([
      expect.objectContaining({
        type: "council.exit_resolved",
        data: {
          candidates: ["Ada", "Blair"],
          exitedPlayer: "Blair",
          method: "plurality",
        },
      }),
      expect.objectContaining({
        type: "player.exited",
        data: { exitedPlayer: "Blair", exitRound: 1 },
      }),
    ]);
    expect(JSON.stringify(context.canonicalEvents)).not.toContain("Unprojected payload canary");
    expect(JSON.stringify(context.canonicalEvents)).not.toMatch(/alive|eliminat/i);
  });

  it("round-trips exact V2 continuity and rejects V1, extras, and presentation controls", () => {
    const acceptedBeat = beat("  The House preserves this authored spacing.  ");
    const continuity: HouseNarrativeContinuityV2 = {
      ...createEmptyHouseNarrativeContinuity(GAME_ID),
      recentBeats: [acceptedBeat],
      privateNarrativeNotebook: "Private arc: Blair doubts Ada.",
      examinedCanonicalHead: 5,
      examinedDialogueHead: 9,
    };

    expect(parseHouseNarrativeContinuity(continuity)).toEqual({ status: "valid", value: continuity });
    expect(parseHouseNarrativeContinuity({ ...continuity, version: 1 }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({ ...continuity, gameId: "" }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({
      ...continuity,
      gameId: "another-game",
    }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({
      ...continuity,
      recentBeats: [acceptedBeat, structuredClone(acceptedBeat)],
    }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({ ...continuity, sourceAliases: ["S1"] }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({ ...continuity, privateNarrativeNotebook: "bad\u0007note" }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({
      ...continuity,
      recentBeats: [{ ...acceptedBeat, publicSummary: "x".repeat(181) }],
    }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({
      ...continuity,
      pendingDeltaCarry: 2,
    }).status).toBe("invalid");
    expect(parseHouseNarrativeContinuity({
      ...continuity,
      recentBeats: Array.from({ length: 9 }, (_, index) =>
        beat(`Beat ${index}`, `house-beat/v2:${index}`)
      ),
    }).status).toBe("invalid");
  });

  it("retains bounded public history", () => {
    const history = Array.from({ length: 10 }, (_, index) => beat(`Beat ${index}`, `house-beat/v2:${index}`))
      .reduce(appendRecentHouseNarrativeBeat, [] as HouseNarrativeBeat[]);

    expect(history).toHaveLength(8);
    expect(history.map((entry) => entry.publicSummary)).toEqual([
      "Beat 2", "Beat 3", "Beat 4", "Beat 5", "Beat 6", "Beat 7", "Beat 8", "Beat 9",
    ]);
  });
});
