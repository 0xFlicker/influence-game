import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { runAllianceHuddleWindow } from "../phases/alliances";
import type { PhaseActor, PhaseRunnerContext } from "../phases/phase-runner-context";
import type { AllianceHuddlePromptContext, AllianceHuddleTurnAction, PhaseContext } from "../game-runner.types";
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

class RespondingHuddleAgent extends MockAgent {
  override async getAllianceHuddleTurn(
    _ctx: PhaseContext,
    huddle: AllianceHuddlePromptContext,
  ): Promise<AllianceHuddleTurnAction> {
    const counterpart = huddle.priorFacts[0];
    if (!counterpart) return super.getAllianceHuddleTurn(_ctx, huddle);
    return {
      thinking: "Endorse the accepted typed proposal.",
      message: "I endorse that plan.",
      noReply: false,
      factAtoms: [{
        kind: "response",
        actorPlayerId: this.id,
        counterpartFactId: counterpart.factId,
        stance: "endorse",
        confidence: "high",
      }],
      strategyDelta: null,
    };
  }
}

describe("named alliance huddle windows", () => {
  it("derives stable session and fact IDs for accepted response replay", async () => {
    const run = async () => {
      const { gameState, actor, ctx } = createHuddleHarness();
      activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
      ctx.agents.set("bob", new RespondingHuddleAgent("bob", "Bob"));
      await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);
      return gameState.getAllianceHuddleOutcomes()[0]!;
    };

    const first = await run();
    const replayed = await run();
    expect(replayed.sessionId).toBe(first.sessionId);
    expect(replayed.id).toBe(first.id);
    expect(replayed.facts.map((fact) => fact.factId)).toEqual(
      first.facts.map((fact) => fact.factId),
    );
    expect(replayed.facts[1]).toMatchObject({
      kind: "response",
      counterpartFactId: replayed.facts[0]?.factId,
    });
  });

  it("schedules active alliances within budget, skips the rest, and records outcomes", async () => {
    const { gameState, logger, actor, ctx, phaseCompleteEvents } = createHuddleHarness();
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    activatePair(gameState, "alliance-cd", "lineage-cd", "version-cd", "charlie", "dana");
    activatePair(gameState, "alliance-ef", "lineage-ef", "version-ef", "echo", "finn");

    const scheduleTurns: Array<{ decision: unknown; allianceId: unknown }> = [];
    const huddleTurns: string[] = [];
    const houseOutcomeOrdinals: number[] = [];
    const summarizeAllianceHuddle = ctx.houseInterviewer.summarizeAllianceHuddle.bind(ctx.houseInterviewer);
    ctx.houseInterviewer.summarizeAllianceHuddle = async (context) => {
      houseOutcomeOrdinals.push(context.providerLogicalCallOrdinal);
      return summarizeAllianceHuddle(context);
    };
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

    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);

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
    const huddleEntries = logger.transcript.filter((entry) => entry.scope === "huddle");
    expect(huddleEntries.map((entry) => entry.from)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
      "Dana",
    ]);
    // Session identity exists before messages; two same-roster-style huddles get distinct session context.
    const sessionIds = new Set(huddleEntries.map((entry) => entry.dialogueContext?.sessionId));
    expect(sessionIds.size).toBe(2);
    for (const entry of huddleEntries) {
      expect(entry.entrySequence).toBeGreaterThan(0);
      expect(entry.dialogueKind).toBe("huddle_speech");
      expect(entry.speakerPlayerId).toBeTruthy();
      expect(entry.audiencePlayerIds?.length).toBe(2);
      expect(entry.dialogueContext?.allianceId).toBeTruthy();
      expect(entry.dialogueContext?.scheduleId).toBeTruthy();
      expect(entry.dialogueContext?.sessionId).toBeTruthy();
      expect(entry.dialogueContext?.sessionAudiencePlayerIds?.length).toBe(2);
    }
    expect(gameState.getAllianceHuddleOutcomes()).toHaveLength(2);
    expect(houseOutcomeOrdinals).toEqual([1, 2]);
    expect(gameState.getAllianceHuddleOutcomes()[0]).toMatchObject({
      facts: expect.any(Array),
      participantPlayerIds: ["alice", "bob"],
    });
    expect(gameState.getAllianceHuddleOutcomes()[0]?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "proposal",
        actorPlayerId: "alice",
        actionKind: "format_ballot",
        targetPlayerId: "bob",
      }),
    ]));
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

  it("omits an exhausted optional huddle turn without transcript, agent turn, or commitment", async () => {
    const { gameState, logger, actor, ctx } = createHuddleHarness();
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    const alice = ctx.agents.get("alice")!;
    alice.getAllianceHuddleTurn = async () => ({
      message: null,
      noReply: true,
      factAtoms: [],
      providerAbsence: { kind: "provider_exhausted", outcome: "refusal" },
    });
    const turns: string[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-huddle-turn" && event.actor.id) {
        turns.push(event.actor.id);
      }
    });

    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);

    expect(logger.transcript.some((entry) => entry.scope === "huddle" && entry.from === "Alice")).toBe(false);
    expect(turns).not.toContain("alice");
    expect((gameState.getAllianceHuddleOutcomes()[0]?.facts ?? []).some(
      (fact) => fact.actorPlayerId === "alice",
    )).toBe(false);
  });

  it("records an explicit empty fact set even when House interpretation invents a shared plan", async () => {
    const { gameState, logger, actor, ctx } = createHuddleHarness();
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    for (const playerId of ["alice", "bob"]) {
      ctx.agents.get(playerId)!.getAllianceHuddleTurn = async () => ({
        message: null,
        noReply: true,
        factAtoms: [],
      });
    }
    const baseHouse = ctx.houseInterviewer;
    baseHouse.summarizeAllianceHuddle = async () => ({
      ask: "Target Charlie.",
      plan: "Alice and Bob unanimously promised to target Charlie.",
      promises: ["Both players promised the vote."],
      dissent: [],
      confidence: "high",
      posture: "locked",
      leakOrBetrayalClaims: ["Bob leaked the plan."],
    });
    const outcomeTurns: Array<Record<string, unknown>> = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-huddle-outcome") {
        outcomeTurns.push(event.response);
      }
    });

    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);

    const outcome = gameState.getAllianceHuddleOutcomes()[0]!;
    expect(outcome.facts).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain("Charlie");
    expect(outcomeTurns[0]?.interpretation).toMatchObject({
      plan: "Alice and Bob unanimously promised to target Charlie.",
    });
    const event = gameState.getCanonicalEvents().find(
      (candidate) => candidate.type === "alliance.huddle_outcome_recorded",
    );
    if (!event || event.type !== "alliance.huddle_outcome_recorded" || event.payloadVersion !== 2) {
      throw new Error("expected huddle outcome v2 event");
    }
    expect(event.payload.outcome.facts).toEqual([]);
  });

  it("rechecks owner authority after House summary before accepting a huddle outcome", async () => {
    const { gameState, logger, actor, ctx } = createHuddleHarness();
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    const baseHouse = ctx.houseInterviewer;
    let houseSummaryReturned = false;
    let outcomeEmitted = false;
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-huddle-outcome") {
        outcomeEmitted = true;
      }
    });
    ctx.houseInterviewer = {
      planAllianceHuddles: baseHouse.planAllianceHuddles.bind(baseHouse),
      summarizeAllianceHuddle: async (context) => {
        const result = await baseHouse.summarizeAllianceHuddle(context);
        houseSummaryReturned = true;
        return result;
      },
    } as PhaseRunnerContext["houseInterviewer"];
    ctx.beforeAcceptedCommit = () => {
      if (houseSummaryReturned) throw new Error("owner lease lost after House summary");
    };

    await expect(runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE))
      .rejects.toThrow("owner lease lost after House summary");

    expect(gameState.getAllianceHuddleOutcomes()).toEqual([]);
    expect(outcomeEmitted).toBe(false);
  });

  it("repairs invalid House picks and runs huddles pass-wise with max two sessions per alliance", async () => {
    const { gameState, logger, actor, ctx } = createHuddleHarness(LARGE_PLAYER_ROSTER);
    activatePair(gameState, "alliance-ab", "lineage-ab", "version-ab", "alice", "bob");
    activatePair(gameState, "alliance-cd", "lineage-cd", "version-cd", "charlie", "dana");
    const baseHouse = ctx.houseInterviewer;
    const houseOutcomeOrdinals: number[] = [];
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
      summarizeAllianceHuddle: async (context) => {
        houseOutcomeOrdinals.push(context.providerLogicalCallOrdinal);
        return baseHouse.summarizeAllianceHuddle(context);
      },
    } as PhaseRunnerContext["houseInterviewer"];
    const huddleTurns: string[] = [];
    logger.setStreamListener((event) => {
      if (event.type === "agent_turn" && event.action === "alliance-huddle-turn" && event.actor.id) {
        huddleTurns.push(event.actor.id);
      }
    });

    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);

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
    expect(houseOutcomeOrdinals).toEqual([1, 2, 3]);
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

    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);

    expect(gameState.getAlliance("alliance-everyone")).toMatchObject({
      status: "closed",
      closedReason: "universal_all_alive_before_mingle",
    });
    expect(gameState.getAllianceHuddleSchedules()).toEqual([]);
  });
});
