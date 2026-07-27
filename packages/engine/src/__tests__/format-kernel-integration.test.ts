import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import type { GameStreamEvent } from "../game-runner";
import type { GameConfig } from "../types";
import { Phase } from "../types";
import { createUUID } from "../game-state";
import { MockAgent } from "./mock-agent";
import {
  buildHouseFormatResolutionFacts,
  LAUNCH_FORMAT_IDS,
  type LaunchFormatId,
} from "../formats";
import type { PhaseContext } from "../game-runner";
import { GameState } from "../game-state";
import { replayCanonicalEvents } from "../game-projection";
import { ContextBuilder } from "../context-builder";
import { TranscriptLogger } from "../transcript-logger";

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
      "R1/FORMAT_RESOLVE: Your format ballot: eliminate → Bob (sealed).",
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
      resolutionKind: "clear",
      tiedPlayerIds: [],
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
      "R1/FORMAT_RESOLVE: Alice format ballot: eliminate → Bob.",
      "R1/FORMAT_RESOLVE: Bob format ballot: eliminate → Charlie.",
      "R1/FORMAT_RESOLVE: Charlie format ballot: eliminate → Bob.",
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
      { ...TEST_CONFIG, maxRounds: 1 },
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
      { ...TEST_CONFIG, maxRounds: 1 },
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

  it("honors an exact two-round cap before an 8-player game reaches endgame", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const runner = new GameRunner(
      agents,
      { ...TEST_CONFIG, maxRounds: 2 },
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

  it("exercises every launch format through GameRunner with its action visibility and one elimination", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const selectedFormats: LaunchFormatId[] = [];
    for (const agent of agents) {
      agent.pickRoundFormat = async (_ctx, offered) => {
        const formatId = offered.find((id) => !selectedFormats.includes(id)) ?? offered[0];
        selectedFormats.push(formatId);
        return {
          formatId,
          thinking: `cover ${formatId}`,
          decisionSource: "llm",
          fallbackReason: null,
        };
      };
    }

    const runner = new GameRunner(
      agents,
      { ...TEST_CONFIG, maxRounds: 3 },
      undefined,
      { maxRoundsMode: "exact" },
    );
    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));
    const result = await runner.run();

    expect(new Set(selectedFormats)).toEqual(new Set(LAUNCH_FORMAT_IDS));
    expect(selectedFormats).toHaveLength(LAUNCH_FORMAT_IDS.length);

    const agentTurns = events.filter((event) => event.type === "agent_turn");
    for (const formatId of LAUNCH_FORMAT_IDS) {
      const pick = agentTurns.find(
        (event) =>
          event.action === "format-pick" &&
          event.visibility === "public" &&
          event.response.selectedFormat === formatId,
      );
      expect(pick).toBeDefined();
      if (!pick) continue;

      if (formatId === "safety_bounce") {
        expect(
          agentTurns.some(
            (event) =>
              event.round === pick.round &&
              event.action === "bounce-pointer" &&
              event.visibility === "public",
          ),
        ).toBe(true);
      }
      const sealedBallots = agentTurns.filter(
        (event) =>
          event.round === pick.round &&
          event.action === "format-ballot" &&
          event.visibility === "private" &&
          event.response.formatId === formatId,
      );
      expect(sealedBallots.length).toBeGreaterThan(0);
      // Operator/sim traces must name the sealed choice (player-facing sealed ≠ operator redaction).
      for (const ballot of sealedBallots) {
        expect(typeof ballot.text).toBe("string");
        expect(ballot.text).toContain("sealed ballot:");
        expect(ballot.text).toContain("→");
        expect(typeof ballot.response.targetName).toBe("string");
        expect(String(ballot.response.targetName).length).toBeGreaterThan(0);
      }

      const resolveMarkers = result.transcript.filter(
        (entry) =>
          entry.round === pick.round &&
          entry.phase === Phase.FORMAT_RESOLVE &&
          entry.scope === "system" &&
          entry.text.startsWith("=== FORMAT RESOLVE (") && entry.text.includes(formatId),
      );
      const eliminations = events.filter(
        (event) => event.type === "player_eliminated" && event.round === pick.round,
      );
      const eliminationMessage = agentTurns.find(
        (event) =>
          event.round === pick.round &&
          event.action === "elimination-message",
      );
      expect(resolveMarkers).toHaveLength(1);
      expect(eliminations).toHaveLength(1);
      expect(eliminationMessage).toBeDefined();
      const disclosure = eliminationMessage?.response.voteDisclosure as
        | { visibility?: string; voterNames?: string[] }
        | undefined;
      if (formatId === "safety_bounce") {
        expect(
          disclosure?.visibility === "sealed" || disclosure?.visibility === "none",
        ).toBe(true);
      } else {
        expect(disclosure?.visibility).toBe("sealed");
      }
      expect(disclosure).not.toHaveProperty("voterNames");
    }

    expect(result.eliminationOrder).toHaveLength(LAUNCH_FORMAT_IDS.length);
  });

  it("feeds House MC omniscient sealed format ballots via roundFacts.formatResolution", async () => {
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
    const runner = new GameRunner(agents, { ...TEST_CONFIG, maxRounds: 1 }, undefined, {
      maxRoundsMode: "exact",
    });
    runner.setStreamListener((event) => events.push(event));
    await runner.run();

    const houseMc = events.find(
      (event) => event.type === "agent_turn" && event.action === "house-mc-summary",
    );
    expect(houseMc).toBeDefined();
    if (!houseMc || houseMc.type !== "agent_turn") throw new Error("expected house-mc-summary");
    const roundFacts = houseMc.response.roundFacts as {
      eliminationPath?: string;
      formatResolution?: {
        formatId: string;
        ballots: Array<{ voterName: string; targetName: string }>;
        bouncePointers?: Array<{ actorName: string; targetName: string }>;
        scores: Array<{ playerName: string; value: number }>;
        eliminatedName: string;
      } | null;
    };
    expect(roundFacts.eliminationPath).toBe("format");
    const resolution = roundFacts.formatResolution;
    expect(resolution).toBeTruthy();
    if (!resolution) throw new Error("expected formatResolution");
    expect(["save_or_eliminate", "vote_bomb", "safety_bounce"]).toContain(resolution.formatId);
    // House omniscient: sealed ballots (or bounce chain) fully present for MC.
    const ballotCount = resolution.ballots.length;
    const bounceCount = resolution.bouncePointers?.length ?? 0;
    expect(ballotCount + bounceCount).toBeGreaterThan(0);
    expect(resolution.eliminatedName.length).toBeGreaterThan(0);
    if (ballotCount > 0) {
      expect(ballotCount).toBe(5);
      const voters = new Set(resolution.ballots.map((b) => b.voterName));
      expect(voters.size).toBe(5);
    }

    // R14 option A: House facts rebuild from durable events with no in-memory bag.
    const rebuilt = buildHouseFormatResolutionFacts(
      runner.getCanonicalEvents(),
      1,
      (playerId) => {
        const player = runner.getDomainProjection().players[playerId];
        return player?.name ?? playerId;
      },
    );
    expect(rebuilt).not.toBeNull();
    if (!rebuilt) throw new Error("expected rebuilt formatResolution");
    expect(rebuilt.formatId).toBe(resolution.formatId);
    expect(rebuilt.eliminatedName).toBe(resolution.eliminatedName);
    expect(rebuilt.ballots.length).toBe(resolution.ballots.length);
    expect(rebuilt.scores.length).toBe(resolution.scores.length);

    // Resume-shaped hydration: only the event log, no lastFormatResolution bag.
    const resumed = GameState.fromCanonicalEvents(runner.getCanonicalEvents());
    const afterResume = buildHouseFormatResolutionFacts(
      resumed.getCanonicalEvents(),
      1,
      (playerId) => resumed.getPlayerName(playerId),
    );
    expect(afterResume).toEqual(rebuilt);
  });

  it("completes a short game using format menu/pick/mingle/resolve without Power or Council", async () => {
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const formatMingleContexts: PhaseContext[] = [];
    for (const agent of agents) {
      const getMingleIntent = agent.getMingleIntent.bind(agent);
      agent.getMingleIntent = async (ctx) => {
        if (ctx.phase === Phase.FORMAT_MINGLE) formatMingleContexts.push(ctx);
        return getMingleIntent(ctx);
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

    const runner = new GameRunner(agents, TEST_CONFIG);
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

    const formatElines = result.transcript.filter(
      (e) => e.scope === "system" && typeof e.text === "string" && e.text.includes("Format ") && e.text.includes("eliminated"),
    );
    expect(formatElines.length).toBeGreaterThan(0);

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

    const runner = new GameRunner(agents, { ...TEST_CONFIG, maxRounds: 4 });
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

    const runner = new GameRunner(agents, TEST_CONFIG);
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

    const runner = new GameRunner(agents, { ...TEST_CONFIG, maxRounds: 1 });
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
