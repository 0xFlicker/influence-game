import { describe, expect, it } from "bun:test";
import {
  FULL_STRATEGY_REQUIRED,
  FULL_STRATEGY_TOOL_PROPERTIES,
  STRATEGY_DELTA_GUIDANCE,
  buildSealedElimBallotTool,
} from "../formats/agent-surface";
import {
  COMPACT_STRATEGY_LIMITS,
  applyStrategyCandidate,
  createOpeningStrategyState,
  markStrategyReconciliationRequired,
} from "../strategy-state";
import { STRATEGY_DELTA_QUALITY_SCENARIOS } from "./fixtures/prompt-scenarios/strategy-delta-quality";

describe("compact strategy decision envelope", () => {
  it("uses thinking plus a nullable delta on ordinary strategic actions", () => {
    const tool = buildSealedElimBallotTool("majority_elimination", ["Mira", "Vera"]);
    const parameters = tool.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(parameters.required).toEqual(["thinking", "target", "strategyDelta"]);
    expect(parameters.properties).toHaveProperty("thinking");
    expect(parameters.properties).toHaveProperty("target");
    expect(parameters.properties).toHaveProperty("strategyDelta");
    expect(parameters.properties).not.toHaveProperty("strategy");
    expect(parameters.properties).not.toHaveProperty("decisionLog");

    expect(STRATEGY_DELTA_GUIDANCE).toContain("material, actionable change");
    expect(STRATEGY_DELTA_GUIDANCE).toContain("targets, alliance posture, commitments");
    expect(STRATEGY_DELTA_GUIDANCE).toContain("Do not summarize the action");
    expect(STRATEGY_DELTA_GUIDANCE).toContain("repeat the baseline");
  });

  it("defines a full-strategy-only fragment for diary and repair boundaries", () => {
    expect(FULL_STRATEGY_REQUIRED).toEqual(["strategy"]);
    expect(FULL_STRATEGY_TOOL_PROPERTIES).toHaveProperty("strategy");
    expect(FULL_STRATEGY_TOOL_PROPERTIES).not.toHaveProperty("strategyDelta");
    expect(FULL_STRATEGY_TOOL_PROPERTIES).not.toHaveProperty("decisionLog");
  });
});

describe("compact strategy lifecycle", () => {
  it("normalizes null, missing, and whitespace deltas to no change", () => {
    const opening = createOpeningStrategyState();

    for (const candidate of [{}, { strategyDelta: null }, { strategyDelta: "  \n " }]) {
      const result = applyStrategyCandidate(opening, "ordinary_action", candidate);
      expect(result.status).toBe("no_change");
      expect(result.state).toEqual(opening);
      expect(result.resultingRevision).toBe(0);
    }
  });

  for (const scenario of STRATEGY_DELTA_QUALITY_SCENARIOS) {
    it(`applies the focused delta-quality scenario: ${scenario.label}`, () => {
      const active = applyStrategyCandidate(
        markStrategyReconciliationRequired(createOpeningStrategyState()),
        "post_eviction_diary",
        { strategy: scenario.baseline },
      ).state;
      const result = applyStrategyCandidate(active, "ordinary_action", scenario.candidate);

      expect(result.status).toBe(scenario.expectedStatus);
      if (scenario.expectedStatus === "accepted") {
        expect(result.state.deltas).toEqual([scenario.expectedDelta]);
        expect(result.resultingRevision).toBe(active.revision + 1);
      } else {
        expect(result.state).toEqual(active);
        expect(result.resultingRevision).toBe(active.revision);

        const mechanicallySubmittedRestatement = applyStrategyCandidate(
          active,
          "ordinary_action",
          { strategyDelta: scenario.temptingNonDelta },
        );
        expect(mechanicallySubmittedRestatement.status).toBe("accepted");
        expect(mechanicallySubmittedRestatement.state.deltas).toEqual([
          scenario.temptingNonDelta,
        ]);
      }
    });
  }

  it("accepts mechanically valid prose without judging its quality", () => {
    const result = applyStrategyCandidate(
      createOpeningStrategyState(),
      "ordinary_action",
      { strategyDelta: "Trust everyone and target everyone; this is contradictory." },
    );

    expect(result.status).toBe("accepted");
    expect(result.state).toMatchObject({
      lifecycle: "opening",
      baseline: null,
      deltas: ["Trust everyone and target everyone; this is contradictory."],
      revision: 1,
    });
  });

  it("accepts text exactly at each value bound and rejects text above it", () => {
    const exactDelta = applyStrategyCandidate(
      createOpeningStrategyState(),
      "ordinary_action",
      { strategyDelta: "d".repeat(COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters) },
    );
    expect(exactDelta.status).toBe("accepted");

    const oversizedDelta = applyStrategyCandidate(
      createOpeningStrategyState(),
      "ordinary_action",
      { strategyDelta: "d".repeat(COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters + 1) },
    );
    expect(oversizedDelta).toMatchObject({
      status: "rejected",
      reason: "value_too_long",
      resultingRevision: 0,
    });

    const reconciliation = markStrategyReconciliationRequired(createOpeningStrategyState());
    const exactStrategy = applyStrategyCandidate(
      reconciliation,
      "post_eviction_diary",
      { strategy: "s".repeat(COMPACT_STRATEGY_LIMITS.fullStrategyCharacters) },
    );
    expect(exactStrategy.status).toBe("accepted");

    const oversizedStrategy = applyStrategyCandidate(
      reconciliation,
      "post_eviction_diary",
      { strategy: "s".repeat(COMPACT_STRATEGY_LIMITS.fullStrategyCharacters + 1) },
    );
    expect(oversizedStrategy).toMatchObject({
      status: "rejected",
      reason: "value_too_long",
      state: { lifecycle: "repair_required" },
    });
  });

  it("enforces aggregate and ordered-delta bounds without changing rejected state", () => {
    let state = createOpeningStrategyState();
    for (let index = 0; index < COMPACT_STRATEGY_LIMITS.maximumDeltas; index += 1) {
      const result = applyStrategyCandidate(state, "ordinary_action", {
        strategyDelta: `delta-${index}`,
      });
      expect(result.status).toBe("accepted");
      state = result.state;
    }

    const overflow = applyStrategyCandidate(state, "ordinary_action", {
      strategyDelta: "one delta too many",
    });
    expect(overflow).toMatchObject({
      status: "rejected",
      reason: "delta_limit_reached",
      state,
      resultingRevision: state.revision,
    });

    let active = applyStrategyCandidate(
      markStrategyReconciliationRequired(createOpeningStrategyState()),
      "post_eviction_diary",
      { strategy: "b".repeat(COMPACT_STRATEGY_LIMITS.fullStrategyCharacters) },
    ).state;
    const deltasToAggregateLimit =
      (COMPACT_STRATEGY_LIMITS.aggregateCharacters - COMPACT_STRATEGY_LIMITS.fullStrategyCharacters)
      / COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters;
    expect(Number.isInteger(deltasToAggregateLimit)).toBe(true);
    for (let index = 0; index < deltasToAggregateLimit; index += 1) {
      const exactAggregateStep = applyStrategyCandidate(active, "ordinary_action", {
        strategyDelta: "x".repeat(COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters),
      });
      expect(exactAggregateStep.status).toBe("accepted");
      active = exactAggregateStep.state;
    }
    expect(active.baseline!.length + active.deltas.reduce((sum, delta) => sum + delta.length, 0))
      .toBe(COMPACT_STRATEGY_LIMITS.aggregateCharacters);

    const aggregateOverflow = applyStrategyCandidate(active, "ordinary_action", {
      strategyDelta: "x",
    });
    expect(aggregateOverflow).toMatchObject({
      status: "rejected",
      reason: "aggregate_too_long",
      state: active,
      resultingRevision: active.revision,
    });
  });

  it("appends accepted deltas in order in opening and active states", () => {
    const first = applyStrategyCandidate(createOpeningStrategyState(), "ordinary_action", {
      strategyDelta: "test Mira's vote commitment",
    });
    const second = applyStrategyCandidate(first.state, "diary_follow_up", {
      strategyDelta: "keep Vera as the alternate target",
    });
    expect(second.state).toMatchObject({
      lifecycle: "opening",
      deltas: ["test Mira's vote commitment", "keep Vera as the alternate target"],
      revision: 2,
    });

    const active = applyStrategyCandidate(
      markStrategyReconciliationRequired(second.state),
      "post_eviction_diary",
      { strategy: "Build a flexible coalition around Mira." },
    );
    const refined = applyStrategyCandidate(active.state, "ordinary_action", {
      strategyDelta: "Ask Mira for a concrete council commitment.",
    });
    expect(refined.state).toMatchObject({
      lifecycle: "active",
      baseline: "Build a flexible coalition around Mira.",
      deltas: ["Ask Mira for a concrete council commitment."],
      revision: active.state.revision + 1,
    });
  });

  it("replaces historical state with a valid post-eviction strategy", () => {
    const openingWithDelta = applyStrategyCandidate(
      createOpeningStrategyState(),
      "ordinary_action",
      { strategyDelta: "Start by testing Mira." },
    ).state;
    const reconciliation = markStrategyReconciliationRequired(openingWithDelta);

    expect(reconciliation).toMatchObject({
      lifecycle: "reconciliation_required",
      baseline: null,
      deltas: [],
      priorEpoch: {
        lifecycle: "opening",
        baseline: null,
        deltas: ["Start by testing Mira."],
        revision: 1,
      },
    });

    const replacement = applyStrategyCandidate(
      reconciliation,
      "post_eviction_diary",
      { strategy: "Rebuild with Vera while checking the new living board." },
    );
    expect(replacement).toMatchObject({
      status: "accepted",
      state: {
        lifecycle: "active",
        baseline: "Rebuild with Vera while checking the new living board.",
        deltas: [],
        priorEpoch: null,
      },
    });
  });

  it("moves an unusable first post-eviction update to repair-required", () => {
    const reconciliation = markStrategyReconciliationRequired(createOpeningStrategyState());
    const result = applyStrategyCandidate(reconciliation, "post_eviction_diary", {
      strategy: "   ",
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "required_value_missing",
      state: { lifecycle: "repair_required" },
    });
    expect(result.state.priorEpoch).toEqual(reconciliation.priorEpoch);
  });

  it("allows the next accepted action to repair a missing post-eviction baseline", () => {
    const reconciliation = markStrategyReconciliationRequired(createOpeningStrategyState());
    const repairRequired = applyStrategyCandidate(
      reconciliation,
      "post_eviction_diary",
      { strategy: null },
    ).state;
    const repaired = applyStrategyCandidate(repairRequired, "action_repair", {
      strategy: "Protect Mira for one round while testing Vera's new coalition.",
    });

    expect(repaired).toMatchObject({
      status: "accepted",
      operation: "replace",
      state: {
        lifecycle: "active",
        baseline: "Protect Mira for one round while testing Vera's new coalition.",
        deltas: [],
        priorEpoch: null,
      },
    });
  });

  it("rejects the field that is not allowed at a boundary", () => {
    const opening = createOpeningStrategyState();
    expect(applyStrategyCandidate(opening, "ordinary_action", {
      strategy: "A full strategy is not legal here.",
    })).toMatchObject({ status: "rejected", reason: "boundary_field_not_allowed" });

    const reconciliation = markStrategyReconciliationRequired(opening);
    expect(applyStrategyCandidate(reconciliation, "post_eviction_diary", {
      strategyDelta: "A delta is not legal here.",
    })).toMatchObject({
      status: "rejected",
      reason: "boundary_field_not_allowed",
      state: { lifecycle: "repair_required" },
    });
  });

  it("retains only the last valid epoch when another eviction precedes repair", () => {
    const active = applyStrategyCandidate(
      markStrategyReconciliationRequired(createOpeningStrategyState()),
      "post_eviction_diary",
      { strategy: "Work with Mira and pressure Vera." },
    ).state;
    const firstEviction = markStrategyReconciliationRequired(active);
    const failed = applyStrategyCandidate(firstEviction, "post_eviction_diary", {
      strategy: null,
    }).state;
    const secondEviction = markStrategyReconciliationRequired(failed);

    expect(secondEviction.lifecycle).toBe("reconciliation_required");
    expect(secondEviction.priorEpoch).toEqual(firstEviction.priorEpoch);
    expect(secondEviction.priorEpoch).toMatchObject({
      lifecycle: "active",
      baseline: "Work with Mira and pressure Vera.",
      deltas: [],
    });
  });
});
