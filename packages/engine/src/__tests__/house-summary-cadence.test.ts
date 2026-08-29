import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import type {
  GameCheckpointCapsule,
  GameStreamEvent,
  HouseNarrativeTurnContext,
  HouseSummaryAttemptResult,
} from "../game-runner";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { createUUID } from "../game-state";
import type { GameConfig } from "../types";
import { MockAgent } from "./mock-agent";

const PUBLIC_COPY = "  Ada enters smiling; the House notices Blair counting exits.  ";
const INITIAL_NOTEBOOK = "PRIVATE NOTEBOOK CANARY: Blair distrusts Ada but still needs her.";
const MILESTONE_NOTEBOOK = "PRIVATE NOTEBOOK CANARY: Vote Bomb turned Blair's doubt into an active fracture.";

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

function agents(): MockAgent[] {
  return ["Ada", "Blair", "Cleo", "Dax", "Eve"].map(
    (name) => new MockAgent(createUUID(), name),
  );
}

function usage(callId: string) {
  return [{
    callId,
    responseId: `response-${callId}`,
    serviceTier: "flex",
    promptTokens: 20,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 10,
    reasoningTokens: 0,
    totalTokens: 30,
  }];
}

function authored(
  context: HouseNarrativeTurnContext,
  publicSummary: string | null,
  privateNarrativeNotebook: string | null,
): HouseSummaryAttemptResult {
  const boundary = context.narrationContext.boundary;
  return {
    status: "emitted",
    boundary,
    beat: publicSummary === null
      ? null
      : { version: 2, boundary: structuredClone(boundary), publicSummary },
    privateNarrativeNotebook,
    providerCalls: 1,
    usage: usage(boundary.id),
  };
}

function failed(context: HouseNarrativeTurnContext, reason = "provider_failure"): HouseSummaryAttemptResult {
  return {
    status: "failed",
    reason,
    boundary: context.narrationContext.boundary,
    providerCalls: 1,
    usage: usage(`failed-${context.narrationContext.boundary.id}`),
  };
}

function skipped(context: HouseNarrativeTurnContext): HouseSummaryAttemptResult {
  return {
    status: "model_skipped",
    reason: "no_public_summary_or_notebook_update",
    boundary: context.narrationContext.boundary,
    providerCalls: 1,
    usage: usage(`skipped-${context.narrationContext.boundary.id}`),
  };
}

class AuthoredNarrativeHouse extends TemplateHouseInterviewer {
  readonly contexts: HouseNarrativeTurnContext[] = [];

  override async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    this.contexts.push(structuredClone(context));
    const coordinate = context.narrationContext.boundary.actorCoordinate;
    if (coordinate === "introduction") return authored(context, PUBLIC_COPY, INITIAL_NOTEBOOK);
    if (coordinate === "format_resolve") return authored(context, null, MILESTONE_NOTEBOOK);
    return super.generateHouseSummary(context);
  }
}

class FailurePreservationHouse extends AuthoredNarrativeHouse {
  override async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    const coordinate = context.narrationContext.boundary.actorCoordinate;
    if (coordinate === "format_pick") {
      this.contexts.push(structuredClone(context));
      return failed(context, "provider_exhausted");
    }
    return super.generateHouseSummary(context);
  }
}

class InvalidPresentationHouse extends AuthoredNarrativeHouse {
  override async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    const coordinate = context.narrationContext.boundary.actorCoordinate;
    if (coordinate === "format_pick") {
      this.contexts.push(structuredClone(context));
      return authored(context, "INVALID\u0007PUBLIC COPY", "INVALID\u0007NOTEBOOK");
    }
    return super.generateHouseSummary(context);
  }
}

class FailedThenSkippedHouse extends AuthoredNarrativeHouse {
  private armed = false;
  private attempt = 0;

  override async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    const coordinate = context.narrationContext.boundary.actorCoordinate;
    if (coordinate === "format_pick") this.armed = true;
    if (this.armed && this.attempt < 2) {
      this.contexts.push(structuredClone(context));
      this.attempt += 1;
      return this.attempt === 1 ? failed(context) : skipped(context);
    }
    return super.generateHouseSummary(context);
  }
}

class NarrativeVariantHouse extends TemplateHouseInterviewer {
  constructor(private readonly label: string) {
    super();
  }

  override async generateHouseSummary(context: HouseNarrativeTurnContext): Promise<HouseSummaryAttemptResult> {
    return authored(
      context,
      `${this.label}: the House interprets this beat differently.`,
      `${this.label}: private producer continuity follows a different arc.`,
    );
  }
}

describe("House-authored narrative cadence", () => {
  it("publishes byte-exact House copy only after its matching beat and notebook are checkpointed", async () => {
    const house = new AuthoredNarrativeHouse();
    const checkpoints: GameCheckpointCapsule[] = [];
    const streamed: GameStreamEvent[] = [];
    let acceptedStateWasDurableAtViewerRelease = false;
    const runner = new GameRunner(agents(), CONFIG, house, {
      gameId: "house-authored-durable-order",
      durableEventSink: () => {},
      durableCheckpointSink: (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); },
    });
    runner.setStreamListener((event) => {
      streamed.push(event);
      if (event.type === "agent_turn" && event.action === "house-mc-summary"
        && event.text === PUBLIC_COPY) {
        acceptedStateWasDurableAtViewerRelease = checkpoints.some((checkpoint) => (
          checkpoint.houseNarrativeContinuityCapsule?.privateNarrativeNotebook === INITIAL_NOTEBOOK
          && checkpoint.houseNarrativeContinuityCapsule.recentBeats.some(
            (beat) => beat.publicSummary === PUBLIC_COPY,
          )
        ));
      }
    });

    await runner.run();

    expect(runner.transcriptLog.some(
      (entry) => entry.dialogueKind === "house_summary" && entry.text === PUBLIC_COPY,
    )).toBe(true);
    expect(acceptedStateWasDurableAtViewerRelease).toBe(true);
    expect(JSON.stringify(streamed)).not.toContain(INITIAL_NOTEBOOK);
    expect(JSON.stringify(streamed)).not.toContain(MILESTONE_NOTEBOOK);
  });

  it("does not release accepted House copy when its matching checkpoint is rejected", async () => {
    const streamed: GameStreamEvent[] = [];
    const runner = new GameRunner(agents(), CONFIG, new AuthoredNarrativeHouse(), {
      gameId: "house-rejected-checkpoint",
      durableEventSink: () => {},
      durableCheckpointSink: (checkpoint) => {
        if (checkpoint.houseNarrativeContinuityCapsule?.recentBeats.some(
          (beat) => beat.publicSummary === PUBLIC_COPY,
        )) {
          throw new Error("checkpoint rejected");
        }
      },
    });
    runner.setStreamListener((event) => streamed.push(event));

    await expect(runner.run()).rejects.toThrow("checkpoint rejected");

    expect(JSON.stringify(streamed)).not.toContain(PUBLIC_COPY);
    expect(JSON.stringify(streamed)).not.toContain(INITIAL_NOTEBOOK);
  });

  it("commits a notebook-only milestone without fabricating a public beat", async () => {
    const house = new AuthoredNarrativeHouse();
    const checkpoints: GameCheckpointCapsule[] = [];
    const runner = new GameRunner(agents(), CONFIG, house, {
      gameId: "house-notebook-only",
      durableEventSink: () => {},
      durableCheckpointSink: (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); },
    });

    await runner.run();

    const finalContinuity = checkpoints.at(-1)?.houseNarrativeContinuityCapsule;
    expect(finalContinuity?.privateNarrativeNotebook).toBe(MILESTONE_NOTEBOOK);
    expect(finalContinuity?.recentBeats.some(
      (beat) => beat.boundary.actorCoordinate === "format_resolve",
    )).toBe(false);
    expect(runner.transcriptLog.some((entry) => entry.text === MILESTONE_NOTEBOOK)).toBe(false);
    expect(runner.houseSummaryPhaseTelemetry.find(
      (entry) => entry.actorCoordinate === "format_resolve",
    )).toMatchObject({ status: "emitted", providerCalls: 1 });
  });

  it("preserves the notebook and carries pending delta across provider exhaustion", async () => {
    const house = new FailurePreservationHouse();
    const checkpoints: GameCheckpointCapsule[] = [];
    const runner = new GameRunner(agents(), CONFIG, house, {
      gameId: "house-failure-preserves-notebook",
      durableEventSink: () => {},
      durableCheckpointSink: (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); },
    });

    await runner.run();

    const failedIndex = runner.houseSummaryPhaseTelemetry.findIndex(
      (entry) => entry.actorCoordinate === "format_pick",
    );
    const nextMaterial = runner.houseSummaryPhaseTelemetry.slice(failedIndex + 1)
      .find((entry) => entry.status !== "preflight_skipped");
    expect(runner.houseSummaryPhaseTelemetry[failedIndex]).toMatchObject({
      status: "failed",
      pendingDelta: "carried",
      providerCalls: 1,
    });
    expect(nextMaterial?.pendingDelta).toBe("carried");
    expect(checkpoints.at(-1)?.houseNarrativeContinuityCapsule?.privateNarrativeNotebook)
      .toBe(MILESTONE_NOTEBOOK);
    const contextAfterFailure = house.contexts.findIndex(
      (context) => context.narrationContext.boundary.actorCoordinate === "format_pick",
    );
    expect(house.contexts.slice(contextAfterFailure + 1).some(
      (context) => context.continuity.privateNarrativeNotebook === INITIAL_NOTEBOOK,
    )).toBe(true);
  });

  it("rejects malformed authored presentation without publishing it or replacing the notebook", async () => {
    const house = new InvalidPresentationHouse();
    const checkpoints: GameCheckpointCapsule[] = [];
    const runner = new GameRunner(agents(), CONFIG, house, {
      gameId: "house-invalid-presentation",
      durableEventSink: () => {},
      durableCheckpointSink: (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); },
    });

    await runner.run();

    expect(runner.houseSummaryPhaseTelemetry.find(
      (entry) => entry.actorCoordinate === "format_pick",
    )).toMatchObject({ status: "failed", pendingDelta: "carried" });
    expect(runner.transcriptLog.some((entry) => entry.text.includes("INVALID"))).toBe(false);
    expect(checkpoints.some(
      (checkpoint) => checkpoint.houseNarrativeContinuityCapsule?.privateNarrativeNotebook?.includes("INVALID"),
    )).toBe(false);
  });

  it("drops a carried delta only when the next House turn explicitly skips", async () => {
    const runner = new GameRunner(agents(), CONFIG, new FailedThenSkippedHouse(), {
      gameId: "house-failed-then-skipped",
    });

    await runner.run();

    const failureIndex = runner.houseSummaryPhaseTelemetry.findIndex(
      (entry) => entry.actorCoordinate === "format_pick",
    );
    const material = runner.houseSummaryPhaseTelemetry.slice(failureIndex, failureIndex + 2);
    expect(material[0]).toMatchObject({ status: "failed", pendingDelta: "carried" });
    expect(material[1]).toMatchObject({ status: "model_skipped", pendingDelta: "dropped" });
  });

  it("keeps ordinary summary prompts non-omniscient while milestone contexts carry private producer material", async () => {
    const house = new AuthoredNarrativeHouse();
    const runner = new GameRunner(agents(), CONFIG, house, {
      gameId: "house-cadence-privacy",
    });

    await runner.run();

    const ordinary = house.contexts.find(
      (context) => context.narrationContext.boundary.beatClass === "ordinary",
    );
    const milestone = house.contexts.find(
      (context) => context.narrationContext.boundary.beatClass === "milestone",
    );
    expect(ordinary?.narrationContext.privateDialogueAndDecisions).toEqual([]);
    expect(ordinary?.narrationContext.diaryEntries).toEqual([]);
    expect(milestone).toBeDefined();
    expect(milestone?.continuity.privateNarrativeNotebook).not.toBeNull();
  });

  it("keeps canonical game outcomes identical when House prose and notebook content conflict", async () => {
    const roster = ["Ada", "Blair", "Cleo", "Dax", "Eve"].map((name, index) => ({
      id: `house-nonauthority-player-${index}`,
      name,
    }));
    const runVariant = async (label: string) => {
      const runner = new GameRunner(
        roster.map((player) => new MockAgent(player.id, player.name)),
        CONFIG,
        new NarrativeVariantHouse(label),
        {
          gameId: "house-prose-nonauthority",
          maxRoundsMode: "exact",
          random: () => 0.25,
        },
      );
      await runner.run();
      return {
        events: runner.getCanonicalEvents().map(({ timestamp: _timestamp, ...event }) => event),
        projection: runner.getDomainProjection(),
      };
    };

    const triumphant = await runVariant("Ada is running the table");
    const doomed = await runVariant("Ada's game is collapsing");

    expect(doomed.events).toEqual(triumphant.events);
    expect(doomed.projection).toEqual(triumphant.projection);
  });
});
