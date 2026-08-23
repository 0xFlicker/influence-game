import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import type { GameStreamEvent } from "../game-runner";
import { GameState } from "../game-state";
import type {
  HouseAllianceProposerSelectionContext,
  HouseAllianceProposerSelectionResult,
} from "../house-interviewer";
import { runAllianceFormationPhase } from "../phases/alliances";
import type { PhaseRunnerContext } from "../phases/phase-runner-context";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import { MockAgent, ScriptedHouseInterviewer } from "./mock-agent";

const PLAYERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "charlie", name: "Charlie" },
];

const FIVE_PLAYERS = [
  ...PLAYERS,
  { id: "dana", name: "Dana" },
  { id: "echo", name: "Echo" },
];

function proposerSelection(
  playerIds: string[],
  rationale = "Scripted House proposer selection.",
): HouseAllianceProposerSelectionResult {
  return {
    selected: playerIds.map((playerId) => ({
      playerId,
      rationale: `Scripted House selected ${playerId}.`,
    })),
    rationale,
    thinking: "Scripted private producer thinking.",
  };
}

class RejectingHouseInterviewer extends ScriptedHouseInterviewer {
  override async selectAllianceProposers(
    context: HouseAllianceProposerSelectionContext,
  ): Promise<HouseAllianceProposerSelectionResult> {
    this.allianceProposerSelectionContexts.push({
      ...context,
      candidates: context.candidates.map((candidate) => ({ ...candidate })),
    });
    throw new Error("scripted House selection rejection");
  }
}

function createActionHarness(options: {
  players?: Array<{ id: string; name: string }>;
  selection?: HouseAllianceProposerSelectionResult;
  house?: ScriptedHouseInterviewer;
} = {}) {
  const players = options.players ?? PLAYERS;
  const house = options.house ?? new ScriptedHouseInterviewer([
    options.selection ?? proposerSelection(["alice"]),
  ]);
  const gameState = new GameState(players, {
    gameId: "game-alliance-actions",
    now: () => 1_700_000_000_000,
  });
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const mingleInbox = new Map();
  const contextBuilder = new ContextBuilder(gameState, logger, mingleInbox, players.length);
  const agents = new Map(
    players.map((player) => [player.id, new MockAgent(player.id, player.name)]),
  );
  const ctx = {
    gameState,
    agents,
    config: DEFAULT_CONFIG,
    logger,
    contextBuilder,
    mingleInbox,
    eliminationOrder: [],
    diaryRoom: {},
    houseInterviewer: house,
  } as unknown as PhaseRunnerContext;

  return { gameState, logger, agents, house, ctx };
}

function activatePair(
  gameState: GameState,
  allianceId: string,
  lineageId: string,
  versionId: string,
  firstPlayerId: string,
  secondPlayerId: string,
): void {
  gameState.recordAllianceProposal({
    allianceId,
    lineageId,
    versionId,
    proposerId: firstPlayerId,
    name: allianceId,
    memberIds: [firstPlayerId, secondPlayerId],
    purpose: "Existing active alliance representation.",
    timebox: null,
  }, { phase: Phase.FORMAT_MINGLE });
  gameState.recordAllianceResponse({
    lineageId,
    versionId,
    playerId: secondPlayerId,
    response: "accepted",
  }, { phase: Phase.FORMAT_MINGLE });
}

describe("Format Mingle alliance action runner", () => {
  it("repairs a rejected House call to the exact budget and emits one private selection", async () => {
    const house = new RejectingHouseInterviewer();
    const { logger, agents, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      house,
    });
    const selectionTurns: Array<Extract<GameStreamEvent, { type: "agent_turn" }>> = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-proposer-selection") {
        selectionTurns.push(event);
      }
    });

    await runAllianceFormationPhase(ctx);

    expect(house.allianceProposerSelectionContexts).toHaveLength(1);
    expect(selectionTurns).toHaveLength(1);
    expect(selectionTurns[0]).toMatchObject({
      visibility: "private",
      actor: { name: "The House", role: "house" },
      response: {
        budget: 2,
        rationale: "House proposer selection failed; deterministic repair applied (scripted House selection rejection).",
      },
    });
    expect((selectionTurns[0]!.response.selected as Array<{ playerId: string }>).map((item) => item.playerId)).toEqual([
      "alice",
      "bob",
    ]);
    expect(agents.get("alice")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("bob")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("charlie")!.allianceOpportunities).toEqual([]);
    expect(agents.get("dana")!.allianceOpportunities).toEqual([]);
    expect(agents.get("echo")!.allianceOpportunities).toEqual([]);
  });

  it("counts overlapping active memberships separately and excludes open or closed records", async () => {
    const { gameState, house, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["dana", "echo"]),
    });
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    activatePair(gameState, "alliance-ac", "lineage-ac", "version-ac", "alice", "charlie");
    activatePair(gameState, "alliance-de", "lineage-de", "version-de", "dana", "echo");
    gameState.closeAlliance("alliance-de", "manual", Phase.FORMAT_MINGLE);
    gameState.recordAllianceProposal({
      allianceId: "alliance-bd-open",
      lineageId: "lineage-bd-open",
      versionId: "version-bd-open",
      proposerId: "bob",
      name: "Bob Dana Open",
      memberIds: ["bob", "dana"],
      purpose: "Open proposal must not count as active representation.",
      timebox: null,
    }, { phase: Phase.FORMAT_MINGLE });

    await runAllianceFormationPhase(ctx);

    expect(house.allianceProposerSelectionContexts[0]?.candidates).toEqual([
      { playerId: "alice", playerName: "Alice", activeAllianceCount: 2 },
      { playerId: "bob", playerName: "Bob", activeAllianceCount: 1 },
      { playerId: "charlie", playerName: "Charlie", activeAllianceCount: 1 },
      { playerId: "dana", playerName: "Dana", activeAllianceCount: 0 },
      { playerId: "echo", playerName: "Echo", activeAllianceCount: 0 },
    ]);
  });

  it("rejects stale ownership after House planning and before selection evidence or proposer calls", async () => {
    const { logger, agents, house, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["alice", "bob"]),
    });
    let fenceCalls = 0;
    ctx.beforeAcceptedCommit = () => {
      fenceCalls += 1;
      if (fenceCalls === 2) throw new Error("stale execution owner after House planning");
    };
    const selectionTurns: GameStreamEvent[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-proposer-selection") {
        selectionTurns.push(event);
      }
    });

    await expect(runAllianceFormationPhase(ctx)).rejects.toThrow("stale execution owner after House planning");

    expect(fenceCalls).toBe(2);
    expect(house.allianceProposerSelectionContexts).toHaveLength(1);
    expect(selectionTurns).toEqual([]);
    expect([...agents.values()].flatMap((agent) => agent.allianceOpportunities)).toEqual([]);
  });

  it("repairs duplicate, unknown, and eliminated selections to the exact underrepresentation-first budget", async () => {
    const players = [...FIVE_PLAYERS, { id: "finn", name: "Finn" }];
    const { gameState, logger, agents, house, ctx } = createActionHarness({
      players,
      selection: {
        selected: [
          { playerId: "dana", rationale: "Dana has no active alliance." },
          { playerId: "dana", rationale: "Duplicate Dana selection." },
          { playerId: "ghost", rationale: "Unknown player selection." },
          { playerId: "finn", rationale: "Eliminated player selection." },
        ],
        rationale: "House prioritized Dana among the unrepresented players.",
        thinking: "Private House selection rationale.",
      },
    });
    gameState.eliminatePlayer("finn");
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    const selectionTurns: Array<Extract<GameStreamEvent, { type: "agent_turn" }>> = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-proposer-selection") {
        selectionTurns.push(event);
      }
    });

    await runAllianceFormationPhase(ctx);

    expect(house.allianceProposerSelectionContexts).toHaveLength(1);
    expect(house.allianceProposerSelectionContexts[0]).toMatchObject({
      round: 1,
      phase: Phase.FORMAT_MINGLE,
      budget: 2,
      candidates: [
        { playerId: "alice", playerName: "Alice", activeAllianceCount: 1 },
        { playerId: "bob", playerName: "Bob", activeAllianceCount: 1 },
        { playerId: "charlie", playerName: "Charlie", activeAllianceCount: 0 },
        { playerId: "dana", playerName: "Dana", activeAllianceCount: 0 },
        { playerId: "echo", playerName: "Echo", activeAllianceCount: 0 },
      ],
    });
    expect(agents.get("charlie")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("dana")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("alice")!.allianceOpportunities).toEqual([]);
    expect(agents.get("bob")!.allianceOpportunities).toEqual([]);
    expect(agents.get("echo")!.allianceOpportunities).toEqual([]);
    expect(agents.get("finn")!.allianceOpportunities).toEqual([]);

    expect(selectionTurns).toHaveLength(1);
    expect(selectionTurns[0]).toMatchObject({
      actor: { name: "The House", role: "house" },
      visibility: "private",
      response: {
        budget: 2,
        rationale: "House prioritized Dana among the unrepresented players.",
      },
    });
    expect((selectionTurns[0]!.response.selected as Array<{ playerId: string }>).map((item) => item.playerId)).toEqual([
      "charlie",
      "dana",
    ]);
    const repairText = (selectionTurns[0]!.response.repairNotes as string[]).join(" ").toLowerCase();
    expect(repairText).toContain("duplicate");
    expect(repairText).toContain("unknown");
    expect(repairText).toContain("eliminated");
    expect(
      gameState.getCanonicalEvents().some((event) => event.type.includes("proposer")),
    ).toBe(false);
  });

  it("caps excess valid House selections while preserving stable living-roster execution order", async () => {
    const { agents, house, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["echo", "charlie", "dana"], "House returned one excess valid selection."),
    });

    await runAllianceFormationPhase(ctx);

    expect(house.allianceProposerSelectionContexts[0]?.budget).toBe(2);
    expect(agents.get("charlie")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("echo")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("alice")!.allianceOpportunities).toEqual([]);
    expect(agents.get("bob")!.allianceOpportunities).toEqual([]);
    expect(agents.get("dana")!.allianceOpportunities).toEqual([]);
  });

  it("keeps invitee response independent and later gives a selected invitee its proposer opportunity", async () => {
    const { gameState, agents, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["bob", "alice"], "Select Alice and Bob as the two-seat access set."),
    });
    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-abc",
      lineageId: "lineage-abc",
      versionId: "version-abc",
      name: "Alice Bob Charlie",
      memberNames: ["Alice", "Bob", "Charlie"],
      purpose: "Prove selected and unselected invitees use the same consent transaction.",
      timebox: null,
    });
    agents.get("bob")!.allianceActions.push(
      {
        action: "accept",
        lineageId: "lineage-abc",
        versionId: "version-abc",
      },
      {
        action: "propose",
        allianceId: "alliance-bd",
        lineageId: "lineage-bd",
        versionId: "version-bd",
        name: "Bob Dana",
        memberNames: ["Bob", "Dana"],
        purpose: "Use Bob's later proposer opportunity.",
        timebox: null,
      },
    );
    agents.get("charlie")!.allianceActions.push({
      action: "accept",
      lineageId: "lineage-abc",
      versionId: "version-abc",
    });
    agents.get("dana")!.allianceActions.push({
      action: "accept",
      lineageId: "lineage-bd",
      versionId: "version-bd",
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAlliance("alliance-abc")).toMatchObject({
      status: "active",
      memberIds: ["alice", "bob", "charlie"],
    });
    expect(gameState.getAlliance("alliance-bd")).toMatchObject({
      status: "active",
      memberIds: ["bob", "dana"],
    });
    expect(agents.get("alice")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents.get("bob")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual([
      "response",
      "proposer",
    ]);
    expect(agents.get("charlie")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["response"]);
    expect(agents.get("dana")!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["response"]);
    expect(agents.get("echo")!.allianceOpportunities).toEqual([]);
    expect(
      gameState.getCanonicalEvents().filter((event) => event.type === "alliance.proposal_submitted"),
    ).toHaveLength(2);
    expect(
      gameState.getCanonicalEvents().filter((event) => event.type === "alliance.activated"),
    ).toHaveLength(2);
  });

  it("binds an invited response to the current proposal instead of trusting supplied identifiers", async () => {
    const { gameState, logger, agents, ctx } = createActionHarness();
    const serializedResponses: string[] = [];
    const strategyResults: unknown[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-action") {
        serializedResponses.push(JSON.stringify(event.response));
        strategyResults.push(event.strategyResult);
      }
    });
    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      name: "Alice Bob",
      memberNames: ["Alice", "Bob"],
      purpose: "Vote together before Council.",
      timebox: "round one",
      thinking: "mock: propose to Bob",
      strategyDelta: "Keep Bob close if he accepts this deal.",
      decisionId: "decision-propose-ab",
    });
    agents.get("bob")!.allianceActions.push({
      action: "accept",
      lineageId: "mistyped-lineage",
      versionId: "mistyped-version",
      thinking: "mock: accept Alice's proposal",
      decisionId: "decision-accept-ab",
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAlliance("alliance-ab")).toMatchObject({
      id: "alliance-ab",
      status: "active",
      memberIds: ["alice", "bob"],
    });
    expect(gameState.getCanonicalEvents().map((event) => event.type)).toContain("alliance.activated");
    const proposal = gameState.getCanonicalEvents().find(
      (event) => event.type === "alliance.proposal_submitted",
    );
    const response = gameState.getCanonicalEvents().find(
      (event) => event.type === "alliance.response_recorded",
    );
    const activation = gameState.getCanonicalEvents().find(
      (event) => event.type === "alliance.activated",
    );
    expect(proposal?.sourcePointers[0]?.decisionId).toBe("decision-propose-ab");
    expect(response?.sourcePointers[0]?.decisionId).toBe("decision-accept-ab");
    expect(activation?.sourcePointers).toEqual([]);
    expect(serializedResponses.join("\n")).not.toContain("strategyDelta");
    expect(serializedResponses.join("\n")).not.toContain("Keep Bob close if he accepts this deal.");
    expect(strategyResults).toContainEqual(expect.objectContaining({
      status: "accepted",
      operation: "delta",
      resultingRevision: 1,
    }));
  });

  it("permits an active-alliance amendment and resolves its consent transaction", async () => {
    const { gameState, agents, ctx } = createActionHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Vote together.",
      timebox: "this round",
    }, { phase: Phase.FORMAT_MINGLE });
    gameState.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    }, { phase: Phase.FORMAT_MINGLE });

    agents.get("alice")!.allianceActions.push({
      action: "amend",
      allianceId: "alliance-ab",
      name: "Alice Bob Charlie",
      memberNames: ["Alice", "Bob", "Charlie"],
      purpose: "Expand the voting agreement.",
      timebox: "this round",
    });
    agents.get("bob")!.allianceActions.push({
      action: "accept",
      lineageId: "provider-bob-lineage",
      versionId: "provider-bob-version",
    });
    agents.get("charlie")!.allianceActions.push({
      action: "accept",
      lineageId: "provider-charlie-lineage",
      versionId: "provider-charlie-version",
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAlliance("alliance-ab")).toMatchObject({
      status: "active",
      name: "Alice Bob Charlie",
      memberIds: ["alice", "bob", "charlie"],
    });
  });

  it("resolves invited responses before the next proposer and rejects exact duplicate rosters", async () => {
    const { gameState, logger, agents, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["alice", "bob"]),
    });
    const rejectedNotes: string[][] = [];
    logger.setStreamListener((event) => {
      if (
        event.type === "agent_turn"
        && event.action === "alliance-action"
        && event.response.result === "rejected"
      ) {
        rejectedNotes.push(event.response.repairNotes as string[]);
      }
    });

    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      name: "Alice Bob",
      memberNames: ["Alice", "Bob"],
      purpose: "Vote together before Council.",
      timebox: "round one",
    });
    agents.get("bob")!.allianceActions.push(
      {
        action: "accept",
        lineageId: "lineage-ab",
        versionId: "version-ab",
      },
      {
        action: "propose",
        allianceId: "alliance-ab-duplicate",
        lineageId: "lineage-ab-duplicate",
        versionId: "version-ab-duplicate",
        name: "Alice Bob Again",
        memberNames: ["Bob", "Alice"],
        purpose: "Duplicate the same deal.",
        timebox: "round one",
      },
    );

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAlliance("alliance-ab")).toMatchObject({ status: "active" });
    expect(gameState.getAlliance("alliance-ab-duplicate")).toBeUndefined();
    expect(
      gameState.getCanonicalEvents().filter((event) => event.type === "alliance.proposal_submitted"),
    ).toHaveLength(1);
    expect(rejectedNotes.flat().join(" ")).toContain("same member roster");
  });

  it("closes declined proposals and still lets later proposers act", async () => {
    const { gameState, agents, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["alice", "charlie"]),
    });
    agents.get("alice")!.allianceActions.push(
      {
        action: "propose",
        allianceId: "alliance-ab-declined",
        lineageId: "lineage-ab-declined",
        versionId: "version-ab-declined",
        name: "Alice Bob Declined",
        memberNames: ["Alice", "Bob"],
        purpose: "Test a declined proposal.",
        timebox: null,
      },
      {
        action: "accept",
        lineageId: "lineage-ac-after-decline",
        versionId: "version-ac-after-decline",
      },
    );
    agents.get("bob")!.allianceActions.push({
      action: "decline",
      lineageId: "lineage-ab-declined",
      versionId: "version-ab-declined",
    });
    agents.get("charlie")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-ac-after-decline",
      lineageId: "lineage-ac-after-decline",
      versionId: "version-ac-after-decline",
      name: "Alice Charlie After Decline",
      memberNames: ["Alice", "Charlie"],
      purpose: "Later proposer should still get a turn.",
      timebox: null,
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAllianceProposalLineage("lineage-ab-declined")).toMatchObject({ status: "declined" });
    expect(gameState.getAlliance("alliance-ab-declined")).toBeUndefined();
    expect(gameState.getAlliance("alliance-ac-after-decline")).toMatchObject({ status: "active" });
  });

  it("expires deferred proposals and still lets the deferring player use their proposer turn", async () => {
    const { gameState, agents, ctx } = createActionHarness({
      players: FIVE_PLAYERS,
      selection: proposerSelection(["alice", "bob"]),
    });
    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-ab-deferred",
      lineageId: "lineage-ab-deferred",
      versionId: "version-ab-deferred",
      name: "Alice Bob Deferred",
      memberNames: ["Alice", "Bob"],
      purpose: "Test a deferred proposal.",
      timebox: null,
    });
    agents.get("bob")!.allianceActions.push(
      {
        action: "defer",
        lineageId: "lineage-ab-deferred",
        versionId: "version-ab-deferred",
      },
      {
        action: "propose",
        allianceId: "alliance-bc-after-defer",
        lineageId: "lineage-bc-after-defer",
        versionId: "version-bc-after-defer",
        name: "Bob Charlie After Defer",
        memberNames: ["Bob", "Charlie"],
        purpose: "Deferring does not consume the proposer opportunity.",
        timebox: null,
      },
    );
    agents.get("charlie")!.allianceActions.push({
      action: "accept",
      lineageId: "lineage-bc-after-defer",
      versionId: "version-bc-after-defer",
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAllianceProposalLineage("lineage-ab-deferred")).toMatchObject({ status: "expired" });
    expect(gameState.getAlliance("alliance-ab-deferred")).toBeUndefined();
    expect(gameState.getAlliance("alliance-bc-after-defer")).toMatchObject({ status: "active" });
  });

  it("treats trial responses as consent for the current proposal version", async () => {
    const { gameState, agents, ctx } = createActionHarness();
    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-ab-trial",
      lineageId: "lineage-ab-trial",
      versionId: "version-ab-trial",
      name: "Alice Bob Trial",
      memberNames: ["Alice", "Bob"],
      purpose: "Try a short-lived vote pact.",
      timebox: "through vote",
    });
    agents.get("bob")!.allianceActions.push({
      action: "trial",
      lineageId: "lineage-ab-trial",
      versionId: "version-ab-trial",
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAllianceProposalLineage("lineage-ab-trial")).toMatchObject({ status: "activated" });
    expect(gameState.getAlliance("alliance-ab-trial")).toMatchObject({
      status: "active",
      timebox: "through vote",
    });
  });

  it("allows two counters, rejects a third, and expires unresolved lineages at window end", async () => {
    const { gameState, agents, ctx } = createActionHarness();
    agents.get("alice")!.allianceActions.push(
      {
        action: "propose",
        allianceId: "alliance-cap",
        lineageId: "lineage-cap",
        versionId: "version-1",
        name: "Cap Test",
        memberNames: ["Alice", "Bob"],
        purpose: "Initial version.",
        timebox: null,
      },
      {
        action: "counter",
        lineageId: "lineage-cap",
        versionId: "version-3",
        name: "Cap Test",
        memberNames: ["Alice", "Bob"],
        purpose: "Second counter.",
        timebox: null,
      },
    );
    agents.get("bob")!.allianceActions.push(
      {
        action: "counter",
        lineageId: "lineage-cap",
        versionId: "version-2",
        name: "Cap Test",
        memberNames: ["Alice", "Bob"],
        purpose: "First counter.",
        timebox: null,
      },
      {
        action: "counter",
        lineageId: "lineage-cap",
        versionId: "version-4",
        name: "Cap Test",
        memberNames: ["Alice", "Bob"],
        purpose: "Third counter.",
        timebox: null,
      },
    );

    await runAllianceFormationPhase(ctx);

    const lineage = gameState.getAllianceProposalLineage("lineage-cap");
    expect(lineage?.status).toBe("expired");
    expect(lineage?.versions.map((version) => version.counterIndex)).toEqual([0, 1, 2]);
    expect(lineage?.versions[0]?.versionId).toBe("version-1");
    expect(lineage?.versions.slice(1).map((version) => version.versionId)).not.toContain("version-2");
    expect(lineage?.versions.slice(1).map((version) => version.versionId)).not.toContain("version-3");
    expect(lineage?.versions.map((version) => version.versionId)).not.toContain("version-4");
    expect(gameState.getAlliance("alliance-cap")).toBeUndefined();
  });

  it("rejects invalid or self-only rosters deterministically", async () => {
    const { gameState, logger, agents, ctx } = createActionHarness();
    const repairNotes: string[][] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-action") {
        repairNotes.push(event.response.repairNotes as string[]);
      }
    });
    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-invalid",
      lineageId: "lineage-invalid",
      versionId: "version-invalid",
      name: "Invalid",
      memberNames: ["Ghost"],
      purpose: "This should fail.",
      timebox: null,
    });

    await runAllianceFormationPhase(ctx);

    expect(gameState.getAllianceProposalLineage("lineage-invalid")).toBeUndefined();
    expect(
      gameState.getCanonicalEvents().some((event) => event.type === "alliance.proposal_submitted"),
    ).toBe(false);
    expect(repairNotes.flat().join(" ")).toContain("fewer than two live members");
  });

  it("records materially repaired membership without crediting the model receipt", async () => {
    const { gameState, agents, ctx } = createActionHarness();
    agents.get("alice")!.allianceActions.push({
      action: "propose",
      allianceId: "alliance-repaired",
      lineageId: "lineage-repaired",
      versionId: "version-repaired",
      name: "Repaired",
      memberNames: ["Bob", "Ghost"],
      purpose: "The unknown member must be dropped.",
      timebox: null,
      decisionId: "decision-materially-repaired",
    });
    agents.get("bob")!.allianceActions.push({
      action: "accept",
      lineageId: "lineage-repaired",
      versionId: "version-repaired",
    });

    await runAllianceFormationPhase(ctx);

    const proposal = gameState.getCanonicalEvents().find(
      (event) => event.type === "alliance.proposal_submitted",
    );
    expect(proposal).toBeDefined();
    expect(proposal?.sourcePointers[0]).not.toHaveProperty("decisionId");
  });

  it("falls back to private pass actions when agents have no queued alliance move", async () => {
    const { logger, ctx } = createActionHarness();
    const turns: string[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-action") {
        turns.push(String(event.response.requestedAction));
      }
    });

    await runAllianceFormationPhase(ctx);

    expect(turns).toEqual(["pass"]);
  });

  it("rethrows non-provider alliance action failures without accepting a fallback action", async () => {
    const { logger, agents, ctx } = createActionHarness();
    const alice = agents.get("alice")!;
    alice.allianceActionErrors.push(new Error("scripted proposer failure"));
    const turns: Array<{ action: unknown; result: unknown }> = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-action") {
        turns.push({
          action: event.response.requestedAction,
          result: event.response.result,
        });
      }
    });

    await expect(runAllianceFormationPhase(ctx)).rejects.toThrow("scripted proposer failure");

    expect(alice.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(turns).toEqual([]);
  });
});
