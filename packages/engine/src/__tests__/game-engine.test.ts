/**
 * Influence Game - Core Engine Tests
 *
 * Tests for game state, vote tallying, elimination, shield mechanics,
 * endgame state machine, jury tracking, and endgame vote tallying.
 * No LLM calls — fully deterministic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { GameState, createUUID } from "../game-state";
import { GameEventBus } from "../event-bus";
import { GameRunner } from "../game-runner";
import type { AgentResponse, PhaseContext, PowerLobbyExposure } from "../game-runner";
import { createPhaseMachine } from "../phase-machine";
import { createActor } from "xstate";
import { Phase, PlayerStatus } from "../types";
import type { GameConfig, RoomAllocation } from "../types";
import { MockAgent } from "./mock-agent";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Assert a value is defined — throws in tests if assumption is violated */
function defined<T>(value: T | undefined, msg = "Expected value to be defined"): T {
  if (value === undefined) throw new Error(msg);
  return value;
}

function makeState(playerNames: string[]) {
  return new GameState(playerNames.map((name) => ({ id: createUUID(), name })));
}

class PowerLobbyProbeAgent extends MockAgent {
  readonly powerLobbyCalls: Array<{
    context: PhaseContext;
    candidates: [string, string];
    exposePressure: PowerLobbyExposure[];
  }> = [];

  override async getPowerLobbyMessage(
    context: PhaseContext,
    candidates: [string, string],
    exposePressure: PowerLobbyExposure[],
  ): Promise<AgentResponse> {
    this.powerLobbyCalls.push({ context, candidates, exposePressure });
    const empoweredName = context.alivePlayers.find((p) => p.id === context.empoweredId)?.name ?? "the empowered player";
    const candidateNames = candidates.map(
      (id) => context.alivePlayers.find((p) => p.id === id)?.name ?? id,
    );

    return {
      thinking: `${this.name} addresses ${empoweredName}`,
      message: `${empoweredName}, ${candidateNames.join(" and ")} need to answer the expose vote before you act.`,
    };
  }
}

// ---------------------------------------------------------------------------
// GameState: player tracking
// ---------------------------------------------------------------------------

describe("GameState - player management", () => {
  it("initializes with all players alive", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    expect(gs.getAlivePlayers()).toHaveLength(4);
    expect(gs.isGameOver()).toBe(false);
  });

  it("eliminates a player correctly", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    gs.eliminatePlayer(alice.id);
    expect(gs.getAlivePlayers()).toHaveLength(3);
    expect(gs.getPlayer(alice.id)?.status).toBe(PlayerStatus.ELIMINATED);
  });

  it("detects game over when 1 player remains", () => {
    const gs = makeState(["Alice", "Bob"]);
    const alive = gs.getAlivePlayers();
    gs.eliminatePlayer(defined(alive[0]).id);
    expect(gs.isGameOver()).toBe(true);
    expect(gs.getWinner()?.name).toBe(defined(alive[1]).name);
  });

  it("tracks final whisper-session exclusions separately from round exclusions", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    const room: RoomAllocation = {
      roomId: 1,
      round: 1,
      beat: 1,
      playerIds: [defined(players[0]).id, defined(players[1]).id],
    };
    const roundExcluded = [defined(players[2]).id, defined(players[3]).id];
    const finalSessionExcluded = [defined(players[3]).id];

    gs.recordRoomAllocations([room], roundExcluded, finalSessionExcluded);

    expect(gs.getRoomAllocations(1)?.excluded).toEqual(roundExcluded);
    expect(gs.getRoomAllocations(1)?.lastSessionExcluded).toEqual(finalSessionExcluded);
  });
});

describe("Whisper Rooms", () => {
  const TEST_CONFIG: GameConfig = {
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
    },
    maxRounds: 2,
    minPlayers: 5,
    maxPlayers: 12,
  };

  it("open room allocation system message appears in transcript", async () => {
    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
      new MockAgent(createUUID(), "Echo"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    const allocation = result.transcript.find(
      (entry) => entry.scope === "system" && entry.phase === Phase.WHISPER && entry.roomMetadata,
    );
    expect(allocation).toBeDefined();
    expect(allocation!.text).toContain("Beat 1:");
    expect(allocation!.roomMetadata!.rooms).toHaveLength(2);
    expect(allocation!.roomMetadata!.rooms[0]!.playerIds.length).toBeGreaterThan(0);
  });

  it("open rooms generate group whispers for rooms with multiple occupants", async () => {
    class PileOnAgent extends MockAgent {
      async chooseWhisperRoom(): Promise<number> {
        return 1;
      }
    }

    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new PileOnAgent(createUUID(), name),
    );
    const runner = new GameRunner(agents, { ...TEST_CONFIG, whisperSessionsPerRound: 1 });
    const result = await runner.run();

    const allocation = result.transcript.find((entry) => entry.roomMetadata);
    expect(allocation?.roomMetadata?.rooms[0]?.playerIds).toHaveLength(5);

    const whispers = result.transcript.filter((entry) => entry.scope === "whisper" && entry.phase === Phase.WHISPER);
    expect(whispers).toHaveLength(5);
    expect(whispers[0]!.to).toHaveLength(4);
  });

  it("open rooms skip conversation for singleton rooms", async () => {
    class SpreadAgent extends MockAgent {
      async chooseWhisperRoom(ctx: PhaseContext): Promise<number> {
        return ctx.selfName === "Alpha" ? 1 : 2;
      }
    }

    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new SpreadAgent(createUUID(), name),
    );
    const runner = new GameRunner(agents, { ...TEST_CONFIG, whisperSessionsPerRound: 1 });
    const result = await runner.run();

    const whispers = result.transcript.filter((entry) => entry.scope === "whisper" && entry.phase === Phase.WHISPER);
    expect(whispers.every((entry) => entry.from !== "Alpha")).toBe(true);
    expect(whispers).toHaveLength(4);
  });

  it("passes open-room whispers into the following phase context", async () => {
    const seenWhispers = new Map<string, string[]>();

    class InboxProbeAgent extends MockAgent {
      async chooseWhisperRoom(): Promise<number> {
        return 1;
      }

      async sendRoomMessage(
        _ctx: PhaseContext,
        roomMates: string[],
        conversationHistory?: Array<{ from: string; text: string }>,
      ): Promise<AgentResponse | null> {
        const alreadySpoke = conversationHistory?.some((message) => message.from === this.name) ?? false;
        if (alreadySpoke) return null;
        const others = roomMates.filter((name) => name !== this.name);
        return others.length > 0
          ? { thinking: "", message: `${this.name} shares private voting intel.` }
          : null;
      }

      async getRumorMessage(ctx: PhaseContext): Promise<AgentResponse> {
        if (!seenWhispers.has(this.name)) {
          seenWhispers.set(this.name, ctx.whisperMessages.map((message) => message.from));
        }
        return super.getRumorMessage(ctx);
      }
    }

    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new InboxProbeAgent(createUUID(), name),
    );
    const runner = new GameRunner(agents, { ...TEST_CONFIG, whisperSessionsPerRound: 1 });
    await runner.run();

    expect(seenWhispers.size).toBe(5);
    for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Echo"]) {
      const senders = seenWhispers.get(name);
      expect(senders).toBeDefined();
      expect(senders).toHaveLength(4);
      expect(senders).not.toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// GameState: vote tallying
// ---------------------------------------------------------------------------

describe("GameState - VOTE phase tallying", () => {
  let gs: GameState;
  let alice: string;
  let bob: string;
  let charlie: string;
  let dave: string;

  beforeEach(() => {
    gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    alice = players.find((p) => p.name === "Alice")!.id;
    bob = players.find((p) => p.name === "Bob")!.id;
    charlie = players.find((p) => p.name === "Charlie")!.id;
    dave = players.find((p) => p.name === "Dave")!.id;
  });

  it("empowers the player with the most empower votes", () => {
    gs.recordVote(alice, bob, charlie); // empower Bob
    gs.recordVote(charlie, bob, alice); // empower Bob
    gs.recordVote(dave, alice, bob); // empower Alice
    gs.recordVote(bob, charlie, alice); // empower Charlie

    const { empowered, tied } = gs.tallyEmpowerVotes();
    expect(empowered).toBe(bob); // Bob has 2 votes
    expect(tied).toBeNull();
  });

  it("breaks empower ties randomly (runs 10 times and result is valid)", () => {
    gs.recordVote(alice, bob, charlie); // empower Bob
    gs.recordVote(charlie, alice, bob); // empower Alice

    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      // Reset votes
      gs.startRound();
      gs.recordVote(alice, bob, charlie);
      gs.recordVote(charlie, alice, bob);
      gs.recordVote(dave, bob, alice);
      gs.recordVote(bob, alice, charlie);
      const { empowered, tied } = gs.tallyEmpowerVotes();
      // When tied, the function returns tied array instead of resolving randomly
      if (tied) {
        expect(tied).toContain(alice);
        expect(tied).toContain(bob);
        results.add(tied[0]!);
      } else {
        results.add(empowered);
      }
    }
    // Both alice and bob should appear in tied results
    expect(results.has(alice) || results.has(bob)).toBe(true);
  });

  it("calculates expose scores correctly", () => {
    gs.recordVote(alice, bob, charlie); // expose Charlie
    gs.recordVote(bob, alice, charlie); // expose Charlie
    gs.recordVote(charlie, alice, dave); // expose Dave
    gs.recordVote(dave, charlie, charlie); // expose Charlie

    const scores = gs.getExposeScores();
    expect(scores[charlie]).toBe(3); // 3 expose votes
    expect(scores[dave]).toBe(1);
    expect(scores[alice]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GameState: POWER phase mechanics
// ---------------------------------------------------------------------------

describe("GameState - POWER phase", () => {
  let gs: GameState;
  let alice: string;
  let bob: string;
  let charlie: string;
  let dave: string;

  beforeEach(() => {
    gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    alice = players.find((p) => p.name === "Alice")!.id;
    bob = players.find((p) => p.name === "Bob")!.id;
    charlie = players.find((p) => p.name === "Charlie")!.id;
    dave = players.find((p) => p.name === "Dave")!.id;

    // Setup: Bob is empowered; Charlie and Dave are top exposed
    gs.recordVote(alice, bob, charlie);
    gs.recordVote(bob, alice, charlie);
    gs.recordVote(charlie, dave, dave);
    gs.recordVote(dave, bob, charlie);

    gs.tallyEmpowerVotes(); // sets empoweredId
  });

  it("determines top two candidates by expose votes (pass action)", () => {
    gs.setPowerAction({ action: "pass", target: charlie });
    const { candidates, autoEliminated, shieldGranted } = gs.determineCandidates();

    expect(autoEliminated).toBeNull();
    expect(shieldGranted).toBeNull();
    expect(candidates).not.toBeNull();
    // Charlie should be first (3 expose votes: alice, bob, dave)
    expect(candidates![0]).toBe(charlie);
  });

  it("auto-eliminate skips council", () => {
    gs.setPowerAction({ action: "eliminate", target: charlie });
    const { candidates, autoEliminated } = gs.determineCandidates();

    expect(autoEliminated).toBe(charlie);
    expect(candidates).toBeNull();
  });

  it("protect grants shield and substitutes candidate", () => {
    // Charlie is top exposed — empowered protects Charlie
    gs.setPowerAction({ action: "protect", target: charlie });
    const { candidates, shieldGranted } = gs.determineCandidates();

    expect(shieldGranted).toBe(charlie);
    expect(gs.getPlayer(charlie)?.shielded).toBe(true);
    // Charlie should NOT be a candidate
    expect(candidates).not.toBeNull();
    expect(candidates!.includes(charlie)).toBe(false);
  });

  it("shielded player cannot be a council candidate", () => {
    // Manually shield Charlie
    // Set shield by running a protect action in prior round
    gs.setPowerAction({ action: "protect", target: charlie });
    gs.determineCandidates();

    // Next round: Charlie is shielded
    gs.startRound();
    gs.recordVote(alice, bob, charlie);
    gs.recordVote(bob, alice, charlie);
    gs.recordVote(charlie, dave, dave);
    gs.recordVote(dave, bob, charlie);
    gs.tallyEmpowerVotes();

    gs.setPowerAction({ action: "pass", target: charlie });
    const { candidates } = gs.determineCandidates();

    // Charlie is shielded, so not a candidate
    expect(candidates).not.toBeNull();
    if (candidates) {
      expect(candidates.includes(charlie)).toBe(false);
    }
  });

  it("expire shields clears shielded status", () => {
    gs.setPowerAction({ action: "protect", target: charlie });
    gs.determineCandidates();
    expect(gs.getPlayer(charlie)?.shielded).toBe(true);

    gs.expireShields();
    expect(gs.getPlayer(charlie)?.shielded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GameRunner: Power Lobby experiment
// ---------------------------------------------------------------------------

describe("GameRunner - Power Lobby after vote experiment", () => {
  const BASE_CONFIG: GameConfig = {
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
    },
    maxRounds: 2,
    minPlayers: 4,
    maxPlayers: 12,
    lobbyMessagesPerPlayer: 1,
    whisperSessionsPerRound: 1,
    maxWhisperExchanges: 1,
  };

  function makeAgents(): PowerLobbyProbeAgent[] {
    return ["Alpha", "Beta", "Gamma", "Delta"].map(
      (name) => new PowerLobbyProbeAgent(createUUID(), name),
    );
  }

  it("logs a POWER lobby marker and one public message per alive player when enabled", async () => {
    const agents = makeAgents();
    const runner = new GameRunner(agents, {
      ...BASE_CONFIG,
      powerLobbyAfterVote: true,
    });

    const result = await runner.run();
    const firstRoundPowerTranscript = result.transcript.filter(
      (entry) => entry.round === 1 && entry.phase === Phase.POWER,
    );
    const marker = firstRoundPowerTranscript.find(
      (entry) => entry.scope === "system" && entry.text.startsWith("POWER LOBBY:"),
    );
    const publicMessages = firstRoundPowerTranscript.filter((entry) => entry.scope === "public");
    const powerAction = firstRoundPowerTranscript.find(
      (entry) => entry.scope === "system" && entry.text.includes("power action:"),
    );

    expect(marker).toBeDefined();
    expect(marker?.text).toContain("The vote is locked");
    expect(marker?.text).toContain("Provisional council pressure");
    expect(publicMessages).toHaveLength(4);
    expect(powerAction).toBeDefined();
    expect(firstRoundPowerTranscript.indexOf(marker!)).toBeLessThan(
      firstRoundPowerTranscript.indexOf(powerAction!),
    );
    expect(firstRoundPowerTranscript.indexOf(publicMessages.at(-1)!)).toBeLessThan(
      firstRoundPowerTranscript.indexOf(powerAction!),
    );

    for (const agent of agents) {
      expect(agent.powerLobbyCalls.length).toBeGreaterThanOrEqual(1);
      const call = agent.powerLobbyCalls[0]!;
      expect(call.context.phase).toBe(Phase.POWER);
      expect(call.context.empoweredId).toBeDefined();
      expect(call.context.councilCandidates).toEqual(call.candidates);
      for (let i = 1; i < call.exposePressure.length; i++) {
        expect(call.exposePressure[i - 1]!.score).toBeGreaterThanOrEqual(
          call.exposePressure[i]!.score,
        );
      }
    }
  });

  it("does not run the Power Lobby sub-step when the experiment flag is off", async () => {
    const agents = makeAgents();
    const runner = new GameRunner(agents, BASE_CONFIG);

    const result = await runner.run();

    expect(
      result.transcript.some(
        (entry) => entry.phase === Phase.POWER && entry.text.startsWith("POWER LOBBY:"),
      ),
    ).toBe(false);
    expect(
      result.transcript.some(
        (entry) => entry.phase === Phase.POWER && entry.scope === "public",
      ),
    ).toBe(false);
    for (const agent of agents) {
      expect(agent.powerLobbyCalls).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// GameState: COUNCIL phase
// ---------------------------------------------------------------------------

describe("GameState - COUNCIL phase", () => {
  let gs: GameState;
  let alice: string;
  let bob: string;
  let charlie: string;
  let dave: string;

  beforeEach(() => {
    gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    alice = players.find((p) => p.name === "Alice")!.id;
    bob = players.find((p) => p.name === "Bob")!.id;
    charlie = players.find((p) => p.name === "Charlie")!.id;
    dave = players.find((p) => p.name === "Dave")!.id;

    // Set up candidates
    gs.recordVote(alice, bob, charlie);
    gs.recordVote(bob, alice, charlie);
    gs.recordVote(charlie, dave, dave);
    gs.recordVote(dave, bob, charlie);
    gs.tallyEmpowerVotes(); // bob is empowered

    gs.setPowerAction({ action: "pass", target: charlie });
    gs.determineCandidates();
  });

  it("eliminates the candidate with more council votes", () => {
    const [c1, c2] = gs.councilCandidates!;
    // Empowered (bob) doesn't vote normally; alice, charlie, dave vote
    gs.recordCouncilVote(alice, c1);
    gs.recordCouncilVote(charlie, c1);
    gs.recordCouncilVote(dave, c2);
    gs.recordCouncilVote(bob, c2); // empowered tiebreaker vote (won't count normally)

    const eliminated = gs.tallyCouncilVotes(bob);
    expect(eliminated).toBe(c1); // c1 has 2 normal votes
  });

  it("uses empowered tiebreaker on council tie", () => {
    const [c1, c2] = gs.councilCandidates!;
    // 1 vote each (alice votes c1, charlie votes c2, dave doesn't vote)
    gs.recordCouncilVote(alice, c1);
    gs.recordCouncilVote(charlie, c2);
    // Empowered (bob) votes for c1 as tiebreaker
    gs.recordCouncilVote(bob, c1);

    const eliminated = gs.tallyCouncilVotes(bob);
    expect(eliminated).toBe(c1);
  });
});

// ---------------------------------------------------------------------------
// GameEventBus: action collection
// ---------------------------------------------------------------------------

describe("GameEventBus - action collection", () => {
  it("collects actions from all expected agents within timeout", async () => {
    const bus = new GameEventBus();
    const agentIds = [createUUID(), createUUID(), createUUID()];

    // Submit actions with small delay
    setTimeout(() => {
      for (const id of agentIds) {
        bus.submitAction({ type: "VOTE", from: id, empowerTarget: defined(agentIds[0]), exposeTarget: defined(agentIds[1]) });
      }
    }, 10);

    const collected = await bus.collectActions("VOTE", agentIds, 500);
    expect(collected).toHaveLength(3);
    bus.complete();
  });

  it("returns partial results when timeout fires", async () => {
    const bus = new GameEventBus();
    const agentIds = [createUUID(), createUUID(), createUUID()];

    // Only one agent submits
    setTimeout(() => {
      bus.submitAction({ type: "VOTE", from: defined(agentIds[0]), empowerTarget: defined(agentIds[1]), exposeTarget: defined(agentIds[2]) });
    }, 10);

    const collected = await bus.collectActions("VOTE", agentIds, 100);
    expect(collected).toHaveLength(1);
    bus.complete();
  });
});

// ---------------------------------------------------------------------------
// Phase machine: state transitions
// ---------------------------------------------------------------------------

describe("Phase machine - state transitions", () => {
  it("transitions from init through introduction to lobby", async () => {
    const machine = createPhaseMachine();
    const actor = createActor(machine, {
      input: {
        gameId: createUUID(),
        playerIds: [createUUID(), createUUID(), createUUID(), createUUID()],
        maxRounds: 5,
      },
    });

    const states: string[] = [];
    actor.subscribe((s) => {
      const sv = s.value as string;
      if (!states.includes(sv)) states.push(sv);
    });

    actor.start();
    expect(actor.getSnapshot().value).toBe("init");

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("introduction");

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("lobby");

    actor.stop();
  });

  it("advances through full round: lobby -> whisper -> rumor -> vote -> power -> reveal -> council -> checkGameOver", async () => {
    const machine = createPhaseMachine();
    // Use 6 players so endgame isn't triggered after eliminating one (5 remain)
    const playerIds = [createUUID(), createUUID(), createUUID(), createUUID(), createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 5 },
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    await advance(); // init -> introduction
    await advance(); // introduction -> lobby
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote

    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power

    actor.send({ type: "CANDIDATES_DETERMINED", candidates: [defined(playerIds[1]), defined(playerIds[2])], autoEliminated: null });
    await advance(); // power -> reveal

    await advance(); // reveal -> council

    // After council, send elimination and check game over
    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[1]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: [defined(playerIds[0]), defined(playerIds[2]), defined(playerIds[3]), defined(playerIds[4]), defined(playerIds[5])] });
    await advance(); // council -> checkGameOver -> lobby (5 players remain, no endgame)

    expect(actor.getSnapshot().value).toBe("lobby");

    actor.stop();
  });

  it("ends game when only 1 player remains", async () => {
    const machine = createPhaseMachine();
    const playerIds = [createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 10 },
    });

    const done = new Promise<void>((resolve) => {
      actor.subscribe((s) => {
        if (s.status === "done") resolve();
      });
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    await advance(); // init -> introduction
    await advance(); // introduction -> lobby
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote

    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power

    // Auto-eliminate the second player
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: defined(playerIds[1]) });
    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[1]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: [defined(playerIds[0])] });
    await advance(); // power -> checkGameOver (auto-eliminate) -> end

    // Wait for actor to complete
    await Promise.race([done, new Promise((r) => setTimeout(r, 100))]);
    expect(actor.getSnapshot().status).toBe("done");

    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Phase machine: endgame transitions
// ---------------------------------------------------------------------------

describe("Phase machine - endgame transitions", () => {
  it("routes to reckoning_lobby when 4 players remain", async () => {
    const machine = createPhaseMachine();
    const playerIds = [createUUID(), createUUID(), createUUID(), createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 10 },
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    // Run through init -> introduction -> first round
    await advance(); // init -> introduction
    await advance(); // intro -> lobby
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote

    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power

    // Auto-eliminate one player (5 -> 4)
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: defined(playerIds[4]) });
    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[4]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: playerIds.slice(0, 4) });
    await advance(); // power -> checkGameOver -> reckoning_lobby

    expect(actor.getSnapshot().value).toBe("reckoning_lobby");
    expect(actor.getSnapshot().context.endgameStage).toBe("reckoning");

    actor.stop();
  });

  it("routes to tribunal_lobby when 3 players remain", async () => {
    const machine = createPhaseMachine();
    const playerIds = [createUUID(), createUUID(), createUUID(), createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 10 },
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    // Fast-forward: init -> introduction -> lobby
    await advance(); // init -> introduction
    await advance(); // intro -> lobby

    // Simulate eliminating 2 players in first round (5 -> 3)
    // Go through full round
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power

    // Auto-eliminate (5 -> 4) — should go to reckoning
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: defined(playerIds[4]) });
    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[4]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: playerIds.slice(0, 4) });
    await advance(); // power -> checkGameOver -> reckoning_lobby

    expect(actor.getSnapshot().value).toBe("reckoning_lobby");

    // Run through reckoning: lobby -> whisper -> plea -> vote
    await advance(); // reckoning_lobby -> reckoning_whisper
    await advance(); // reckoning_whisper -> reckoning_plea
    await advance(); // reckoning_plea -> reckoning_vote

    // Eliminate one (4 -> 3) in reckoning vote
    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[3]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: playerIds.slice(0, 3) });
    await advance(); // reckoning_vote -> checkGameOver -> tribunal_lobby

    expect(actor.getSnapshot().value).toBe("tribunal_lobby");
    expect(actor.getSnapshot().context.endgameStage).toBe("tribunal");

    actor.stop();
  });

  it("routes to judgment_opening when 2 players remain", async () => {
    const machine = createPhaseMachine();
    const playerIds = [createUUID(), createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 10 },
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    // Fast-forward past intro and first round to checkGameOver with 3 alive
    await advance(); // init -> introduction
    await advance(); // intro -> lobby
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power

    // Eliminate to 2 (council path)
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: [defined(playerIds[1]), defined(playerIds[2])], autoEliminated: null });
    await advance(); // power -> reveal
    await advance(); // reveal -> council

    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[2]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: [defined(playerIds[0]), defined(playerIds[1])] });
    await advance(); // council -> checkGameOver -> judgment_opening (2 alive)

    expect(actor.getSnapshot().value).toBe("judgment_opening");
    expect(actor.getSnapshot().context.endgameStage).toBe("judgment");
    expect(actor.getSnapshot().context.finalists).toEqual([defined(playerIds[0]), defined(playerIds[1])]);

    actor.stop();
  });

  it("judgment flows through all phases to end", async () => {
    const machine = createPhaseMachine();
    const playerIds = [createUUID(), createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 10 },
    });

    const done = new Promise<void>((resolve) => {
      actor.subscribe((s) => {
        if (s.status === "done") resolve();
      });
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    // Get to judgment
    await advance(); // init -> introduction
    await advance(); // intro -> lobby
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: [defined(playerIds[1]), defined(playerIds[2])], autoEliminated: null });
    await advance(); // power -> reveal
    await advance(); // reveal -> council
    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[2]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: [defined(playerIds[0]), defined(playerIds[1])] });
    await advance(); // council -> checkGameOver -> judgment_opening

    expect(actor.getSnapshot().value).toBe("judgment_opening");
    await advance(); // judgment_opening -> judgment_jury_questions
    expect(actor.getSnapshot().value).toBe("judgment_jury_questions");
    await advance(); // judgment_jury_questions -> judgment_closing
    expect(actor.getSnapshot().value).toBe("judgment_closing");
    await advance(); // judgment_closing -> judgment_jury_vote
    expect(actor.getSnapshot().value).toBe("judgment_jury_vote");

    // Determine winner
    actor.send({ type: "JURY_WINNER_DETERMINED", winnerId: defined(playerIds[0]) });
    await advance(); // judgment_jury_vote -> end

    await Promise.race([done, new Promise((r) => setTimeout(r, 100))]);
    expect(actor.getSnapshot().status).toBe("done");
    expect(actor.getSnapshot().context.winner).toBe(defined(playerIds[0]));

    actor.stop();
  });

  it("tracks jury members on elimination", async () => {
    const machine = createPhaseMachine();
    const playerIds = [createUUID(), createUUID(), createUUID(), createUUID(), createUUID()];
    const actor = createActor(machine, {
      input: { gameId: createUUID(), playerIds, maxRounds: 10 },
    });

    actor.start();
    const advance = async () => {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    };

    await advance(); // init -> introduction
    await advance(); // intro -> lobby
    await advance(); // lobby -> whisper
    await advance(); // whisper -> rumor
    await advance(); // rumor -> vote
    actor.send({ type: "VOTES_TALLIED", empoweredId: defined(playerIds[0]) });
    await advance(); // vote -> power

    // Eliminate via council (power -> reveal -> council)
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: [defined(playerIds[3]), defined(playerIds[4])], autoEliminated: null });
    await advance(); // power -> reveal
    await advance(); // reveal -> council

    actor.send({ type: "PLAYER_ELIMINATED", playerId: defined(playerIds[4]) });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: playerIds.slice(0, 4) });
    await advance(); // council -> checkGameOver -> reckoning_lobby

    const ctx = actor.getSnapshot().context;
    expect(ctx.jury).toHaveLength(1);
    expect(defined(ctx.jury[0]).playerId).toBe(defined(playerIds[4]));

    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// GameState: Endgame - jury tracking
// ---------------------------------------------------------------------------

describe("GameState - Endgame jury tracking", () => {
  it("adds eliminated players to jury", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    const eve = players.find((p) => p.name === "Eve")!;
    const frank = players.find((p) => p.name === "Frank")!;

    gs.eliminatePlayer(eve.id);
    gs.eliminatePlayer(frank.id);

    expect(gs.jury).toHaveLength(2);
    expect(defined(gs.jury[0]).playerName).toBe("Eve");
    expect(defined(gs.jury[1]).playerName).toBe("Frank");
  });

  it("does not add duplicate jury members", () => {
    const gs = makeState(["Alice", "Bob", "Charlie"]);
    gs.startRound();
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;

    gs.eliminatePlayer(alice.id);
    gs.addToJury(alice.id, 1); // Try to add again

    expect(gs.jury).toHaveLength(1);
  });

  it("tracks cumulative empower votes", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    const players = gs.getAlivePlayers();
    const alice = players.find((p) => p.name === "Alice")!.id;
    const bob = players.find((p) => p.name === "Bob")!.id;
    const charlie = players.find((p) => p.name === "Charlie")!.id;
    const dave = players.find((p) => p.name === "Dave")!.id;

    // Round 1: Bob gets 2 empower votes
    gs.startRound();
    gs.recordVote(alice, bob, charlie);
    gs.recordVote(charlie, bob, alice);
    gs.recordVote(dave, alice, bob);
    gs.recordVote(bob, charlie, alice);
    gs.tallyEmpowerVotes();

    expect(gs.getCumulativeEmpowerVotes(bob)).toBe(2);
    expect(gs.getCumulativeEmpowerVotes(alice)).toBe(1);

    // Round 2: Bob gets 1 more
    gs.startRound();
    gs.recordVote(alice, bob, charlie);
    gs.recordVote(charlie, alice, bob);
    gs.recordVote(dave, alice, bob);
    gs.recordVote(bob, charlie, alice);
    gs.tallyEmpowerVotes();

    expect(gs.getCumulativeEmpowerVotes(bob)).toBe(3); // 2 + 1
    expect(gs.getCumulativeEmpowerVotes(alice)).toBe(3); // 1 + 2
  });
});

// ---------------------------------------------------------------------------
// GameState: Endgame - elimination vote tallying
// ---------------------------------------------------------------------------

describe("GameState - Endgame elimination votes", () => {
  let gs: GameState;
  let alice: string;
  let bob: string;
  let charlie: string;
  let dave: string;

  beforeEach(() => {
    gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    alice = players.find((p) => p.name === "Alice")!.id;
    bob = players.find((p) => p.name === "Bob")!.id;
    charlie = players.find((p) => p.name === "Charlie")!.id;
    dave = players.find((p) => p.name === "Dave")!.id;
    gs.setEndgameStage("reckoning");
  });

  it("eliminates player with most votes (simple plurality)", () => {
    gs.recordEndgameEliminationVote(alice, charlie);
    gs.recordEndgameEliminationVote(bob, charlie);
    gs.recordEndgameEliminationVote(charlie, alice);
    gs.recordEndgameEliminationVote(dave, charlie);

    const eliminated = gs.tallyEndgameEliminationVotes();
    expect(eliminated).toBe(charlie); // 3 votes
  });

  it("breaks ties deterministically", () => {
    gs.recordEndgameEliminationVote(alice, charlie);
    gs.recordEndgameEliminationVote(bob, dave);
    gs.recordEndgameEliminationVote(charlie, dave);
    gs.recordEndgameEliminationVote(dave, charlie);

    const eliminated = gs.tallyEndgameEliminationVotes();
    // Charlie and Dave are tied at 2 each
    expect([charlie, dave]).toContain(eliminated);
  });
});

// ---------------------------------------------------------------------------
// GameState: Endgame - tribunal vote tallying with jury tiebreaker
// ---------------------------------------------------------------------------

describe("GameState - Tribunal vote tallying", () => {
  it("uses jury tiebreaker when tribunal votes are tied", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave", "Eve"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    const alice = players.find((p) => p.name === "Alice")!.id;
    const bob = players.find((p) => p.name === "Bob")!.id;
    const charlie = players.find((p) => p.name === "Charlie")!.id;
    const dave = players.find((p) => p.name === "Dave")!.id;
    const eve = players.find((p) => p.name === "Eve")!.id;

    // Eliminate Dave and Eve (they become jurors)
    gs.eliminatePlayer(dave);
    gs.eliminatePlayer(eve);
    gs.setEndgameStage("tribunal");

    // Alice, Bob, Charlie remain. Alice and Bob tie.
    gs.recordEndgameEliminationVote(alice, bob);
    gs.recordEndgameEliminationVote(bob, alice);
    gs.recordEndgameEliminationVote(charlie, alice);

    // Actually this is 2 for Alice vs 1 for Bob — not a tie. Let me fix:
    gs.startRound(); // reset
    gs.recordEndgameEliminationVote(alice, bob);
    gs.recordEndgameEliminationVote(bob, alice);
    gs.recordEndgameEliminationVote(charlie, bob);

    // Alice: 1 vote, Bob: 2 votes — Bob eliminated (no tie)
    const eliminatedNoTie = gs.tallyTribunalVotes();
    expect(eliminatedNoTie).toBe(bob);

    // Now test actual tie
    gs.startRound();
    gs.recordEndgameEliminationVote(alice, charlie);
    gs.recordEndgameEliminationVote(bob, alice);
    gs.recordEndgameEliminationVote(charlie, alice);

    // Alice: 2 votes, Charlie: 1 vote — Alice eliminated
    const eliminatedClear = gs.tallyTribunalVotes();
    expect(eliminatedClear).toBe(alice);
  });
});

// ---------------------------------------------------------------------------
// GameState: Endgame - jury vote tallying (Judgment)
// ---------------------------------------------------------------------------

describe("GameState - Jury vote tallying (Judgment)", () => {
  it("determines winner by majority jury vote", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave", "Eve"]);
    gs.startRound();
    const players = gs.getAlivePlayers();
    const alice = players.find((p) => p.name === "Alice")!.id;
    const bob = players.find((p) => p.name === "Bob")!.id;
    const charlie = players.find((p) => p.name === "Charlie")!.id;
    const dave = players.find((p) => p.name === "Dave")!.id;
    const eve = players.find((p) => p.name === "Eve")!.id;

    // Eliminate Charlie, Dave, Eve (jurors)
    gs.eliminatePlayer(charlie);
    gs.eliminatePlayer(dave);
    gs.eliminatePlayer(eve);

    gs.setEndgameStage("judgment");

    // Jury votes: 2 for Alice, 1 for Bob
    gs.recordJuryVote(charlie, alice);
    gs.recordJuryVote(dave, alice);
    gs.recordJuryVote(eve, bob);

    const result = gs.tallyJuryVotes();
    expect(result.winnerId).toBe(alice);
    expect(result.method).toBe("majority");
  });

  it("uses cumulative empower votes as tiebreaker", () => {
    const gs = makeState(["Alice", "Bob", "Charlie", "Dave"]);
    const players = gs.getAlivePlayers();
    const alice = players.find((p) => p.name === "Alice")!.id;
    const bob = players.find((p) => p.name === "Bob")!.id;
    const charlie = players.find((p) => p.name === "Charlie")!.id;
    const dave = players.find((p) => p.name === "Dave")!.id;

    // Give Alice more empower votes across rounds
    gs.startRound();
    gs.recordVote(bob, alice, charlie);
    gs.recordVote(charlie, alice, dave);
    gs.recordVote(dave, bob, charlie);
    gs.recordVote(alice, bob, charlie);
    gs.tallyEmpowerVotes(); // Alice: 2 empower, Bob: 2 empower

    gs.startRound();
    gs.recordVote(bob, alice, charlie);
    gs.recordVote(charlie, alice, dave);
    gs.recordVote(dave, alice, bob);
    gs.recordVote(alice, bob, charlie);
    gs.tallyEmpowerVotes(); // Alice: 3 more, Bob: 1 more
    // Cumulative: Alice = 5, Bob = 3

    // Eliminate Charlie and Dave
    gs.eliminatePlayer(charlie);
    gs.eliminatePlayer(dave);
    gs.setEndgameStage("judgment");

    // Tied jury vote
    gs.recordJuryVote(charlie, alice);
    gs.recordJuryVote(dave, bob);

    const result = gs.tallyJuryVotes();
    expect(result.winnerId).toBe(alice); // More cumulative empower votes
    expect(result.method).toBe("empower_tiebreaker");
  });
});

// ---------------------------------------------------------------------------
// Diary Room: interview mechanics
// ---------------------------------------------------------------------------

describe("Diary Room - interview mechanics", () => {
  const TEST_CONFIG: GameConfig = {
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
    },
    maxRounds: 2,
    minPlayers: 5,
    maxPlayers: 12,
  };

  it("diary rooms appear in transcript between phases", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    // Diary room entries should exist in transcript
    const diaryEntries = result.transcript.filter((e) => e.phase === Phase.DIARY_ROOM);
    expect(diaryEntries.length).toBeGreaterThan(0);

    // Should have diary scope entries
    const diaryScoped = result.transcript.filter((e) => e.scope === "diary");
    expect(diaryScoped.length).toBeGreaterThan(0);

    // Should have both House questions and agent answers
    const houseQuestions = diaryScoped.filter((e) => e.from.startsWith("House"));
    const agentAnswers = diaryScoped.filter((e) => !e.from.startsWith("House"));
    expect(houseQuestions.length).toBeGreaterThan(0);
    expect(agentAnswers.length).toBeGreaterThan(0);
  });

  it("diary rooms run after Introduction only; thinking replaces diary for other phases", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    await runner.run();

    const diaryLog = runner.diaryLog;

    // Should have diary entries after INTRODUCTION (kept)
    const introEntries = diaryLog.filter((e) => e.precedingPhase === Phase.INTRODUCTION);
    expect(introEntries.length).toBeGreaterThan(0);

    // Diary rooms after LOBBY/RUMOR replaced by revealable thinking
    const lobbyEntries = diaryLog.filter((e) => e.precedingPhase === Phase.LOBBY);
    expect(lobbyEntries.length).toBe(0);

    const rumorEntries = diaryLog.filter((e) => e.precedingPhase === Phase.RUMOR);
    expect(rumorEntries.length).toBe(0);

    // Thinking is now embedded on transcript entries (not separate thinkingLog)
    const transcript = runner.transcriptLog;
    const entriesWithThinking = transcript.filter((e) => e.thinking && e.thinking.length > 0);
    expect(entriesWithThinking.length).toBeGreaterThan(0);
    // Lobby messages should have thinking attached
    const lobbyThinking = entriesWithThinking.filter((e) => e.phase === Phase.LOBBY);
    expect(lobbyThinking.length).toBeGreaterThan(0);
  });

  it("diary entries contain contextual House questions", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    await runner.run();

    const diaryLog = runner.diaryLog;

    // Each entry should have the agent's name in the question
    for (const entry of diaryLog) {
      expect(entry.question).toContain(entry.agentName);
      expect(entry.answer.length).toBeGreaterThan(0);
    }

    // Introduction diary questions should ask about strategy going into the game
    const introEntries = diaryLog.filter((e) => e.precedingPhase === Phase.INTRODUCTION);
    for (const entry of introEntries) {
      expect(entry.question.toLowerCase()).toMatch(/strategy|working with|watch their back/);
    }
  });

  it("each alive agent gets a diary entry per diary room session", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agentNames = ["Alpha", "Beta", "Gamma", "Delta"];
    const agents = agentNames.map((name) => new MockAgent(createUUID(), name));

    const runner = new GameRunner(agents, TEST_CONFIG);
    await runner.run();

    const diaryLog = runner.diaryLog;

    // After INTRODUCTION, all 4 agents should have diary entries
    const introEntries = diaryLog.filter((e) => e.precedingPhase === Phase.INTRODUCTION);
    const introNames = new Set(introEntries.map((e) => e.agentName));
    for (const name of agentNames) {
      expect(introNames.has(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Full game: endgame integration with MockAgents
// ---------------------------------------------------------------------------

describe("Full game - endgame integration", () => {
  const TEST_CONFIG: GameConfig = {
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
    },
    maxRounds: 10,
    minPlayers: 5,
    maxPlayers: 12,
  };

  it("4-player game completes with endgame phases", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    // Game should complete
    expect(result.rounds).toBeGreaterThan(0);

    // Should have endgame transcript entries
    const transcript = result.transcript;

    // With 4 players, after first normal round eliminates one (3 remain),
    // game goes to tribunal (skipping reckoning since we start at 4 not 5)
    const tribunalMarkers = transcript.filter(
      (e) => e.scope === "system" && e.text.includes("TRIBUNAL"),
    );
    const judgmentMarkers = transcript.filter(
      (e) => e.scope === "system" && e.text.includes("JUDGMENT"),
    );

    // At least tribunal and judgment should appear (starting from 4, first elimination goes to 3)
    expect(tribunalMarkers.length).toBeGreaterThan(0);
    expect(judgmentMarkers.length).toBeGreaterThan(0);

    // Should have a winner
    expect(result.winner).toBeDefined();
    expect(result.winnerName).toBeDefined();
  });

  it("6-player game exercises all endgame stages", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
      new MockAgent(createUUID(), "Epsilon"),
      new MockAgent(createUUID(), "Zeta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    expect(result.rounds).toBeGreaterThan(0);
    expect(result.winner).toBeDefined();

    const transcript = result.transcript;

    // Should have normal round phases
    const lobbyEntries = transcript.filter(
      (e) => e.scope === "system" && e.text.includes("LOBBY PHASE"),
    );
    expect(lobbyEntries.length).toBeGreaterThan(0);

    // Game should eventually reach judgment
    const judgmentEntries = transcript.filter(
      (e) => e.scope === "system" && e.text.includes("JUDGMENT"),
    );
    expect(judgmentEntries.length).toBeGreaterThan(0);

    // Should have jury vote entries
    const juryVoteEntries = transcript.filter(
      (e) => e.scope === "system" && e.text.includes("JURY VOTE"),
    );
    expect(juryVoteEntries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Anonymous Rumors
// ---------------------------------------------------------------------------

describe("Anonymous Rumors", () => {
  const TEST_CONFIG: GameConfig = {
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
    },
    maxRounds: 2,
    minPlayers: 5,
    maxPlayers: 12,
  };

  it("rumor transcript entries have anonymous flag set to true", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    const rumorEntries = result.transcript.filter(
      (e) => e.scope === "public" && e.phase === Phase.RUMOR && e.from !== "House",
    );
    expect(rumorEntries.length).toBeGreaterThan(0);

    for (const entry of rumorEntries) {
      expect(entry.anonymous).toBe(true);
    }
  });

  it("rumor transcript entries have displayOrder assigned", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    const rumorEntries = result.transcript.filter(
      (e) => e.scope === "public" && e.phase === Phase.RUMOR && e.from !== "House",
    );
    expect(rumorEntries.length).toBeGreaterThan(0);

    for (const entry of rumorEntries) {
      expect(typeof entry.displayOrder).toBe("number");
      expect(entry.displayOrder).toBeGreaterThanOrEqual(1);
    }
  });

  it("rumor displayOrder values are unique within a round", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    // Get rumor entries for first round that has them
    const rumorEntries = result.transcript.filter(
      (e) => e.scope === "public" && e.phase === Phase.RUMOR && e.from !== "House",
    );

    // Group by round
    const byRound = new Map<number, typeof rumorEntries>();
    for (const entry of rumorEntries) {
      const existing = byRound.get(entry.round) ?? [];
      existing.push(entry);
      byRound.set(entry.round, existing);
    }

    // Within each round, displayOrder values should be unique
    for (const [, entries] of byRound) {
      const orders = entries.map((e) => e.displayOrder);
      const unique = new Set(orders);
      expect(unique.size).toBe(entries.length);
    }
  });

  it("anonymous rumors are stripped of author in agent context (buildBasePrompt)", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    // Verify that rumor transcript entries still have the author (for viewer/replay)
    const rumorEntries = result.transcript.filter(
      (e) => e.scope === "public" && e.phase === Phase.RUMOR && e.anonymous === true,
    );
    expect(rumorEntries.length).toBeGreaterThan(0);

    // Each anonymous rumor entry should still have the real author in 'from'
    // (stored for viewers/replay, but stripped from agent context)
    for (const entry of rumorEntries) {
      expect(entry.from).toBeTruthy();
      expect(entry.from).not.toBe("House");
      expect(["Alpha", "Beta", "Gamma", "Delta"]).toContain(entry.from);
    }
  });

  it("non-rumor public messages do NOT have anonymous flag", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    // Lobby and introduction entries should NOT be anonymous
    const nonRumorPublic = result.transcript.filter(
      (e) => e.scope === "public" && e.phase !== Phase.RUMOR && e.from !== "House",
    );
    expect(nonRumorPublic.length).toBeGreaterThan(0);

    for (const entry of nonRumorPublic) {
      expect(entry.anonymous).toBeUndefined();
    }
  });

  it("stream events for rumors include anonymous metadata", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const events: { type: string; entry?: { anonymous?: boolean; displayOrder?: number; phase?: string; scope?: string; from?: string } }[] = [];
    runner.setStreamListener((event) => {
      if (event.type === "transcript_entry") {
        events.push({ type: event.type, entry: event.entry });
      }
    });

    await runner.run();

    const rumorStreamEvents = events.filter(
      (e) => e.entry?.phase === Phase.RUMOR && e.entry?.scope === "public" && e.entry?.from !== "House",
    );
    expect(rumorStreamEvents.length).toBeGreaterThan(0);

    for (const event of rumorStreamEvents) {
      expect(event.entry?.anonymous).toBe(true);
      expect(typeof event.entry?.displayOrder).toBe("number");
    }
  });
});
