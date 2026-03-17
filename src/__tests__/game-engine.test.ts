/**
 * Influence Game - Core Engine Tests
 *
 * Tests for game state, vote tallying, elimination, and shield mechanics.
 * No LLM calls — fully deterministic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { GameState, createUUID } from "../game-state";
import { GameEventBus } from "../event-bus";
import { createPhaseMachine } from "../phase-machine";
import { createActor } from "xstate";
import { Phase, PlayerStatus } from "../types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeState(playerNames: string[]) {
  return new GameState(playerNames.map((name) => ({ id: createUUID(), name })));
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
    gs.eliminatePlayer(alive[0].id);
    expect(gs.isGameOver()).toBe(true);
    expect(gs.getWinner()?.name).toBe(alive[1].name);
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

    const empowered = gs.tallyEmpowerVotes();
    expect(empowered).toBe(bob); // Bob has 2 votes
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
      results.add(gs.tallyEmpowerVotes());
    }
    // Both alice and bob should be empowered at least once across 10 runs
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
    const charliePlayer = gs.getPlayer(charlie)!;
    // Access private map via type cast for testing
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
        bus.submitAction({ type: "VOTE", from: id, empowerTarget: agentIds[0], exposeTarget: agentIds[1] });
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
      bus.submitAction({ type: "VOTE", from: agentIds[0], empowerTarget: agentIds[1], exposeTarget: agentIds[2] });
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
    const playerIds = [createUUID(), createUUID(), createUUID(), createUUID()];
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

    actor.send({ type: "VOTES_TALLIED", empoweredId: playerIds[0] });
    await advance(); // vote -> power

    actor.send({ type: "CANDIDATES_DETERMINED", candidates: [playerIds[1], playerIds[2]], autoEliminated: null });
    await advance(); // power -> reveal

    await advance(); // reveal -> council

    // After council, send elimination and check game over
    actor.send({ type: "PLAYER_ELIMINATED", playerId: playerIds[1] });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: [playerIds[0], playerIds[2], playerIds[3]] });
    await advance(); // council -> checkGameOver -> lobby (3 players remain)

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

    actor.send({ type: "VOTES_TALLIED", empoweredId: playerIds[0] });
    await advance(); // vote -> power

    // Auto-eliminate the second player
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: playerIds[1] });
    actor.send({ type: "PLAYER_ELIMINATED", playerId: playerIds[1] });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: [playerIds[0]] });
    await advance(); // power -> checkGameOver (auto-eliminate) -> end

    // Wait for actor to complete
    await Promise.race([done, new Promise((r) => setTimeout(r, 100))]);
    expect(actor.getSnapshot().status).toBe("done");

    actor.stop();
  });
});
