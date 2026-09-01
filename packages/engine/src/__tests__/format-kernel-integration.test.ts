import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import type { GameStreamEvent } from "../game-runner";
import type { GameConfig } from "../types";
import { Phase } from "../types";
import { createUUID } from "../game-state";
import { MockAgent } from "./mock-agent";
import {
  LAUNCH_FORMAT_IDS,
  type LaunchFormatId,
} from "../formats";
import type { PhaseContext } from "../game-runner";
import { GameState } from "../game-state";
import { replayCanonicalEvents } from "../game-projection";
import { ContextBuilder } from "../context-builder";
import { TranscriptLogger } from "../transcript-logger";
import { ProviderAttemptError } from "../provider-execution";

const TEST_CONFIG: GameConfig = {
  timers: {
    introduction: 0,
    lobby: 0,
    mingle: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
  maxRounds: 3,
  minPlayers: 5,
  maxPlayers: 12,
};

describe("Format kernel integration (MockAgent)", () => {
  it("runs an explicit Two Names decline round through setup, one Mingle, pleas, ballots, and resolution", async () => {
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        mingleSessionsPerRound: 1,
        formatManifest: ["two_names"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );

    await runner.run();

    const canonical = runner.getCanonicalEvents();
    const setup = canonical.find((event) => event.type === "format.two_names_setup");
    const decline = canonical.find((event) => event.type === "format.two_names_override_declined");
    const resolution = canonical.find((event) => event.type === "format.resolved");
    expect(setup).toBeDefined();
    expect(decline).toBeDefined();
    expect(canonical.filter((event) => event.type === "format.two_names_mingle_completed"))
      .toEqual([expect.objectContaining({ payload: expect.objectContaining({ window: "initial_names" }) })]);
    expect(canonical.filter((event) => event.type === "format.two_names_plea_recorded")).toHaveLength(2);
    expect(canonical.filter(
      (event) => event.type === "format.ballot_cast" && event.payload.formatId === "two_names",
    )).toHaveLength(2);
    expect(resolution).toMatchObject({
      payloadVersion: 2,
      payload: {
        formatId: "two_names",
        aggregate: {
          capability: "two_names",
          overrideAction: "declined",
          eligibleVoterIds: expect.any(Array),
          totals: expect.any(Object),
        },
      },
    });
  });

  it("commits same-player Override use and replacement together, then runs the final-names Mingle", async () => {
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const [empowered, firstNamed, secondNamed, replacement] = agents;
    if (!empowered || !firstNamed || !secondNamed || !replacement) throw new Error("expected agents");
    empowered.getTwoNamesOverride = async () => ({
      action: "use",
      removedNomineeId: firstNamed.id,
      thinking: "use Override",
      decisionSource: "llm",
      fallbackReason: null,
    });
    empowered.getTwoNamesReplacement = async () => ({
      targetId: replacement.id,
      thinking: "name replacement",
      decisionSource: "llm",
      fallbackReason: null,
    });
    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        mingleSessionsPerRound: 1,
        formatManifest: ["two_names"],
      },
      undefined,
      { maxRoundsMode: "exact", random: () => 0 },
    );

    await runner.run();

    const canonical = runner.getCanonicalEvents();
    const usedIndex = canonical.findIndex((event) => event.type === "format.two_names_override_used");
    expect(usedIndex).toBeGreaterThan(0);
    expect(canonical[usedIndex + 1]).toMatchObject({
      type: "format.two_names_replacement_named",
      payload: {
        empoweredId: empowered.id,
        replacementNomineeId: replacement.id,
        finalistPlayerIds: [replacement.id, secondNamed.id],
      },
    });
    expect(canonical.filter((event) => event.type === "format.two_names_mingle_completed").map(
      (event) => event.type === "format.two_names_mingle_completed" ? event.payload.window : null,
    )).toEqual(["initial_names", "final_names"]);
    const resolution = canonical.find((event) => event.type === "format.resolved");
    expect(resolution).toMatchObject({
      payload: {
        aggregate: {
          capability: "two_names",
          overrideHolderId: empowered.id,
          overrideAction: "used",
          removedNomineeId: firstNamed.id,
          replacementNomineeId: replacement.id,
          finalistPlayerIds: [replacement.id, secondNamed.id],
          eligibleVoterIds: [firstNamed.id, agents[4]!.id],
        },
      },
    });
  });

  it("auto-selects a one-format manifest without a fake empowered pick", async () => {
    const agents = ["A", "B", "C", "D", "E"].map((name) => new MockAgent(createUUID(), name));
    let pickCalls = 0;
    for (const agent of agents) {
      agent.pickRoundFormat = async () => {
        pickCalls += 1;
        throw new Error("one-format games must not request an empowered pick");
      };
    }

    const runner = new GameRunner(
      agents,
      { ...TEST_CONFIG, maxRounds: 1, formatManifest: ["vote_bomb"] },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await runner.run();

    const canonical = runner.getCanonicalEvents();
    const roster = canonical[0];
    expect(roster?.type).toBe("game.roster_initialized");
    if (!roster || roster.type !== "game.roster_initialized") throw new Error("expected roster");
    expect(roster.payload.formatManifest).toEqual(["vote_bomb"]);
    expect(canonical.filter((event) => event.type === "format.menu_offered")).toHaveLength(0);
    expect(canonical.filter((event) => event.type === "format.selected")).toHaveLength(1);
    expect(canonical.find((event) => event.type === "format.selected")?.payload.formatId)
      .toBe("vote_bomb");
    const resolution = canonical.find((event) => event.type === "format.resolved");
    expect(resolution).toBeDefined();
    expect(resolution?.payloadVersion).toBe(2);
    expect(resolution?.payload).toMatchObject({
      formatId: "vote_bomb",
      aggregate: {
        capability: "sealed_elim",
        eligiblePlayerIds: expect.any(Array),
        totals: expect.any(Object),
      },
    });
    const eliminated = canonical.filter((event) => event.type === "player.eliminated");
    expect(canonical.filter((event) => event.type === "format.resolved")).toHaveLength(1);
    expect(eliminated).toHaveLength(1);
    expect(eliminated[0]?.payload.playerId).toBe(resolution?.payload.eliminatedId);
    expect(pickCalls).toBe(0);
    expect(runner.transcriptLog.some(
      (entry) => entry.scope === "system" && entry.text.includes("selected it automatically"),
    )).toBe(true);
    expect(runner.transcriptLog.some(
      (entry) => entry.scope === "system" && entry.text.startsWith("FORMAT LOCKED:"),
    )).toBe(true);
  });

  it("runs Majority Elimination through the shared sealed path without classic fields", async () => {
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const runner = new GameRunner(
      agents,
      { ...TEST_CONFIG, maxRounds: 1, formatManifest: ["majority_elimination"] },
      undefined,
      { maxRoundsMode: "exact" },
    );

    await runner.run();

    const canonical = runner.getCanonicalEvents();
    const resolution = canonical.find((event) => event.type === "format.resolved");
    expect(resolution).toBeDefined();
    if (!resolution || resolution.type !== "format.resolved") {
      throw new Error("expected Majority Elimination resolution");
    }
    expect(resolution.payloadVersion).toBe(2);
    expect(resolution.payload).toMatchObject({
      formatId: "majority_elimination",
      aggregate: {
        capability: "sealed_elim",
        totals: expect.any(Object),
        eligiblePlayerIds: agents.map((agent) => agent.id),
      },
    });
    expect(resolution.payload).not.toHaveProperty("voteBomb");
    expect(resolution.payload).not.toHaveProperty("saveOrEliminate");
    expect(resolution.payload).not.toHaveProperty("safetyBounce");
    expect(canonical.filter((event) => event.type === "format.ballot_cast")).toHaveLength(5);
    expect(canonical.filter((event) => event.type === "format.resolved")).toHaveLength(1);
    expect(canonical.filter((event) => event.type === "player.eliminated")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ playerId: resolution.payload.eliminatedId }),
      }),
    ]);
    expect(canonical.some((event) => event.type === "power.action_set")).toBe(false);
    expect(canonical.some((event) => event.type === "council.vote_cast")).toBe(false);
    expect(resolution.payload.eliminatedId).toBe(resolution.payload.empoweredId);
    expect(resolution.payload.tiedPlayerIds).toEqual([resolution.payload.empoweredId]);
    expect(resolution.payload.tiebreakerId).toBeNull();
  });

  it("restricts a Majority Elimination tiebreak to the tied highest totals", async () => {
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const [a, b, c, d, e] = agents;
    if (!a || !b || !c || !d || !e) throw new Error("expected five agents");
    const targets = new Map([
      [a.id, c.id],
      [b.id, c.id],
      [c.id, b.id],
      [d.id, b.id],
      [e.id, a.id],
    ]);
    for (const agent of agents) {
      agent.getMajorityEliminationBallot = async () => ({
        targetId: targets.get(agent.id)!,
        thinking: "force tied-highest Majority Elimination ballot",
        decisionSource: "llm",
        fallbackReason: null,
      });
    }

    const runner = new GameRunner(
      agents,
      { ...TEST_CONFIG, maxRounds: 1, formatManifest: ["majority_elimination"] },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await runner.run();

    const resolution = runner.getCanonicalEvents().find(
      (event) => event.type === "format.resolved",
    );
    if (!resolution || resolution.type !== "format.resolved") {
      throw new Error("expected Majority Elimination resolution");
    }
    if (resolution.payloadVersion !== 2) {
      throw new Error("expected version-2 Majority Elimination resolution");
    }
    expect(resolution.payload.aggregate).toEqual({
      capability: "sealed_elim",
      totals: {
        [a.id]: 1,
        [b.id]: 2,
        [c.id]: 2,
        [d.id]: 0,
        [e.id]: 0,
      },
      eligiblePlayerIds: agents.map((agent) => agent.id),
    });
    expect(resolution.payload.tiedPlayerIds).toEqual([b.id, c.id]);
    expect(resolution.payload.eliminatedId).toBe(b.id);
    expect(resolution.payload.tiebreakerId).toBe(resolution.payload.empoweredId);
    expect(resolution.payload.tiedPlayerIds).toContain(resolution.payload.eliminatedId);
  });

  it("runs Even Votes through the shared sealed path with exact parity eligibility", async () => {
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const [a, b, c, d, e] = agents;
    if (!a || !b || !c || !d || !e) throw new Error("expected five agents");
    const targets = new Map([
      [a.id, b.id],
      [b.id, a.id],
      [c.id, a.id],
      [d.id, a.id],
      [e.id, a.id],
    ]);
    for (const agent of agents) {
      agent.getEvenVotesBallot = async () => ({
        targetId: targets.get(agent.id)!,
        thinking: "force a sole highest-even target",
        decisionSource: "llm",
        fallbackReason: null,
      });
    }

    const runner = new GameRunner(
      agents,
      { ...TEST_CONFIG, maxRounds: 1, formatManifest: ["even_votes"] },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await runner.run();

    const canonical = runner.getCanonicalEvents();
    const resolution = canonical.find((event) => event.type === "format.resolved");
    if (!resolution || resolution.type !== "format.resolved") {
      throw new Error("expected Even Votes resolution");
    }
    expect(canonical.filter((event) => event.type === "format.menu_offered")).toHaveLength(0);
    expect(resolution.payloadVersion).toBe(2);
    expect(resolution.payload).toMatchObject({
      formatId: "even_votes",
      eliminatedId: a.id,
      resolutionKind: "auto",
      tiedPlayerIds: [a.id],
      tiebreakerId: null,
      aggregate: {
        capability: "sealed_elim",
        totals: {
          [a.id]: 4,
          [b.id]: 1,
          [c.id]: 0,
          [d.id]: 0,
          [e.id]: 0,
        },
        eligiblePlayerIds: [a.id, c.id, d.id, e.id],
      },
    });
    expect(canonical.filter((event) => event.type === "format.ballot_cast")).toHaveLength(5);
    expect(canonical.filter((event) => event.type === "player.eliminated")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ playerId: a.id }),
      }),
    ]);
  });

  it("retains only an agent's own ballot receipt before resolution and reveals peers afterward", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
      ],
      { gameId: "format-agent-ballot-boundary", now: () => 1_700_000_000_000 },
    );
    state.startRound();
    state.recordFormatMenu("alice", ["vote_bomb", "save_or_eliminate"]);
    state.recordFormatSelected("alice", "vote_bomb");
    state.recordFormatBallot({ formatId: "vote_bomb", voterId: "bob", targetId: "charlie" });
    state.recordFormatBallot({ formatId: "vote_bomb", voterId: "alice", targetId: "bob" });

    const builder = new ContextBuilder(
      state,
      new TranscriptLogger(state),
      new Map(),
      3,
    );
    const aliceSealed = builder.buildPhaseContext("alice", Phase.FORMAT_RESOLVE);
    const charlieSealed = builder.buildPhaseContext("charlie", Phase.FORMAT_RESOLVE);
    const aliceBallotLines = aliceSealed.gameEventRecord?.filter((line) =>
      line.includes("format ballot"),
    ) ?? [];
    const charlieBallotLines = charlieSealed.gameEventRecord?.filter((line) =>
      line.includes("format ballot"),
    ) ?? [];

    expect(aliceBallotLines).toEqual([
      "R1/FORMAT_RESOLVE: Your format ballot: EXIT → Bob (sealed).",
    ]);
    expect(charlieBallotLines).toEqual([]);

    state.recordFormatBallot({
      formatId: "vote_bomb",
      voterId: "charlie",
      targetId: "bob",
    });
    state.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "alice",
      eliminatedId: "charlie",
      resolutionKind: "auto",
      tiedPlayerIds: ["charlie"],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { alice: 0, bob: 2, charlie: 1 },
        zeroSafePlayerIds: ["alice"],
      },
      safetyBounce: null,
    });

    const resolvedLines = builder
      .buildPhaseContext("charlie", Phase.FORMAT_RESOLVE)
      .gameEventRecord
      ?.filter((line) => line.includes("format ballot")) ?? [];
    expect(resolvedLines).toEqual([
      "R1/FORMAT_RESOLVE: Alice format ballot: EXIT → Bob.",
      "R1/FORMAT_RESOLVE: Bob format ballot: EXIT → Charlie.",
      "R1/FORMAT_RESOLVE: Charlie format ballot: EXIT → Bob.",
    ]);
  });

  it("uses only current-call format receipts and never a mutable stale receipt", async () => {
    const agents = ["A", "B", "C", "D", "E"].map((name) => new MockAgent(createUUID(), name));
    for (const agent of agents) {
      agent.pickRoundFormat = async (_ctx, offered) => ({
        formatId: offered[0],
        thinking: "direct format pick",
        decisionSource: "llm",
        fallbackReason: null,
        decisionId: `decision-format-${agent.id}`,
      });
    }

    const directRunner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await directRunner.run();

    const selected = directRunner.getCanonicalEvents().find(
      (event) => event.type === "format.selected",
    );
    expect(selected).toBeDefined();
    if (!selected || selected.type !== "format.selected") throw new Error("expected format.selected");
    expect(selected.sourcePointers).toContainEqual(
      expect.objectContaining({
        actorId: selected.payload.empoweredId,
        action: "format-pick",
        decisionId: `decision-format-${selected.payload.empoweredId}`,
      }),
    );

    const staleAgents = ["F", "G", "H", "I", "J"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    for (const agent of staleAgents) {
      agent.pickRoundFormat = undefined as never;
      Object.assign(agent, {
        getLastPrivateDecisionId: () => `stale-decision-${agent.id}`,
      });
    }
    const fallbackRunner = new GameRunner(
      staleAgents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await fallbackRunner.run();

    const fallbackSelected = fallbackRunner.getCanonicalEvents().find(
      (event) => event.type === "format.selected",
    );
    expect(fallbackSelected).toBeDefined();
    expect(fallbackSelected?.sourcePointers).toHaveLength(1);
    expect(fallbackSelected?.sourcePointers[0]).not.toHaveProperty("decisionId");
  });

  it("commits the seeded second format when provider exhaustion falls back", async () => {
    const agents = [
      new MockAgent("empowered-a", "A"),
      new MockAgent("voter-b", "B"),
      new MockAgent("voter-c", "C"),
      new MockAgent("voter-d", "D"),
      new MockAgent("voter-e", "E"),
    ];
    for (const agent of agents) {
      agent.pickRoundFormat = async () => {
        throw Object.setPrototypeOf(
          new Error("provider exhausted"),
          ProviderAttemptError.prototype,
        );
      };
    }
    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
      },
      undefined,
      { gameId: "format-seed-1", maxRoundsMode: "exact" },
    );

    await runner.run();

    const menu = runner.getCanonicalEvents().find(
      (event) => event.type === "format.menu_offered",
    );
    const selected = runner.getCanonicalEvents().find(
      (event) => event.type === "format.selected",
    );
    expect(menu?.payload.offeredFormatIds).toHaveLength(2);
    expect(selected?.payload.formatId).toBe(menu?.payload.offeredFormatIds[1]);
    expect(selected?.sourcePointers).toEqual([
      expect.objectContaining({
        actorId: "empowered-a",
        action: "format-pick",
        engineFallback: {
          source: "engine",
          reason: "provider_exhausted",
          seed: "format-seed-1:1:FORMAT_PICK:empowered-a:format-pick",
        },
      }),
    ]);
  });

  it("honors an exact two-round cap before an 8-player game reaches endgame", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 2,
        formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );

    const result = await runner.run();
    const formatResolves = result.transcript.filter(
      (entry) =>
        entry.phase === Phase.FORMAT_RESOLVE &&
        entry.scope === "system" &&
        entry.text.startsWith("=== FORMAT RESOLVE"),
    );

    expect(result.rounds).toBe(2);
    expect(formatResolves).toHaveLength(2);
    expect(result.eliminationOrder).toHaveLength(2);
    expect(result.winner).toBeUndefined();
    expect(
      result.transcript.some((entry) =>
        [Phase.PLEA, Phase.ACCUSATION, Phase.OPENING_STATEMENTS].includes(entry.phase),
      ),
    ).toBe(false);
  });

  it("completes every registered format through an explicit one-format manifest", async () => {
    for (const formatId of LAUNCH_FORMAT_IDS.filter((id) => id !== "restricted_history")) {
      const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
        (name) => new MockAgent(createUUID(), `${formatId}-${name}`),
      );
      const events: GameStreamEvent[] = [];
      const runner = new GameRunner(
        agents,
        { ...TEST_CONFIG, maxRounds: 1, formatManifest: [formatId] },
        undefined,
        { maxRoundsMode: "exact" },
      );
      runner.setStreamListener((event) => events.push(event));
      await runner.run();

      const canonical = runner.getCanonicalEvents();
      expect(canonical.filter((event) => event.type === "format.menu_offered"), formatId)
        .toHaveLength(0);
      expect(canonical.filter((event) => event.type === "format.selected"), formatId)
        .toEqual([expect.objectContaining({ payload: { empoweredId: expect.any(String), formatId } })]);
      const resolutions = canonical.filter((event) => event.type === "format.resolved");
      expect(resolutions, formatId).toHaveLength(1);
      const eliminatedId = resolutions[0]?.payload.eliminatedId;
      expect(typeof eliminatedId, formatId).toBe("string");
      expect(resolutions[0], formatId).toMatchObject({
        payloadVersion: 2,
        payload: { formatId },
      });
      const eliminations = canonical.filter((event) => event.type === "player.eliminated");
      expect(eliminations, formatId).toHaveLength(1);
      expect(eliminations[0]?.payload.playerId, formatId)
        .toBe(eliminatedId);

      const agentTurns = events.filter((event) => event.type === "agent_turn");
      if (formatId === "safety_bounce") {
        expect(agentTurns.some((event) => event.action === "bounce-pointer"), formatId).toBe(true);
      }
      const ballots = agentTurns.filter(
        (event) => event.action === "format-ballot" && event.response.formatId === formatId,
      );
      expect(ballots.length, formatId).toBeGreaterThan(0);
      expect(ballots.every((ballot) => ballot.visibility === "private"), formatId).toBe(true);
    }
  });

  it("admits Restricted History only in round 3 and resolves it through the sealed path", async () => {
    const agents = ["A", "B", "C", "D", "E", "F", "G"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    let restrictedCalls = 0;
    for (const agent of agents) {
      agent.pickRoundFormat = async (context, offered) => ({
        formatId: context.round >= 3 && offered.includes("restricted_history")
          ? "restricted_history"
          : offered[0]!,
        thinking: "exercise the round-gated format",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getRestrictedHistoryBallot = async (_context, legalTargetIds) => {
        restrictedCalls += 1;
        return {
          targetId: legalTargetIds[0]!,
          thinking: "choose from the canonical Restricted History target set",
          decisionSource: "llm",
          fallbackReason: null,
        };
      };
    }

    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 3,
        formatManifest: ["majority_elimination", "restricted_history"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await runner.run();

    const selections = runner.getCanonicalEvents().filter(
      (event) => event.type === "format.selected",
    );
    expect(selections.filter((event) => event.round < 3).every(
      (event) => event.payload.formatId !== "restricted_history",
    )).toBe(true);
    expect(selections.find((event) => event.round === 3)?.payload.formatId)
      .toBe("restricted_history");
    const resolution = runner.getCanonicalEvents().find(
      (event) => event.type === "format.resolved" && event.round === 3,
    );
    expect(resolution).toMatchObject({
      payloadVersion: 2,
      payload: {
        formatId: "restricted_history",
        aggregate: {
          capability: "sealed_elim",
          totals: expect.any(Object),
          eligiblePlayerIds: expect.any(Array),
        },
      },
    });
    const restrictedBallots = runner.getCanonicalEvents().filter(
      (event): event is Extract<
        (typeof event),
        { type: "format.ballot_cast" }
      > => event.type === "format.ballot_cast"
        && event.round === 3
        && event.payload.formatId === "restricted_history",
    );
    expect(restrictedBallots.length).toBeGreaterThan(0);
    expect(restrictedCalls).toBe(restrictedBallots.length);
    for (const ballot of restrictedBallots) {
      const priorTargets = runner.getCanonicalEvents().flatMap((event) =>
        event.type === "format.ballot_cast"
          && event.round < 3
          && event.payload.voterId === ballot.payload.voterId
          && event.payload.polarity !== "save"
          ? [event.payload.targetId]
          : []
      );
      expect(priorTargets).not.toContain(ballot.payload.targetId);
    }
  });

  it("uses the normal empowered menu and pick for a two-format manifest", async () => {
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    for (const agent of agents) {
      agent.pickRoundFormat = async () => ({
        formatId: "majority_elimination",
        thinking: "pick Majority Elimination from the focused pair",
        decisionSource: "llm",
        fallbackReason: null,
      });
    }
    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        formatManifest: ["vote_bomb", "majority_elimination"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );
    await runner.run();

    const canonical = runner.getCanonicalEvents();
    expect(canonical.filter((event) => event.type === "format.menu_offered")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          offeredFormatIds: expect.arrayContaining(["vote_bomb", "majority_elimination"]),
        }),
      }),
    ]);
    expect(canonical.filter((event) => event.type === "format.selected")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ formatId: "majority_elimination" }),
      }),
    ]);
    expect(canonical.filter((event) => event.type === "format.resolved")).toEqual([
      expect.objectContaining({
        payloadVersion: 2,
        payload: expect.objectContaining({ formatId: "majority_elimination" }),
      }),
    ]);
  });

  it("keeps House phase telemetry content-free while canonical sealed decisions remain engine-owned", async () => {
    const agents = ["A", "B", "C", "D", "E"].map((name) => new MockAgent(createUUID(), name));
    for (const agent of agents) {
      agent.pickRoundFormat = async (_ctx, offered) => ({
        formatId: offered.includes("vote_bomb") ? "vote_bomb" : offered[0],
        thinking: "mock: pick vote bomb",
        decisionSource: "llm",
        fallbackReason: null,
      });
    }
    const events: GameStreamEvent[] = [];
    const runner = new GameRunner(
      agents,
      {
        ...TEST_CONFIG,
        maxRounds: 1,
        formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
      },
      undefined,
      { maxRoundsMode: "exact" },
    );
    runner.setStreamListener((event) => events.push(event));
    await runner.run();

    const houseMc = events.find(
      (event) => event.type === "agent_turn" && event.action === "house-mc-summary",
    );
    expect(houseMc).toBeDefined();
    if (!houseMc || houseMc.type !== "agent_turn") throw new Error("expected house-mc-summary");
    expect(houseMc.visibility).toBe("system");
    expect(houseMc.response).toEqual({ summary: expect.any(String) });
    expect(houseMc.response).not.toHaveProperty("roundFacts");
    const resolutionTelemetry = events.find(
      (event) => event.type === "agent_turn"
        && event.action === "house-summary-phase-telemetry"
        && (event.response.telemetry as { actorCoordinate?: string } | undefined)?.actorCoordinate === "format_resolve",
    );
    expect(resolutionTelemetry).toBeDefined();
    if (!resolutionTelemetry || resolutionTelemetry.type !== "agent_turn") {
      throw new Error("expected format_resolve telemetry");
    }
    expect(resolutionTelemetry.visibility).toBe("private");
    expect(resolutionTelemetry.response.telemetry).toMatchObject({
      status: "emitted",
      providerCalls: expect.any(Number),
      usage: expect.any(Array),
    });
    expect(resolutionTelemetry.response.telemetry).not.toHaveProperty("sources");
    expect(resolutionTelemetry.response.telemetry).not.toHaveProperty("claims");
    expect(resolutionTelemetry.response.telemetry).not.toHaveProperty("selectedSourceCount");

    const canonical = runner.getCanonicalEvents();
    const resolution = canonical.find(
      (event) => event.type === "format.resolved" && event.round === 1,
    );
    expect(resolution).toBeDefined();
    if (!resolution || resolution.type !== "format.resolved") {
      throw new Error("expected canonical format resolution");
    }
    expect(["save_or_eliminate", "vote_bomb", "safety_bounce"]).toContain(
      resolution.payload.formatId,
    );
    expect(resolution.payload.eliminatedId).toBeTruthy();

    // Canonical events retain every sealed decision independently of whatever
    // the House chooses to say to viewers.
    const sealedDecisions = canonical.filter((event) =>
      event.round === 1
      && (event.type === "format.ballot_cast" || event.type === "format.safety_bounce_pointer")
    );
    expect(sealedDecisions.length).toBeGreaterThan(0);
    const voters = new Set(sealedDecisions.flatMap((event) => {
      if (event.type === "format.ballot_cast") return [event.payload.voterId];
      if (event.type === "format.safety_bounce_pointer") return [event.payload.actorId];
      return [];
    }));
    expect(voters.size).toBe(5);

    // Resume-shaped hydration rebuilds the same authoritative projection from
    // the event log; no House-specific facts or in-memory bag participates.
    const resumed = GameState.fromCanonicalEvents(canonical);
    expect(resumed.getCanonicalEvents()).toEqual(canonical);
    expect(replayCanonicalEvents(resumed.getCanonicalEvents())).toEqual(
      replayCanonicalEvents(canonical),
    );
  });

  it("completes a short game using format menu/pick/mingle/resolve without Power or Council", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const formatMingleContexts: PhaseContext[] = [];
    for (const agent of agents) {
      const takeMingleTurn = agent.takeMingleTurn.bind(agent);
      agent.takeMingleTurn = async (ctx, roomMates, conversationHistory) => {
        if (ctx.phase === Phase.FORMAT_MINGLE) formatMingleContexts.push(ctx);
        return takeMingleTurn(ctx, roomMates, conversationHistory);
      };
    }
    // Force Vote Bomb for predictability on first pick
    const first = agents[0]!;
    first.pickRoundFormat = async (_ctx, offered) => ({
      formatId: offered.includes("vote_bomb") ? "vote_bomb" : offered[0],
      thinking: "force vote bomb when offered",
      decisionSource: "llm",
      fallbackReason: null,
    });

    const runner = new GameRunner(agents, {
      ...TEST_CONFIG,
      formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
    });
    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));
    const result = await runner.run();

    expect(result.winner).toBeTruthy();
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_MENU)).toBe(true);
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_PICK)).toBe(true);
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_MINGLE)).toBe(true);
    expect(result.transcript.some((e) => e.phase === Phase.FORMAT_RESOLVE)).toBe(true);

    const canonical = runner.getCanonicalEvents();
    const offeredMenus = canonical.filter((event) => event.type === "format.menu_offered");
    expect(offeredMenus.length).toBeGreaterThan(0);
    expect(offeredMenus[0]).toMatchObject({
      phase: Phase.FORMAT_MENU,
      visibility: "public",
      payload: { offeredFormatIds: expect.any(Array) },
    });
    const selected = canonical.filter((event) => event.type === "format.selected");
    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0]).toMatchObject({
      phase: Phase.FORMAT_PICK,
      visibility: "public",
      payload: { formatId: expect.any(String) },
    });
    const resolved = canonical.filter((event) => event.type === "format.resolved");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0]).toMatchObject({
      phase: Phase.FORMAT_RESOLVE,
      visibility: "public",
      payload: {
        formatId: expect.any(String),
        eliminatedId: expect.any(String),
      },
    });
    // Ballot envelopes retain producer provenance, while viewer reads receive their
    // sanitized ledger projection without private traces.
    const ballots = canonical.filter((event) => event.type === "format.ballot_cast");
    expect(ballots.length).toBeGreaterThan(0);
    expect(ballots.every((event) => event.visibility === "producer")).toBe(true);
    expect(selected.every((event) => event.visibility === "public")).toBe(true);
    // While a format is locked (after menu + select, before next round.started clears menu), projection carries selectedFormatId.
    const firstSelected = selected[0]!;
    if (firstSelected.type !== "format.selected") throw new Error("expected format.selected");
    const throughFirstPick = canonical.filter((event) => event.sequence <= firstSelected.sequence);
    const pickProjection = replayCanonicalEvents(throughFirstPick);
    expect(pickProjection.formatMenu?.selectedFormatId).toBe(firstSelected.payload.formatId);
    expect(pickProjection.formatMenu?.offeredFormatIds).toHaveLength(2);

    // Classic elimination engine should not appear on the default path
    const powerActions = result.transcript.filter(
      (e) => e.phase === Phase.POWER && typeof e.text === "string" && e.text.includes("power action"),
    );
    expect(powerActions).toHaveLength(0);

    const formatLocks = result.transcript.filter(
      (e) => e.scope === "system" && typeof e.text === "string" && e.text.startsWith("FORMAT LOCKED:"),
    );
    expect(formatLocks.length).toBeGreaterThan(0);

    const formatExitLines = result.transcript.filter(
      (e) => e.scope === "system" && typeof e.text === "string" && e.text.includes("exited under"),
    );
    expect(formatExitLines.length).toBeGreaterThan(0);
    const systemTranscript = result.transcript
      .filter((entry) => entry.scope === "system")
      .map((entry) => entry.text)
      .join("\n");
    expect(systemTranscript).not.toMatch(
      /Save-or-Eliminate|Vote Bomb|Majority Elimination/,
    );

    const formatMinglePressure = formatMingleContexts[0]?.formatPressure;
    expect(formatMinglePressure?.offeredFormats).toHaveLength(2);
    expect(formatMinglePressure?.selectedFormat).toBeTruthy();
    expect(formatMinglePressure?.ruleSheetSummary).toBeTruthy();
    expect(formatMinglePressure).not.toHaveProperty("targetId");
    expect(formatMinglePressure).not.toHaveProperty("ballots");

    const formatDecisionTurns = events.filter(
      (entry) =>
        entry.type === "agent_turn" &&
        ["format-pick", "format-ballot", "bounce-pointer", "format-tiebreak"].includes(entry.action),
    );
    expect(formatDecisionTurns.length).toBeGreaterThan(0);
    for (const turn of formatDecisionTurns) {
      if (turn.type !== "agent_turn") continue;
      expect(turn.response.decisionSource === "llm" || turn.response.decisionSource === "fallback").toBe(true);
      expect(turn.response).toHaveProperty("fallbackReason");
    }
  });

  it("rotates offered formats across rounds via anti-repeat", async () => {
    const agents = ["A", "B", "C", "D", "E", "F"].map((name) => new MockAgent(createUUID(), name));
    const chosen: LaunchFormatId[] = [];
    for (const agent of agents) {
      agent.pickRoundFormat = async (_ctx, offered) => {
        const formatId = offered[0] as LaunchFormatId;
        chosen.push(formatId);
        return {
          formatId,
          thinking: "pick first",
          decisionSource: "llm",
          fallbackReason: null,
        };
      };
    }

    const runner = new GameRunner(agents, {
      ...TEST_CONFIG,
      maxRounds: 4,
      formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
    });
    await runner.run();

    // At least two format picks should have occurred before endgame (6 -> 4 after 2 elims)
    expect(chosen.length).toBeGreaterThanOrEqual(2);
    // Hard anti-repeat: consecutive picks must differ when menu enforces non-last pair
    for (let i = 1; i < chosen.length; i++) {
      expect(chosen[i]).not.toBe(chosen[i - 1]);
    }
  });

  it("marks phase-level repairs as fallback even when an agent claims LLM provenance", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    for (const agent of agents) {
      agent.pickRoundFormat = async () => ({
        formatId: "not_offered",
        thinking: "claim an unavailable format",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getSaveOrEliminateBallot = async () => ({
        polarity: "save",
        targetId: "not-alive",
        thinking: "claim an invalid sealed ballot",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getVoteBombBallot = async () => ({
        targetId: "not-alive",
        thinking: "claim an invalid Vote Bomb target",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getBouncePointer = async () => ({
        targetId: "not-alive",
        thinking: "claim an invalid bounce pointer",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getSafetyBounceVote = async () => ({
        targetId: "not-alive",
        thinking: "claim an invalid vulnerable vote",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.breakFormatEliminationTie = async () => ({
        targetId: "not-alive",
        thinking: "claim an invalid tie target",
        decisionSource: "llm",
        fallbackReason: null,
      });
    }

    const runner = new GameRunner(agents, {
      ...TEST_CONFIG,
      formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
    });
    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));
    await runner.run();
    const pickRepair = events.find(
      (entry) => entry.type === "agent_turn" && entry.action === "format-pick",
    );
    expect(pickRepair?.type === "agent_turn" ? pickRepair.response : null).toMatchObject({
      decisionSource: "fallback",
      fallbackReason: "invalid_format_choice",
    });

    const playRepair = events.find(
      (entry) =>
        entry.type === "agent_turn" &&
        ["format-ballot", "bounce-pointer", "format-tiebreak"].includes(entry.action) &&
        entry.response.decisionSource === "fallback",
    );
    expect(playRepair?.type === "agent_turn" ? playRepair.response.fallbackReason : null).toBeTruthy();
  });

  it("repairs self-target sealed ballots and records fallback provenance", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    // Force Save-or-Eliminate every round so self-ballot path is exercised.
    for (const agent of agents) {
      agent.pickRoundFormat = async (_ctx, offered) => ({
        formatId: offered.includes("save_or_eliminate") ? "save_or_eliminate" : offered[0]!,
        thinking: "force SoE for self-ballot test",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getSaveOrEliminateBallot = async (ctx) => ({
        polarity: "eliminate",
        targetId: ctx.selfId,
        thinking: "illegal self-elim claim",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getVoteBombBallot = async (ctx) => ({
        targetId: ctx.selfId,
        thinking: "illegal self-bomb claim",
        decisionSource: "llm",
        fallbackReason: null,
      });
      agent.getSafetyBounceVote = async (ctx) => ({
        targetId: ctx.selfId,
        thinking: "illegal self-bounce vote claim",
        decisionSource: "llm",
        fallbackReason: null,
      });
    }

    const runner = new GameRunner(agents, {
      ...TEST_CONFIG,
      maxRounds: 1,
      formatManifest: ["save_or_eliminate"],
    });
    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));
    await runner.run();

    const ballots = events.filter(
      (entry) => entry.type === "agent_turn" && entry.action === "format-ballot",
    );
    expect(ballots.length).toBeGreaterThan(0);
    for (const entry of ballots) {
      if (entry.type !== "agent_turn") continue;
      expect(entry.response.targetId).not.toBe(entry.actor?.id);
      expect(entry.response.decisionSource).toBe("fallback");
      expect(
        entry.response.fallbackReason === "invalid_save_or_eliminate_ballot"
          || entry.response.fallbackReason === "invalid_vote_bomb_target"
          || entry.response.fallbackReason === "invalid_safety_bounce_target",
      ).toBe(true);
    }
  });
});
