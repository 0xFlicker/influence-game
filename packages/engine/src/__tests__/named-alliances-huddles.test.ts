import { describe, expect, it } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { advanceHuddleConversation, beginAllianceHuddleWindow, runAllianceHuddleWindow } from "../phases/alliances";
import type { PhaseActor, PhaseRunnerContext } from "../phases/phase-runner-context";
import type { GameStreamEvent } from "../game-runner.types";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import { MockAgent } from "./mock-agent";
import { buildAllianceIntroductionContext } from "../alliance-introductions";

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
    formatKernelState: { selectedFormat: "vote_bomb", offeredFormats: null, pressure: null, lastSelectedFormat: null },
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

describe("private conversational alliance huddles", () => {
  it("authors a batch only after every selected conversation, without adding narration to contestant context", async () => {
    const { ctx, gameState, actor, logger, phaseCompleteEvents } = createHuddleHarness();
    activatePair(gameState, "ab", "lab", "vab", "alice", "bob");
    activatePair(gameState, "cd", "lcd", "vcd", "charlie", "dana");
    let calls = 0;
    class EditorialHouse extends TemplateHouseInterviewer {
      override async generateAllianceIntroductions(context: Parameters<TemplateHouseInterviewer["generateAllianceIntroductions"]>[0]) {
        calls++;
        expect(Object.values(gameState.getDomainProjection().allianceHuddleSessions)).toHaveLength(2);
        expect(phaseCompleteEvents).toEqual([]);
        expect(context.meetings).toHaveLength(2);
        expect(context.meetings.every(meeting => meeting.dialogue.length === 2)).toBeTrue();
        expect(context.canonicalEvents.some(event => event.type === "format.ballot_cast")).toBeFalse();
        return { introductions: context.meetings.map(meeting => ({ sessionId: meeting.sessionId, text: "Only viewers hear this secret teaser." })) };
      }
    }
    ctx.houseInterviewer = new EditorialHouse();
    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);
    expect(calls).toBe(1);
    const introductions = logger.transcript.filter(entry => entry.dialogueContext?.allianceIntroduction);
    expect(introductions).toHaveLength(2);
    for (const entry of introductions) {
      const metadata = entry.dialogueContext!.allianceIntroduction!;
      expect(entry.entrySequence!).toBeGreaterThan(metadata.beforeEntrySequence);
      expect(logger.transcript.find(row => row.entrySequence === metadata.beforeEntrySequence)?.dialogueContext?.sessionId).toBe(metadata.sessionId);
    }
    for (const player of PLAYERS) {
      expect(JSON.stringify(ctx.contextBuilder.buildPhaseContext(player.id, Phase.FORMAT_RESOLVE))).not.toContain("Only viewers hear");
    }
  });

  it("retrieves first- and second-degree alliance history by membership without following a third edge", async () => {
    const { ctx, gameState, actor } = createHuddleHarness();
    activatePair(gameState, "ab", "lab", "vab", "alice", "bob");
    activatePair(gameState, "bc", "lbc", "vbc", "bob", "charlie");
    activatePair(gameState, "cd", "lcd", "vcd", "charlie", "dana");
    activatePair(gameState, "de", "lde", "vde", "dana", "echo");
    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);
    const schedule = gameState.getAllianceHuddleSchedules().find(item => item.allianceId === "ab" && item.decision === "scheduled")!;
    const context = buildAllianceIntroductionContext(ctx, [schedule.id], Phase.FORMAT_MINGLE);
    expect(context.relatedAlliances.map(alliance => alliance.id).sort()).toEqual(["ab", "bc", "cd"]);
  });

  it("continues with large valid context while retaining the editorially relevant meaning", async () => {
    const { ctx, gameState, actor, logger } = createHuddleHarness();
    activatePair(gameState, "ab", "lab", "vab", "alice", "bob");
    const longHistory = "Alice promised Bob support, but another pact competes with that promise. ".repeat(8_000);
    logger.logPublic("alice", longHistory, Phase.LOBBY);
    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);
    const scheduled = gameState.getAllianceHuddleSchedules().filter(item => item.decision === "scheduled");
    const context = buildAllianceIntroductionContext(ctx, scheduled.map(item => item.id), Phase.FORMAT_MINGLE);
    expect(context.recentDialogue.find(entry => entry.text === longHistory)?.from).toBe("Alice");
    expect(logger.transcript.some(entry => entry.dialogueContext?.allianceIntroduction)).toBeTrue();
    expect(context.upcomingDecision.nextAction).toBe("locked_format_resolution");
  });

  it("reconstructs proposal, counter, and amendment identities from canonical boundaries", () => {
    const first = createHuddleHarness().gameState;
    const restored = GameState.fromCanonicalEvents(first.getCanonicalEvents());
    const run = (state: GameState) => {
      const proposal = state.recordAllianceProposal({
        proposerId: "alice", name: "Pair", memberIds: ["alice", "bob"],
        purpose: "Coordinate this window.", timebox: null,
      });
      const lineage = state.getAllianceProposalLineages()[0]!;
      const counter = state.recordAllianceCounter({
        lineageId: lineage.id, proposerId: "bob", name: "Pair", memberIds: ["alice", "bob"],
        purpose: "Counter plan.", timebox: null,
      });
      if (!counter) throw new Error("expected counter");
      state.recordAllianceResponse({ lineageId: lineage.id, versionId: counter.versionId,
        playerId: "alice", response: "accepted" });
      const amendment = state.recordAllianceAmendment({
        allianceId: lineage.allianceId, proposerId: "alice", name: "Pair",
        memberIds: ["alice", "bob"], purpose: "Amended plan.", timebox: null,
      });
      expect(proposal.versionId).not.toBe(counter.versionId);
      expect(counter.versionId).not.toBe(amendment.versionId);
      return state.getAllianceProposalLineages();
    };
    const normalize = (lineages: ReturnType<typeof run>) => lineages.map((lineage) => ({
      id: lineage.id, allianceId: lineage.allianceId,
      versionIds: lineage.versions.map((version) => version.versionId),
    }));
    expect(normalize(run(first))).toEqual(normalize(run(restored)));
  });

  it("creates stable distinct sessions with viewer introductions and no tactical outcomes", async () => {
    const run = async () => {
      const { gameState, actor, ctx, logger } = createHuddleHarness();
      activatePair(gameState,"ab","lab","vab","alice","bob");
      await runAllianceHuddleWindow(ctx,actor,Phase.FORMAT_MINGLE,{completePhase:false});
      await runAllianceHuddleWindow(ctx,actor,Phase.FORMAT_MINGLE,{completePhase:false});
      const sessions = Object.values(gameState.getDomainProjection().allianceHuddleSessions);
      expect(sessions).toHaveLength(2);
      expect(new Set(sessions.map(s=>s.id)).size).toBe(2);
      expect(gameState.getAllianceHuddleOutcomes()).toEqual([]);
      expect(gameState.getCanonicalEvents().some(e=>e.type==="alliance.huddle_outcome_recorded")).toBeFalse();
      expect(logger.transcript.filter(e=>e.scope==="huddle")).toHaveLength(4);
      expect(logger.transcript.filter(e=>e.dialogueContext?.allianceIntroduction)).toHaveLength(2);
      return sessions.map(s=>s.id);
    };
    expect(await run()).toEqual(await run());
  });
  it("recalls speech only for immutable participants, including after departure", async () => {
    const { gameState, actor, ctx } = createHuddleHarness();
    activatePair(gameState,"ab","lab","vab","alice","bob");
    const before = ctx.contextBuilder.buildPhaseContext("charlie",Phase.FORMAT_RESOLVE);
    await runAllianceHuddleWindow(ctx,actor,Phase.FORMAT_MINGLE);
    expect(ctx.contextBuilder.buildPhaseContext("alice",Phase.FORMAT_RESOLVE).recentHuddleDialogue).toHaveLength(2);
    expect(ctx.contextBuilder.buildPhaseContext("bob",Phase.FORMAT_RESOLVE).recentHuddleDialogue).toHaveLength(2);
    expect(ctx.contextBuilder.buildPhaseContext("charlie",Phase.FORMAT_RESOLVE).recentHuddleDialogue).toEqual(before.recentHuddleDialogue);
    gameState.eliminatePlayer("alice");
    expect(ctx.contextBuilder.buildPhaseContext("alice",Phase.FORMAT_RESOLVE).recentHuddleDialogue).toHaveLength(2);
    expect(ctx.contextBuilder.buildPhaseContext("charlie",Phase.FORMAT_RESOLVE).recentHuddleDialogue).toEqual([]);
  });
  it("foreign huddles do not change full decision context, references, cache results, or receipts", async () => {
    const run = async (withHuddle: boolean) => {
      const { gameState, actor, ctx, logger } = createHuddleHarness();
      activatePair(gameState, "ab", "lab", "vab", "alice", "bob");
      logger.logPublic("charlie", "I want to hear a clear proposal.", Phase.LOBBY);
      // Warm the actual process-local reference cache before the private work.
      ctx.contextBuilder.buildPhaseContextForAgentCall({ agentId: "charlie", phase: Phase.FORMAT_RESOLVE, promptClass: "strategic_decision" });
      if (withHuddle) await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE, { completePhase: false });
      logger.logPublic("dana", "My public proposal is unchanged.", Phase.LOBBY);
      const { providerCallBoundaryEventSequence, ...context } = ctx.contextBuilder.buildPhaseContextForAgentCall({ agentId: "charlie", phase: Phase.FORMAT_RESOLVE, promptClass: "strategic_decision" });
      // The private provider journal uses the real committed boundary. Agent prompt
      // tests separately prove this execution-only coordinate is never rendered.
      expect(providerCallBoundaryEventSequence).toBeGreaterThan(0);
      return context;
    };
    expect(await run(true)).toEqual(await run(false));
  });
  it("rejects ambiguous duplicate session audiences before recall", async () => {
    const { gameState, actor, ctx, logger } = createHuddleHarness();
    activatePair(gameState, "ab", "lab", "vab", "alice", "bob");
    await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE);
    for (const entry of logger.transcript) {
      if (entry.scope === "huddle" && entry.dialogueContext) {
        entry.dialogueContext.sessionAudiencePlayerIds = ["alice", "alice"];
      }
    }
    expect(ctx.contextBuilder.buildPhaseContext("alice", Phase.FORMAT_RESOLVE).recentHuddleDialogue).toEqual([]);
    expect(ctx.contextBuilder.buildPhaseContext("bob", Phase.FORMAT_RESOLVE).recentHuddleDialogue).toEqual([]);
  });
  it("retains private pass evidence and completes an entirely silent session without speech", async () => {
    const { gameState, actor, ctx, logger } = createHuddleHarness();
    activatePair(gameState,"ab","lab","vab","alice","bob");
    for(const id of ["alice","bob"]) ctx.agents.get(id)!.getAllianceHuddleTurn = async () => ({message:null,noReply:true,thinking:"Nothing useful to add"});
    const events:GameStreamEvent[]=[];
    logger.setStreamListener(e=>events.push(e));
    await runAllianceHuddleWindow(ctx,actor,Phase.FORMAT_MINGLE);
    expect(logger.transcript).toEqual([]);
    const passes=events.filter(e=>e.type==="agent_turn"&&e.action==="alliance-huddle-turn");
    expect(passes).toHaveLength(2);
    expect(passes.every(e=>e.type==="agent_turn"&&e.visibility==="private"&&e.thinking==="Nothing useful to add")).toBeTrue();
    expect(Object.values(gameState.getDomainProjection().allianceHuddleSessions)).toHaveLength(1);
  });
  it("checks ownership before accepting each speech and resumes the frozen floor", async () => {
    const { gameState, ctx, logger }=createHuddleHarness();
    activatePair(gameState,"ab","lab","vab","alice","bob");
    let progress=await beginAllianceHuddleWindow(ctx,Phase.FORMAT_MINGLE);
    progress=await advanceHuddleConversation(ctx,progress);
    const frozen=JSON.stringify(progress);
    ctx.beforeAcceptedCommit=async()=>{throw new Error("stale owner");};
    await expect(advanceHuddleConversation(ctx,progress)).rejects.toThrow("stale owner");
    expect(logger.transcript).toEqual([]);
    expect(JSON.stringify(progress)).toBe(frozen);
    ctx.beforeAcceptedCommit=async()=>{};
    const next=await advanceHuddleConversation(ctx,JSON.parse(frozen));
    expect(next.conversation!.offers).toBe(1);
    expect(logger.transcript).toHaveLength(1);
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
