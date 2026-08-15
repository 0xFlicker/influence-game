import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { runAllianceFormationPhase } from "../phases/alliances";
import type { PhaseRunnerContext } from "../phases/phase-runner-context";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import { MockAgent } from "./mock-agent";

const PLAYERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "charlie", name: "Charlie" },
];

function createActionHarness() {
  const gameState = new GameState(PLAYERS, {
    gameId: "game-alliance-actions",
    now: () => 1_700_000_000_000,
  });
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const mingleInbox = new Map();
  const contextBuilder = new ContextBuilder(gameState, logger, mingleInbox, PLAYERS.length);
  const agents = new Map(
    PLAYERS.map((player) => [player.id, new MockAgent(player.id, player.name)]),
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
    houseInterviewer: {},
  } as unknown as PhaseRunnerContext;

  return { gameState, logger, agents, ctx };
}

describe("Format Mingle alliance action runner", () => {
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
    const { gameState, logger, agents, ctx } = createActionHarness();
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
    const { gameState, agents, ctx } = createActionHarness();
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
    const { gameState, agents, ctx } = createActionHarness();
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

    expect(turns).toEqual(["pass", "pass", "pass"]);
  });
});
