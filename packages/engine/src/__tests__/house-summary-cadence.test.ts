import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import type {
  GameCheckpointCapsule,
  GameStreamEvent,
  HouseSelectiveSummaryContext,
  HouseSummaryAttemptResult,
} from "../game-runner";
import { TemplateHouseInterviewer } from "../house-interviewer";
import {
  HOUSE_SUMMARY_ACTOR_COORDINATES,
  type HouseBeatClass,
  type HouseSummaryActorCoordinate,
} from "../house-summary-frontier";
import { createUUID } from "../game-state";
import type { GameConfig } from "../types";
import { Phase } from "../types";
import { MockAgent } from "./mock-agent";

const CONFIG: GameConfig = {
  timers: {
    introduction: 0,
    lobby: 0,
    mingle: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
  maxRounds: 1,
  minPlayers: 5,
  maxPlayers: 12,
  formatManifest: ["vote_bomb", "save_or_eliminate"],
};

function failedSummary(context: HouseSelectiveSummaryContext): HouseSummaryAttemptResult {
  return {
    status: "failed",
    reason: "deterministic_test_failure",
    boundary: context.frontier.boundary,
    providerCalls: 1,
    factCalls: 0,
    requestedCategories: [],
    returnedBytes: 0,
    usage: [{
      callId: `failed-${context.frontier.boundary.id}`,
      responseId: null,
      serviceTier: null,
      promptTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    }],
  };
}

function skippedSummary(context: HouseSelectiveSummaryContext): HouseSummaryAttemptResult {
  return {
    status: "model_skipped",
    reason: "deterministic_test_skip",
    boundary: context.frontier.boundary,
    providerCalls: 1,
    factCalls: 0,
    requestedCategories: [],
    returnedBytes: 0,
    usage: [{
      callId: `skipped-${context.frontier.boundary.id}`,
      responseId: `response-skipped-${context.frontier.boundary.id}`,
      serviceTier: "flex",
      promptTokens: 20,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      completionTokens: 5,
      reasoningTokens: 0,
      totalTokens: 25,
    }],
  };
}

class RecordingHouse extends TemplateHouseInterviewer {
  readonly contexts: HouseSelectiveSummaryContext[] = [];

  constructor(private readonly failCoordinates = new Set<string>()) {
    super();
  }

  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    this.contexts.push(structuredClone(context));
    if (this.failCoordinates.has(context.frontier.boundary.actorCoordinate)) {
      return failedSummary(context);
    }
    return super.generateHouseSummary(context);
  }
}

class TwoFailureHouse extends RecordingHouse {
  private armed = false;
  private failures = 0;

  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate === "format_pick") this.armed = true;
    if (this.armed && this.failures < 2) {
      this.contexts.push(structuredClone(context));
      this.failures += 1;
      return failedSummary(context);
    }
    return super.generateHouseSummary(context);
  }
}

class SkippingHouse extends RecordingHouse {
  constructor(private readonly skipCoordinate: HouseSummaryActorCoordinate) {
    super();
  }

  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate === this.skipCoordinate) {
      this.contexts.push(structuredClone(context));
      return skippedSummary(context);
    }
    return super.generateHouseSummary(context);
  }
}

class FailedCarryThenSkipHouse extends RecordingHouse {
  private armed = false;
  private scriptedAttempts = 0;

  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate === "format_pick") this.armed = true;
    if (this.armed && this.scriptedAttempts < 2) {
      this.contexts.push(structuredClone(context));
      this.scriptedAttempts += 1;
      return this.scriptedAttempts === 1 ? failedSummary(context) : skippedSummary(context);
    }
    return super.generateHouseSummary(context);
  }
}

class SkipSecondFormatMenuHouse extends RecordingHouse {
  private formatMenuAttempts = 0;

  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate === "format_menu") {
      this.formatMenuAttempts += 1;
      if (this.formatMenuAttempts === 2) {
        this.contexts.push(structuredClone(context));
        return skippedSummary(context);
      }
    }
    return super.generateHouseSummary(context);
  }
}

class FactBudgetHouse extends RecordingHouse {
  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    const result = await super.generateHouseSummary(context);
    if (!context.factReadAllowed) return result;
    return {
      ...result,
      providerCalls: result.providerCalls + 1,
      factCalls: 1,
      requestedCategories: ["player_projection_facts"],
      returnedBytes: 64,
    };
  }
}

interface HouseBeatDescriptor {
  actorCoordinate: HouseSummaryActorCoordinate;
  phase: Phase;
  beatClass: HouseBeatClass;
  roundMilestone: boolean;
}

interface TestableHouseCadenceRunner {
  houseBeatForActorCoordinate(actorCoordinate: string): HouseBeatDescriptor | null;
  emitHousePhaseBeat(
    actorCoordinate: HouseSummaryActorCoordinate,
    phase: Phase,
    beatClass: HouseBeatClass,
    roundMilestone?: boolean,
  ): Promise<void>;
  gameState: {
    _councilCandidates: [string, string] | null;
  };
}

function testableCadenceRunner(runner: GameRunner): TestableHouseCadenceRunner {
  return runner as unknown as TestableHouseCadenceRunner;
}

class BlockingHouse extends TemplateHouseInterviewer {
  private releaseBlockedSummary!: () => void;
  private markSummaryBlocked!: () => void;
  readonly summaryBlocked = new Promise<void>((resolve) => {
    this.markSummaryBlocked = resolve;
  });
  private readonly blockedSummary = new Promise<void>((resolve) => {
    this.releaseBlockedSummary = resolve;
  });

  release(): void {
    this.releaseBlockedSummary();
  }

  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate === "format_pick") {
      this.markSummaryBlocked();
      await this.blockedSummary;
    }
    return super.generateHouseSummary(context);
  }
}

class InvalidPublishingHouse extends TemplateHouseInterviewer {
  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate !== "format_pick") {
      return super.generateHouseSummary(context);
    }
    const primarySource = context.frontier.catalog[0];
    if (!primarySource) throw new Error("Expected a material FORMAT_PICK frontier");
    return {
      status: "emitted",
      summary: "FORMAT LOCKED: forged state authority",
      boundary: context.frontier.boundary,
      providerCalls: 2,
      factCalls: 1,
      requestedCategories: ["canonical_phase_facts"],
      returnedBytes: 42,
      sourceAliases: [primarySource.alias],
      sources: [primarySource.source],
      openQuestions: [],
      threadIds: [],
      usage: [{
        callId: "invalid-custom-house",
        responseId: "response-invalid-custom-house",
        serviceTier: "flex",
        promptTokens: 100,
        cachedTokens: 10,
        cacheWriteTokens: null,
        completionTokens: 20,
        reasoningTokens: 5,
        totalTokens: 120,
      }],
    };
  }
}

class InvariantBypassingHouse extends TemplateHouseInterviewer {
  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    const coordinate = context.frontier.boundary.actorCoordinate;
    if (coordinate !== "format_pick" && coordinate !== "format_mingle") {
      return super.generateHouseSummary(context);
    }
    const primarySource = context.frontier.catalog[0];
    if (!primarySource) throw new Error(`Expected a material ${coordinate} frontier`);
    return {
      status: "emitted",
      summary: "A fresh fault line is visible in the group.",
      boundary: coordinate === "format_pick"
        ? { ...context.frontier.boundary, id: `${context.frontier.boundary.id}:forged` }
        : context.frontier.boundary,
      providerCalls: 1,
      factCalls: 0,
      requestedCategories: [],
      returnedBytes: 0,
      sourceAliases: coordinate === "format_pick" ? [primarySource.alias] : ["unsupported-alias"],
      sources: [primarySource.source],
      openQuestions: [],
      threadIds: [],
      usage: [],
    };
  }
}

class UnsupportedPlayerCountHouse extends TemplateHouseInterviewer {
  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate !== "format_pick") {
      return super.generateHouseSummary(context);
    }
    const canonicalFact = context.frontier.factStore.canonical_phase_facts[0];
    if (!canonicalFact) throw new Error("Expected a canonical FORMAT_PICK fact");
    return {
      status: "emitted",
      summary: "Five players remain, and the format has nowhere left to hide its cost.",
      boundary: context.frontier.boundary,
      providerCalls: 1,
      factCalls: 0,
      requestedCategories: [],
      returnedBytes: 0,
      sourceAliases: [canonicalFact.alias],
      sources: [canonicalFact.source],
      openQuestions: [],
      threadIds: [],
      usage: [{
        callId: "unsupported-player-count",
        responseId: "response-unsupported-player-count",
        serviceTier: "flex",
        promptTokens: 100,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: 20,
        reasoningTokens: 0,
        totalTokens: 120,
      }],
    };
  }
}

class UnsupportedDialogueAttributionHouse extends TemplateHouseInterviewer {
  override async generateHouseSummary(context: HouseSelectiveSummaryContext): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate !== "introduction") {
      return super.generateHouseSummary(context);
    }
    const adaDialogue = context.frontier.factStore.audience_dialogue_quotes.find(
      (fact) => fact.data.speaker === "Ada",
    );
    if (!adaDialogue) throw new Error("Expected Ada introduction dialogue");
    return {
      status: "emitted",
      summary: "Ada and Blair entered with matching promises to win.",
      boundary: context.frontier.boundary,
      providerCalls: 1,
      factCalls: 0,
      requestedCategories: [],
      returnedBytes: 0,
      sourceAliases: [adaDialogue.alias],
      sources: [adaDialogue.source],
      openQuestions: [],
      threadIds: [],
      usage: [{
        callId: "unsupported-dialogue-attribution",
        responseId: "response-unsupported-dialogue-attribution",
        serviceTier: "flex",
        promptTokens: 100,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: 20,
        reasoningTokens: 0,
        totalTokens: 120,
      }],
    };
  }
}

function agents(count = 5): MockAgent[] {
  return ["Ada", "Blair", "Cleo", "Dax", "Eve", "Finn", "Gia"].slice(0, count).map(
    (name) => new MockAgent(createUUID(), name),
  );
}

describe("House summary proving cadence", () => {
  it("durably checkpoints an accepted boundary before optional House narration and keeps terminal streaming held", async () => {
    const house = new BlockingHouse();
    const flushedEventTypes: string[] = [];
    const checkpoints: GameCheckpointCapsule[] = [];
    const streamedEvents: GameStreamEvent[] = [];
    const runner = new GameRunner(agents(), { ...CONFIG, maxRounds: 3 }, house, {
      gameId: "house-summary-durable-order",
      durableEventSink: (events) => {
        flushedEventTypes.push(...events.map((event) => event.type));
      },
      durableCheckpointSink: (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });
    runner.setStreamListener((event) => streamedEvents.push(event));

    const runPromise = runner.run();
    await house.summaryBlocked;

    const selectedEvent = runner.getCanonicalEvents().find((event) => event.type === "format.selected");
    expect(selectedEvent).toBeDefined();
    expect(flushedEventTypes).toContain("format.selected");
    expect(checkpoints.at(-1)).toMatchObject({
      checkpointKind: "phase_boundary",
      lastEventSequence: selectedEvent?.sequence,
      runtimeSnapshot: {
        actorWitness: { actorCoordinate: "format_mingle" },
      },
    });

    house.release();
    await runPromise;

    const streamedReceiptCount = (): number => streamedEvents.filter((event) => (
      event.type === "agent_turn" && event.action === "house-summary-phase-receipt"
    )).length;
    expect(streamedEvents.some((event) => event.type === "game_over")).toBe(false);
    expect(streamedReceiptCount()).toBeLessThan(runner.houseSummaryPhaseReceipts.length);
    runner.releaseTerminalStream();
    expect(streamedEvents.some((event) => event.type === "game_over")).toBe(true);
    expect(streamedReceiptCount()).toBe(runner.houseSummaryPhaseReceipts.length);
  });

  it("rejects protocol-invalid prose from a custom House before publication and preserves accounting", async () => {
    const streamedEvents: GameStreamEvent[] = [];
    const runner = new GameRunner(agents(), CONFIG, new InvalidPublishingHouse(), {
      maxRoundsMode: "exact",
    });
    runner.setStreamListener((event) => streamedEvents.push(event));

    await runner.run();

    expect(runner.transcriptLog.some((entry) => entry.text.includes("forged state authority"))).toBe(false);
    expect(streamedEvents.some((event) => (
      event.type === "agent_turn"
      && event.action === "house-mc-summary"
      && event.phase === Phase.FORMAT_PICK
    ))).toBe(false);
    const receipt = runner.houseSummaryPhaseReceipts.find(
      (candidate) => candidate.actorCoordinate === "format_pick",
    );
    expect(receipt).toMatchObject({
      status: "failed",
      providerCalls: 2,
      factCalls: 1,
      requestedCategories: ["canonical_phase_facts"],
      returnedBytes: 42,
      selectedSourceCount: 0,
      usageAvailable: false,
      usage: [{
        callId: "invalid-custom-house",
        cacheWriteTokens: null,
        reasoningTokens: 5,
      }],
    });
  });

  it("rejects custom House results with a foreign boundary or unsupported source pair", async () => {
    const streamedEvents: GameStreamEvent[] = [];
    const runner = new GameRunner(agents(), CONFIG, new InvariantBypassingHouse(), {
      maxRoundsMode: "exact",
    });
    runner.setStreamListener((event) => streamedEvents.push(event));

    await runner.run();

    expect(runner.houseSummaryPhaseReceipts.find(
      (receipt) => receipt.actorCoordinate === "format_pick",
    )).toMatchObject({
      status: "failed",
      providerCalls: 1,
      selectedSourceCount: 0,
      boundaryId: expect.not.stringContaining(":forged"),
    });
    expect(runner.houseSummaryPhaseReceipts.find(
      (receipt) => receipt.actorCoordinate === "format_mingle",
    )).toMatchObject({ status: "failed", providerCalls: 1, selectedSourceCount: 0 });
    expect(streamedEvents.some((event) => (
      event.type === "agent_turn"
      && event.action === "house-mc-summary"
      && (event.phase === Phase.FORMAT_PICK || event.phase === Phase.FORMAT_MINGLE)
    ))).toBe(false);
  });

  it("rejects unsupported public player-count claims before publication without losing accounting", async () => {
    const runner = new GameRunner(agents(), CONFIG, new UnsupportedPlayerCountHouse(), {
      maxRoundsMode: "exact",
    });

    await runner.run();

    expect(runner.transcriptLog.some((entry) => entry.text.includes("Five players remain"))).toBe(false);
    expect(runner.houseSummaryPhaseReceipts.find(
      (receipt) => receipt.actorCoordinate === "format_pick",
    )).toMatchObject({
      status: "failed",
      providerCalls: 1,
      selectedSourceCount: 0,
      usage: [{
        callId: "unsupported-player-count",
        responseId: "response-unsupported-player-count",
        totalTokens: 120,
      }],
    });
  });

  it("rejects custom House speech claims that omit a named speaker's dialogue receipt", async () => {
    const runner = new GameRunner(agents(), CONFIG, new UnsupportedDialogueAttributionHouse(), {
      maxRoundsMode: "exact",
    });

    await runner.run();

    expect(runner.transcriptLog.some((entry) => entry.text.includes("matching promises"))).toBe(false);
    expect(runner.houseSummaryPhaseReceipts.find(
      (receipt) => receipt.actorCoordinate === "introduction",
    )).toMatchObject({
      status: "failed",
      providerCalls: 1,
      selectedSourceCount: 0,
      usage: [{
        callId: "unsupported-dialogue-attribution",
        responseId: "response-unsupported-dialogue-attribution",
        totalTokens: 120,
      }],
    });
  });

  it("carries compact continuity from FORMAT_PICK into the richer round-end beat", async () => {
    const house = new RecordingHouse();
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });

    await runner.run();

    const pick = house.contexts.find((context) => context.frontier.boundary.actorCoordinate === "format_pick");
    const mingle = house.contexts.find((context) => context.frontier.boundary.actorCoordinate === "format_mingle");
    const resolve = house.contexts.find((context) => context.frontier.boundary.actorCoordinate === "format_resolve");
    expect(pick?.frontier.boundary.beatClass).toBe("ordinary");
    expect(resolve?.frontier.boundary.beatClass).toBe("milestone");
    expect(mingle?.continuity.lastBoundaryId).toBe(pick?.frontier.boundary.id);
    expect(resolve?.continuity.lastBoundaryId).toBe(mingle?.frontier.boundary.id);
    expect(resolve?.frontier.factStore.canonical_phase_facts.map((fact) => fact.label))
      .toContain("format.resolved");
    expect(runner.houseSummaryPhaseReceipts.filter(
      (receipt) => receipt.actorCoordinate === "format_pick" || receipt.actorCoordinate === "format_resolve",
    ).map((receipt) => ({
      coordinate: receipt.actorCoordinate,
      status: receipt.status,
      pendingDelta: receipt.pendingDelta,
    }))).toEqual([
      { coordinate: "format_pick", status: "emitted", pendingDelta: "none" },
      { coordinate: "format_resolve", status: "emitted", pendingDelta: "none" },
    ]);
    expect(runner.transcriptLog.filter((entry) => entry.dialogueKind === "house_summary")).toHaveLength(
      runner.houseSummaryPhaseReceipts.filter((receipt) => receipt.status === "emitted").length,
    );
  });

  it("permits one bounded milestone fact read across the full game", async () => {
    const house = new FactBudgetHouse();
    const runner = new GameRunner(agents(7), { ...CONFIG, maxRounds: 3 }, house);

    await runner.run();

    expect(house.contexts.filter((context) => context.factReadAllowed).map(
      (context) => context.frontier.boundary.actorCoordinate,
    )).toEqual(["format_resolve"]);
    expect(house.contexts.filter((context) => context.frontier.boundary.beatClass === "ordinary").every(
      (context) => !context.factReadAllowed,
    )).toBe(true);
    expect(runner.houseSummaryPhaseReceipts.reduce((sum, receipt) => sum + receipt.factCalls, 0)).toBe(1);
    expect(runner.houseSummaryPhaseReceipts.filter((receipt) => receipt.factCalls > 0)).toEqual([
      expect.objectContaining({
        actorCoordinate: "format_resolve",
        beatClass: "milestone",
        factCalls: 1,
      }),
    ]);
  });

  it("carries one failed delta into round-end without filler or retrying the failed boundary", async () => {
    const house = new RecordingHouse(new Set(["format_pick"]));
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });

    const result = await runner.run();

    expect(result.transcript.filter((entry) => entry.dialogueKind === "house_summary")).toHaveLength(
      runner.houseSummaryPhaseReceipts.filter((receipt) => receipt.status === "emitted").length,
    );
    expect(result.transcript.some((entry) => entry.text.includes("watching closely"))).toBe(false);
    const failedIndex = runner.houseSummaryPhaseReceipts.findIndex((receipt) => receipt.actorCoordinate === "format_pick");
    const nextMaterial = runner.houseSummaryPhaseReceipts.slice(failedIndex + 1).find((receipt) => receipt.status !== "preflight_skipped");
    expect(runner.houseSummaryPhaseReceipts[failedIndex]).toMatchObject({
      actorCoordinate: "format_pick",
      status: "failed",
      pendingDelta: "carried",
    });
    expect(nextMaterial).toMatchObject({ status: "emitted", pendingDelta: "carried" });
    expect(house.contexts.filter(
      (context) => context.frontier.boundary.actorCoordinate === "format_pick",
    )).toHaveLength(1);
    const carriedContext = house.contexts.find(
      (context) => context.frontier.boundary.id === nextMaterial?.boundaryId,
    );
    expect(carriedContext?.frontier.factStore.canonical_phase_facts.map((fact) => fact.label))
      .toContain("format.selected");
  });

  it("advances examined heads after a direct model skip without publishing or carrying the delta", async () => {
    const house = new SkippingHouse("format_pick");
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });

    const result = await runner.run();

    const pickIndex = runner.houseSummaryPhaseReceipts.findIndex(
      (receipt) => receipt.actorCoordinate === "format_pick",
    );
    const nextMaterial = runner.houseSummaryPhaseReceipts.slice(pickIndex + 1)
      .find((receipt) => receipt.status !== "preflight_skipped");
    expect(runner.houseSummaryPhaseReceipts[pickIndex]).toMatchObject({
      status: "model_skipped",
      pendingDelta: "none",
      providerCalls: 1,
      usageAvailable: true,
    });
    expect(result.transcript.some((entry) => (
      entry.dialogueKind === "house_summary" && entry.phase === Phase.FORMAT_PICK
    ))).toBe(false);
    const nextContext = house.contexts.find(
      (context) => context.frontier.boundary.id === nextMaterial?.boundaryId,
    );
    expect(nextContext?.frontier.factStore.canonical_phase_facts.map((fact) => fact.label))
      .not.toContain("format.selected");
  });

  it("drops a failed carry when the next material attempt model-skips", async () => {
    const house = new FailedCarryThenSkipHouse();
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });

    const result = await runner.run();

    const pickIndex = runner.houseSummaryPhaseReceipts.findIndex(
      (receipt) => receipt.actorCoordinate === "format_pick",
    );
    const materialAfterPick = runner.houseSummaryPhaseReceipts.slice(pickIndex + 1)
      .filter((receipt) => receipt.status !== "preflight_skipped");
    expect(runner.houseSummaryPhaseReceipts[pickIndex]).toMatchObject({
      status: "failed",
      pendingDelta: "carried",
    });
    expect(materialAfterPick[0]).toMatchObject({
      status: "model_skipped",
      pendingDelta: "dropped",
    });
    expect(materialAfterPick[1]).toMatchObject({
      status: "emitted",
      pendingDelta: "none",
    });
    const skippedContext = house.contexts.find(
      (context) => context.frontier.boundary.id === materialAfterPick[0]?.boundaryId,
    );
    expect(skippedContext?.frontier.factStore.canonical_phase_facts.map((fact) => fact.label))
      .toContain("format.selected");
    const recoveredContext = house.contexts.find(
      (context) => context.frontier.boundary.id === materialAfterPick[1]?.boundaryId,
    );
    expect(recoveredContext?.frontier.factStore.canonical_phase_facts.map((fact) => fact.label))
      .not.toContain("format.selected");
    expect(skippedContext?.continuity.lastSummaryByActorCoordinate.format_menu).toEqual(expect.any(String));
    expect(recoveredContext?.continuity.lastSummaryByActorCoordinate.format_menu)
      .toBe(skippedContext?.continuity.lastSummaryByActorCoordinate.format_menu);
    expect(recoveredContext?.continuity.lastSummaryByActorCoordinate).not.toHaveProperty("format_pick");
    expect(result.transcript.filter((entry) => (
      entry.dialogueKind === "house_summary" && (
        entry.phase === skippedContext?.frontier.boundary.phase || entry.phase === Phase.FORMAT_PICK
      )
    ))).toHaveLength(0);
  });

  it("keeps the prior same-coordinate summary across a model skip and replaces it only after emission", async () => {
    const house = new SkipSecondFormatMenuHouse();
    const runner = new GameRunner(agents(7), { ...CONFIG, maxRounds: 3 }, house);

    await runner.run();

    const menuContexts = house.contexts.filter(
      (context) => context.frontier.boundary.actorCoordinate === "format_menu",
    );
    const menuReceipts = runner.houseSummaryPhaseReceipts.filter(
      (receipt) => receipt.actorCoordinate === "format_menu",
    );
    expect(menuContexts).toHaveLength(3);
    expect(menuReceipts.map((receipt) => receipt.status)).toEqual(["emitted", "model_skipped", "emitted"]);
    const firstSummary = menuContexts[1]?.continuity.lastSummaryByActorCoordinate.format_menu;
    expect(firstSummary).toEqual(expect.any(String));
    expect(menuContexts[2]?.continuity.lastSummaryByActorCoordinate.format_menu).toBe(firstSummary);
  });

  it("uses the inherited House-summary control for the whole proving cadence", async () => {
    const house = new RecordingHouse();
    const runner = new GameRunner(
      agents(),
      { ...CONFIG, enableHouseRoundSummaries: false },
      house,
      { maxRoundsMode: "exact" },
    );

    await runner.run();

    expect(house.contexts).toEqual([]);
    expect(runner.houseSummaryPhaseReceipts).toEqual([]);
    expect(runner.transcriptLog.some((entry) => entry.dialogueKind === "house_summary")).toBe(false);
  });

  it("drops a carried delta after the next material attempt also fails", async () => {
    const house = new TwoFailureHouse();
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });

    await runner.run();

    const pickIndex = runner.houseSummaryPhaseReceipts.findIndex(
      (receipt) => receipt.actorCoordinate === "format_pick",
    );
    const materialAfterPick = runner.houseSummaryPhaseReceipts.slice(pickIndex + 1)
      .filter((receipt) => receipt.status !== "preflight_skipped");
    expect(runner.houseSummaryPhaseReceipts[pickIndex]).toMatchObject({ status: "failed", pendingDelta: "carried" });
    expect(materialAfterPick[0]).toMatchObject({ status: "failed", pendingDelta: "dropped" });
    expect(materialAfterPick[1]).toMatchObject({ status: "emitted", pendingDelta: "none" });
    const recoveredContext = house.contexts.find(
      (context) => context.frontier.boundary.id === materialAfterPick[1]?.boundaryId,
    );
    expect(recoveredContext?.frontier.factStore.canonical_phase_facts.map((fact) => fact.label))
      .not.toContain("format.selected");
  });

  it("rejects a phase-boundary checkpoint before House selection, publication, or receipt", async () => {
    const house = new RecordingHouse();
    const streamedEvents: GameStreamEvent[] = [];
    const runner = new GameRunner(agents(), CONFIG, house, {
      maxRoundsMode: "exact",
      durableEventSink: () => undefined,
      durableCheckpointSink: (checkpoint) => {
        if (checkpoint.runtimeSnapshot?.actorWitness.actorCoordinate === "format_mingle") {
          throw new Error("format-pick checkpoint rejected");
        }
      },
    });
    runner.setStreamListener((event) => streamedEvents.push(event));

    await expect(runner.run()).rejects.toThrow("format-pick checkpoint rejected");

    expect(house.contexts.some(
      (context) => context.frontier.boundary.actorCoordinate === "format_pick",
    )).toBe(false);
    expect(runner.houseSummaryPhaseReceipts.some(
      (receipt) => receipt.actorCoordinate === "format_pick",
    )).toBe(false);
    expect(runner.transcriptLog.some((entry) => (
      entry.dialogueKind === "house_summary" && entry.phase === Phase.FORMAT_PICK
    ))).toBe(false);
    expect(streamedEvents.some((event) => (
      event.type === "agent_turn"
      && (event.action === "house-mc-summary" || event.action === "house-summary-phase-receipt")
      && event.phase === Phase.FORMAT_PICK
    ))).toBe(false);
  });

  it("keeps House narration out of the next dialogue evidence frontier", async () => {
    const house = new RecordingHouse();
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });

    await runner.run();

    const roundEnd = house.contexts.find(
      (context) => context.frontier.boundary.phase === Phase.FORMAT_RESOLVE,
    );
    expect(roundEnd).toBeDefined();
    expect(roundEnd?.frontier.factStore.audience_dialogue_quotes.some(
      (fact) => fact.data.speaker === "House",
    )).toBe(false);
  });

  it("covers the active format and endgame actor-coordinate cadence with at least 80% eligible emission", async () => {
    const house = new RecordingHouse();
    const runner = new GameRunner(agents(), { ...CONFIG, maxRounds: 3 }, house);

    await runner.run();

    const receipts = runner.houseSummaryPhaseReceipts;
    const activeCoordinates: HouseSummaryActorCoordinate[] = [
      "introduction",
      "lobby",
      "vote",
      "format_menu",
      "format_pick",
      "format_mingle",
      "format_resolve",
      "reckoning_lobby",
      "reckoning_plea",
      "reckoning_vote",
      "tribunal_lobby",
      "tribunal_accusation",
      "tribunal_defense",
      "tribunal_vote",
      "judgment_opening",
      "judgment_jury_questions",
      "judgment_closing",
      "judgment_jury_vote",
    ];
    expect(receipts.map((receipt) => receipt.actorCoordinate)).toEqual(activeCoordinates);
    expect(activeCoordinates.every((coordinate) => HOUSE_SUMMARY_ACTOR_COORDINATES.includes(coordinate))).toBe(true);
    expect(new Set(receipts.map((receipt) => receipt.boundaryId)).size).toBe(receipts.length);
    const materiallyEligible = receipts.filter((receipt) => receipt.status !== "preflight_skipped");
    const emitted = materiallyEligible.filter((receipt) => receipt.status === "emitted");
    expect(emitted.length / materiallyEligible.length).toBeGreaterThanOrEqual(0.8);
    expect(receipts.filter((receipt) => receipt.status === "preflight_skipped").every(
      (receipt) => receipt.providerCalls === 0 && receipt.usage.length === 0,
    )).toBe(true);
  });

  it("classifies every retained classic coordinate and produces unique zero-call preflight receipts", async () => {
    const house = new RecordingHouse();
    const runner = new GameRunner(agents(), CONFIG, house, { maxRoundsMode: "exact" });
    const result = await runner.run();
    const internal = testableCadenceRunner(runner);

    const classicCoordinates = [
      "post_vote_mingle",
      "power",
      "reveal",
      "pre_council_huddle",
      "council",
    ] as const satisfies readonly HouseSummaryActorCoordinate[];
    const classifications = classicCoordinates.map((coordinate) => (
      internal.houseBeatForActorCoordinate(coordinate)
    ));
    expect(classifications).toEqual([
      { actorCoordinate: "post_vote_mingle", phase: Phase.POST_VOTE_MINGLE, beatClass: "ordinary", roundMilestone: false },
      { actorCoordinate: "power", phase: Phase.POWER, beatClass: "milestone", roundMilestone: true },
      { actorCoordinate: "reveal", phase: Phase.REVEAL, beatClass: "ordinary", roundMilestone: false },
      { actorCoordinate: "pre_council_huddle", phase: Phase.PRE_COUNCIL_HUDDLE, beatClass: "ordinary", roundMilestone: false },
      { actorCoordinate: "council", phase: Phase.COUNCIL, beatClass: "milestone", roundMilestone: true },
    ]);

    internal.gameState._councilCandidates = ["candidate-a", "candidate-b"];
    expect(internal.houseBeatForActorCoordinate("power")).toEqual({
      actorCoordinate: "power",
      phase: Phase.POWER,
      beatClass: "ordinary",
      roundMilestone: false,
    });
    internal.gameState._councilCandidates = null;

    const receiptStart = runner.houseSummaryPhaseReceipts.length;
    const providerContextStart = house.contexts.length;
    for (const classification of classifications) {
      if (!classification) throw new Error("Expected retained classic House beat classification");
      await internal.emitHousePhaseBeat(
        classification.actorCoordinate,
        classification.phase,
        classification.beatClass,
        classification.roundMilestone,
      );
    }
    const classicReceipts = runner.houseSummaryPhaseReceipts.slice(receiptStart);
    expect(classicReceipts.map((receipt) => receipt.actorCoordinate)).toEqual([...classicCoordinates]);
    expect(classicReceipts.every((receipt) => (
      receipt.status === "preflight_skipped"
      && receipt.providerCalls === 0
      && receipt.factCalls === 0
      && receipt.usage.length === 0
      && receipt.usageAvailable
    ))).toBe(true);
    expect(new Set(classicReceipts.map((receipt) => receipt.boundaryId)).size).toBe(classicReceipts.length);
    expect(house.contexts).toHaveLength(providerContextStart);
    expect(result.rounds).toBeGreaterThan(0);
  });
});
