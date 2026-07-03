import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { runMingleIAlliancePhase } from "../phases/alliances";
import type { PhaseActor, PhaseRunnerContext } from "../phases/phase-runner-context";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG } from "../types";
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
  const phaseCompleteEvents: unknown[] = [];
  const actor = {
    send(event: unknown) {
      phaseCompleteEvents.push(event);
    },
  } as unknown as PhaseActor;
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

  return { gameState, logger, agents, actor, ctx, phaseCompleteEvents };
}

describe("Mingle I alliance action runner", () => {
  it("forms an official alliance from a proposal and same-version acceptance", async () => {
    const { gameState, agents, actor, ctx, phaseCompleteEvents } = createActionHarness();
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
    });
    agents.get("bob")!.allianceActions.push({
      action: "accept",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      thinking: "mock: accept Alice's proposal",
    });

    await runMingleIAlliancePhase(ctx, actor);

    expect(gameState.getAlliance("alliance-ab")).toMatchObject({
      id: "alliance-ab",
      status: "active",
      memberIds: ["alice", "bob"],
    });
    expect(phaseCompleteEvents).toContainEqual({ type: "PHASE_COMPLETE" });
    expect(gameState.getCanonicalEvents().map((event) => event.type)).toContain("alliance.activated");
  });

  it("resolves invited responses before the next proposer and rejects exact duplicate rosters", async () => {
    const { gameState, logger, agents, actor, ctx } = createActionHarness();
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

    await runMingleIAlliancePhase(ctx, actor);

    expect(gameState.getAlliance("alliance-ab")).toMatchObject({ status: "active" });
    expect(gameState.getAlliance("alliance-ab-duplicate")).toBeUndefined();
    expect(
      gameState.getCanonicalEvents().filter((event) => event.type === "alliance.proposal_submitted"),
    ).toHaveLength(1);
    expect(rejectedNotes.flat().join(" ")).toContain("same member roster");
  });

  it("closes declined proposals and still lets later proposers act", async () => {
    const { gameState, agents, actor, ctx } = createActionHarness();
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

    await runMingleIAlliancePhase(ctx, actor);

    expect(gameState.getAllianceProposalLineage("lineage-ab-declined")).toMatchObject({ status: "declined" });
    expect(gameState.getAlliance("alliance-ab-declined")).toBeUndefined();
    expect(gameState.getAlliance("alliance-ac-after-decline")).toMatchObject({ status: "active" });
  });

  it("expires deferred proposals and still lets the deferring player use their proposer turn", async () => {
    const { gameState, agents, actor, ctx } = createActionHarness();
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

    await runMingleIAlliancePhase(ctx, actor);

    expect(gameState.getAllianceProposalLineage("lineage-ab-deferred")).toMatchObject({ status: "expired" });
    expect(gameState.getAlliance("alliance-ab-deferred")).toBeUndefined();
    expect(gameState.getAlliance("alliance-bc-after-defer")).toMatchObject({ status: "active" });
  });

  it("treats trial responses as consent for the current proposal version", async () => {
    const { gameState, agents, actor, ctx } = createActionHarness();
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

    await runMingleIAlliancePhase(ctx, actor);

    expect(gameState.getAllianceProposalLineage("lineage-ab-trial")).toMatchObject({ status: "activated" });
    expect(gameState.getAlliance("alliance-ab-trial")).toMatchObject({
      status: "active",
      timebox: "through vote",
    });
  });

  it("allows two counters, rejects a third, and expires unresolved lineages at window end", async () => {
    const { gameState, agents, actor, ctx } = createActionHarness();
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

    await runMingleIAlliancePhase(ctx, actor);

    const lineage = gameState.getAllianceProposalLineage("lineage-cap");
    expect(lineage?.status).toBe("expired");
    expect(lineage?.versions.map((version) => version.versionId)).toEqual([
      "version-1",
      "version-2",
      "version-3",
    ]);
    expect(gameState.getAlliance("alliance-cap")).toBeUndefined();
  });

  it("rejects invalid or self-only rosters deterministically", async () => {
    const { gameState, logger, agents, actor, ctx } = createActionHarness();
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

    await runMingleIAlliancePhase(ctx, actor);

    expect(gameState.getAllianceProposalLineage("lineage-invalid")).toBeUndefined();
    expect(
      gameState.getCanonicalEvents().some((event) => event.type === "alliance.proposal_submitted"),
    ).toBe(false);
    expect(repairNotes.flat().join(" ")).toContain("fewer than two live members");
  });

  it("falls back to private pass actions when agents have no queued alliance move", async () => {
    const { logger, actor, ctx } = createActionHarness();
    const turns: string[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-action") {
        turns.push(String(event.response.requestedAction));
      }
    });

    await runMingleIAlliancePhase(ctx, actor);

    expect(turns).toEqual(["pass", "pass", "pass"]);
  });
});
