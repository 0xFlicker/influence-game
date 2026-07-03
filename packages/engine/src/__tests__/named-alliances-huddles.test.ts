import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { runAllianceHuddleWindow } from "../phases/alliances";
import type { PhaseActor, PhaseRunnerContext } from "../phases/phase-runner-context";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import { MockAgent } from "./mock-agent";

const PLAYERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "charlie", name: "Charlie" },
  { id: "dana", name: "Dana" },
  { id: "echo", name: "Echo" },
  { id: "finn", name: "Finn" },
  { id: "gale", name: "Gale" },
  { id: "harper", name: "Harper" },
];

const LARGE_PLAYER_ROSTER = [
  ...PLAYERS,
  { id: "ian", name: "Ian" },
  { id: "jules", name: "Jules" },
  { id: "kai", name: "Kai" },
  { id: "luz", name: "Luz" },
];

function createHuddleHarness(players = PLAYERS) {
  const gameState = new GameState(players, {
    gameId: "game-alliance-huddles",
    now: () => 1_700_000_000_000,
  });
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const mingleInbox = new Map();
  const contextBuilder = new ContextBuilder(gameState, logger, mingleInbox, players.length);
  const agents = new Map(
    players.map((player) => [player.id, new MockAgent(player.id, player.name)]),
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
    houseInterviewer: new TemplateHouseInterviewer(),
  } as unknown as PhaseRunnerContext;

  return { gameState, logger, actor, ctx, phaseCompleteEvents };
}

function activatePair(gameState: GameState, allianceId: string, lineageId: string, versionId: string, a: string, b: string) {
  gameState.recordAllianceProposal({
    allianceId,
    lineageId,
    versionId,
    proposerId: a,
    name: allianceId,
    memberIds: [a, b],
    purpose: "Coordinate this window.",
    timebox: null,
  });
  gameState.recordAllianceResponse({
    lineageId,
    versionId,
    playerId: b,
    response: "accepted",
  });
}

describe("named alliance huddle windows", () => {
  it("schedules active alliances within budget, skips the rest, and records outcomes", async () => {
    const { gameState, logger, actor, ctx, phaseCompleteEvents } = createHuddleHarness();
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    activatePair(gameState, "alliance-cd", "lineage-cd", "version-cd", "charlie", "dana");
    activatePair(gameState, "alliance-ef", "lineage-ef", "version-ef", "echo", "finn");

    const scheduleTurns: Array<{ decision: unknown; allianceId: unknown }> = [];
    const huddleTurns: string[] = [];
    logger.setStreamListener((event) => {
      if (event.type !== "agent_turn") return;
      if (event.action === "alliance-huddle-schedule") {
        scheduleTurns.push({
          decision: event.response.decision,
          allianceId: event.response.allianceId,
        });
      }
      if (event.action === "alliance-huddle-turn" && event.actor.id) {
        huddleTurns.push(event.actor.id);
      }
    });

    await runAllianceHuddleWindow(ctx, actor, Phase.PRE_VOTE_HUDDLE);

    expect(gameState.getAllianceHuddleSchedules().map((schedule) => schedule.decision)).toEqual([
      "scheduled",
      "scheduled",
      "skipped",
    ]);
    expect(scheduleTurns).toEqual([
      { decision: "scheduled", allianceId: "alliance-ab" },
      { decision: "scheduled", allianceId: "alliance-cd" },
      { decision: "skipped", allianceId: "alliance-ef" },
    ]);
    expect(huddleTurns).toEqual(["alice", "bob", "charlie", "dana"]);
    expect(logger.transcript.filter((entry) => entry.scope === "huddle").map((entry) => entry.from)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
      "Dana",
    ]);
    expect(gameState.getAllianceHuddleOutcomes()).toHaveLength(2);
    expect(gameState.getAllianceHuddleOutcomes()[0]).toMatchObject({
      posture: "coordinating",
      confidence: "medium",
    });
    expect(gameState.getAlliance("alliance-ab")?.huddleOutcomeIds).toHaveLength(1);
    expect(phaseCompleteEvents).toContainEqual({ type: "PHASE_COMPLETE" });
  });

  it("allows The House to grant fewer huddles than the maximum budget", async () => {
    const { gameState, actor, ctx } = createHuddleHarness();
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    activatePair(gameState, "alliance-cd", "lineage-cd", "version-cd", "charlie", "dana");
    ctx.houseInterviewer = {
      ...ctx.houseInterviewer,
      planAllianceHuddles: async () => ({
        scheduled: [],
        skipped: [
          { allianceId: "alliance-ab", rationale: "No current decision relevance." },
          { allianceId: "alliance-cd", rationale: "No current decision relevance." },
        ],
        rationale: "The House intentionally saved the huddle budget.",
      }),
    } as PhaseRunnerContext["houseInterviewer"];

    await runAllianceHuddleWindow(ctx, actor, Phase.PRE_COUNCIL_HUDDLE);

    expect(gameState.getAllianceHuddleSchedules().map((schedule) => schedule.decision)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(gameState.getAllianceHuddleOutcomes()).toEqual([]);
  });

  it("repairs invalid House picks and runs huddles pass-wise with max two sessions per alliance", async () => {
    const { gameState, logger, actor, ctx } = createHuddleHarness(LARGE_PLAYER_ROSTER);
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    activatePair(gameState, "alliance-cd", "lineage-cd", "version-cd", "charlie", "dana");
    const baseHouse = ctx.houseInterviewer;
    ctx.houseInterviewer = {
      ...baseHouse,
      planAllianceHuddles: async () => ({
        scheduled: [
          { allianceId: "alliance-ab", rationale: "First pass for the visible pair." },
          { allianceId: "missing-alliance", rationale: "Invalid House output." },
          { allianceId: "alliance-ab", rationale: "Second pass for follow-up." },
        ],
        skipped: [],
        rationale: "The House tried to spend the scarce huddle window.",
      }),
      summarizeAllianceHuddle: baseHouse.summarizeAllianceHuddle.bind(baseHouse),
    } as PhaseRunnerContext["houseInterviewer"];
    const huddleTurns: string[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-huddle-turn" && event.actor.id) {
        huddleTurns.push(event.actor.id);
      }
    });

    await runAllianceHuddleWindow(ctx, actor, Phase.PRE_VOTE_HUDDLE);

    expect(gameState.getAllianceHuddleSchedules().map((schedule) => ({
      allianceId: schedule.allianceId,
      pass: schedule.pass,
      decision: schedule.decision,
    }))).toEqual([
      { allianceId: "alliance-ab", pass: 1, decision: "scheduled" },
      { allianceId: "alliance-cd", pass: 1, decision: "scheduled" },
      { allianceId: "alliance-ab", pass: 2, decision: "scheduled" },
    ]);
    expect(huddleTurns).toEqual(["alice", "bob", "charlie", "dana", "alice", "bob"]);
    expect(gameState.getAllianceHuddleOutcomes()).toHaveLength(3);
  });

  it("closes universal alliances before huddle eligibility", async () => {
    const { gameState, actor, ctx } = createHuddleHarness();
    gameState.recordAllianceProposal({
      allianceId: "alliance-everyone",
      lineageId: "lineage-everyone",
      versionId: "version-everyone",
      proposerId: "alice",
      name: "Everyone",
      memberIds: PLAYERS.map((player) => player.id),
      purpose: "Pretend everyone is together.",
      timebox: null,
    });
    for (const player of PLAYERS.filter((player) => player.id !== "alice")) {
      gameState.recordAllianceResponse({
        lineageId: "lineage-everyone",
        versionId: "version-everyone",
        playerId: player.id,
        response: "accepted",
      });
    }

    await runAllianceHuddleWindow(ctx, actor, Phase.PRE_VOTE_HUDDLE);

    expect(gameState.getAlliance("alliance-everyone")).toMatchObject({
      status: "closed",
      closedReason: "universal_all_alive_before_mingle",
    });
    expect(gameState.getAllianceHuddleSchedules()).toEqual([]);
  });
});
