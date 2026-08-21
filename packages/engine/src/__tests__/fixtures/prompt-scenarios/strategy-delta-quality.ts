import type { CompactStrategyCandidate } from "../../../game-runner.types";

export interface StrategyDeltaQualityScenario {
  readonly label: string;
  readonly baseline: string;
  readonly candidate: CompactStrategyCandidate;
  readonly temptingNonDelta?: string;
  readonly expectedStatus: "accepted" | "no_change";
  readonly expectedDelta?: string;
}

const BASELINE = "Keep Mira close, pressure Vera, and pivot only if the vote count breaks.";

/**
 * Human-labeled prompt scenarios for the strategy-delta contract. They test
 * what the model should submit; the engine still validates only shape/bounds.
 */
export const STRATEGY_DELTA_QUALITY_SCENARIOS = [
  {
    label: "material target pivot",
    baseline: BASELINE,
    candidate: {
      strategyDelta: "Move the primary target from Vera to Riven and warn Mira before the ballot.",
    },
    expectedStatus: "accepted",
    expectedDelta: "Move the primary target from Vera to Riven and warn Mira before the ballot.",
  },
  {
    label: "material commitment changes the contingency",
    baseline: BASELINE,
    candidate: {
      strategyDelta: "Honor Mira's Final 3 by protecting Vera this round; target Riven if the deal holds.",
    },
    expectedStatus: "accepted",
    expectedDelta: "Honor Mira's Final 3 by protecting Vera this round; target Riven if the deal holds.",
  },
  {
    label: "action summary is null rather than a delta",
    baseline: BASELINE,
    candidate: { strategyDelta: null },
    temptingNonDelta: "I voted for Mira because keeping her close remains my plan.",
    expectedStatus: "no_change",
  },
  {
    label: "unchanged target posture omits the delta",
    baseline: BASELINE,
    candidate: {},
    temptingNonDelta: "Keep Mira close, pressure Vera, and pivot if the vote count breaks.",
    expectedStatus: "no_change",
  },
] as const satisfies readonly StrategyDeltaQualityScenario[];
