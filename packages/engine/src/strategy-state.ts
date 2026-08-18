import type {
  CompactStrategyApplicationResult,
  CompactStrategyCandidate,
  CompactStrategyDecisionBoundary,
  CompactStrategyOperation,
  CompactStrategyPriorEpoch,
  CompactStrategyRejected,
  CompactStrategyRejectionReason,
  CompactStrategyState,
} from "./game-runner.types";

/** Character limits keep private strategy useful without recreating a packet. */
export const COMPACT_STRATEGY_LIMITS = Object.freeze({
  fullStrategyCharacters: 1_600,
  strategyDeltaCharacters: 800,
  maximumDeltas: 8,
  aggregateCharacters: 4_000,
});

const DELTA_BOUNDARIES = new Set<CompactStrategyDecisionBoundary>([
  "ordinary_action",
  "diary_follow_up",
]);

export function createOpeningStrategyState(): CompactStrategyState {
  return {
    lifecycle: "opening",
    baseline: null,
    deltas: [],
    priorEpoch: null,
    revision: 0,
  };
}

function clonePriorEpoch(
  epoch: CompactStrategyPriorEpoch | null,
): CompactStrategyPriorEpoch | null {
  return epoch
    ? { ...epoch, deltas: [...epoch.deltas] }
    : null;
}

export function cloneCompactStrategyState(
  state: CompactStrategyState,
): CompactStrategyState {
  return {
    ...state,
    deltas: [...state.deltas],
    priorEpoch: clonePriorEpoch(state.priorEpoch),
  };
}

export function compactStrategyAggregateCharacters(
  baseline: string | null,
  deltas: readonly string[],
): number {
  return (baseline?.length ?? 0) + deltas.reduce((sum, delta) => sum + delta.length, 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isBoundedStrategyText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && value.length <= maximum;
}

function isValidPriorEpoch(value: unknown): value is CompactStrategyPriorEpoch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const epoch = value as Record<string, unknown>;
  if (!hasExactKeys(epoch, ["baseline", "deltas", "lifecycle", "revision"])) return false;
  if (epoch.lifecycle !== "opening" && epoch.lifecycle !== "active") return false;
  if (!isNonNegativeInteger(epoch.revision)) return false;
  if (!Array.isArray(epoch.deltas) || epoch.deltas.length > COMPACT_STRATEGY_LIMITS.maximumDeltas) {
    return false;
  }
  if (!epoch.deltas.every((delta) =>
    isBoundedStrategyText(delta, COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters)
  )) {
    return false;
  }
  if (epoch.lifecycle === "opening" && epoch.baseline !== null) return false;
  if (epoch.lifecycle === "active"
    && !isBoundedStrategyText(epoch.baseline, COMPACT_STRATEGY_LIMITS.fullStrategyCharacters)) {
    return false;
  }
  return compactStrategyAggregateCharacters(
    epoch.baseline as string | null,
    epoch.deltas as string[],
  ) <= COMPACT_STRATEGY_LIMITS.aggregateCharacters;
}

/**
 * Mechanical fail-closed validation shared by continuity parsing and tests.
 * It validates structure and bounds only; strategy prose is never interpreted.
 */
export function isValidCompactStrategyState(value: unknown): value is CompactStrategyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (!hasExactKeys(state, ["baseline", "deltas", "lifecycle", "priorEpoch", "revision"])) {
    return false;
  }
  if (
    state.lifecycle !== "opening"
    && state.lifecycle !== "active"
    && state.lifecycle !== "reconciliation_required"
    && state.lifecycle !== "repair_required"
  ) {
    return false;
  }
  if (!isNonNegativeInteger(state.revision)) return false;
  if (!Array.isArray(state.deltas) || state.deltas.length > COMPACT_STRATEGY_LIMITS.maximumDeltas) {
    return false;
  }
  if (!state.deltas.every((delta) =>
    isBoundedStrategyText(delta, COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters)
  )) {
    return false;
  }

  if (state.lifecycle === "opening") {
    if (state.baseline !== null || state.priorEpoch !== null) return false;
  } else if (state.lifecycle === "active") {
    if (state.priorEpoch !== null) return false;
    if (!isBoundedStrategyText(state.baseline, COMPACT_STRATEGY_LIMITS.fullStrategyCharacters)) {
      return false;
    }
  } else {
    if (state.baseline !== null || state.deltas.length !== 0) return false;
    if (!isValidPriorEpoch(state.priorEpoch)) return false;
    if ((state.priorEpoch as CompactStrategyPriorEpoch).revision >= state.revision) return false;
  }

  return compactStrategyAggregateCharacters(
    state.baseline as string | null,
    state.deltas as string[],
  ) <= COMPACT_STRATEGY_LIMITS.aggregateCharacters;
}

/**
 * Canonical elimination invalidates the active epoch without rewriting its
 * prose. A second eviction retains the same last valid epoch rather than
 * stacking obsolete reconciliation states.
 */
export function markStrategyReconciliationRequired(
  state: CompactStrategyState,
): CompactStrategyState {
  const priorEpoch: CompactStrategyPriorEpoch | null =
    state.lifecycle === "opening" || state.lifecycle === "active"
      ? {
        lifecycle: state.lifecycle,
        baseline: state.baseline,
        deltas: [...state.deltas],
        revision: state.revision,
      }
      : clonePriorEpoch(state.priorEpoch);

  return {
    lifecycle: "reconciliation_required",
    baseline: null,
    deltas: [],
    priorEpoch,
    revision: state.revision + 1,
  };
}

function markRepairRequired(state: CompactStrategyState): CompactStrategyState {
  if (state.lifecycle === "repair_required") return cloneCompactStrategyState(state);
  if (state.lifecycle !== "reconciliation_required") return cloneCompactStrategyState(state);
  return {
    ...cloneCompactStrategyState(state),
    lifecycle: "repair_required",
    revision: state.revision + 1,
  };
}

function operationForBoundary(
  boundary: CompactStrategyDecisionBoundary,
): CompactStrategyOperation {
  return DELTA_BOUNDARIES.has(boundary) ? "delta" : "replace";
}

function hasOwn(candidate: CompactStrategyCandidate, key: "strategy" | "strategyDelta"): boolean {
  return Object.prototype.hasOwnProperty.call(candidate, key);
}

export function hasCompactStrategyCandidate(
  candidate: CompactStrategyCandidate,
): boolean {
  return hasOwn(candidate, "strategy") || hasOwn(candidate, "strategyDelta");
}

/**
 * Typed private outcome for a model strategy candidate whose associated
 * gameplay proposal was not accepted. This never mutates or advances state.
 */
export function discardUnacceptedStrategyCandidate(
  state: CompactStrategyState,
  candidate: CompactStrategyCandidate,
): CompactStrategyRejected | null {
  if (!hasCompactStrategyCandidate(candidate)) return null;
  const unchanged = cloneCompactStrategyState(state);
  const operation: CompactStrategyOperation = hasOwn(candidate, "strategy")
    ? "replace"
    : "delta";
  return {
    status: "rejected",
    operation,
    reason: "action_not_accepted",
    diagnostic: "gameplay action was not accepted; strategy candidate was discarded",
    state: unchanged,
    previousRevision: state.revision,
    resultingRevision: state.revision,
  };
}

function rejected(
  state: CompactStrategyState,
  boundary: CompactStrategyDecisionBoundary,
  operation: CompactStrategyOperation,
  reason: CompactStrategyRejectionReason,
  diagnostic: string,
): CompactStrategyRejected {
  const nextState = operation === "replace"
    && (state.lifecycle === "reconciliation_required" || state.lifecycle === "repair_required")
    ? markRepairRequired(state)
    : cloneCompactStrategyState(state);
  return {
    status: "rejected",
    operation,
    reason,
    diagnostic: `${boundary}: ${diagnostic}`,
    state: nextState,
    previousRevision: state.revision,
    resultingRevision: nextState.revision,
  };
}

/**
 * Mechanically validates and applies one boundary-specific strategy candidate.
 * Callers invoke this only after the associated action or diary answer has
 * passed its existing acceptance guard.
 */
export function applyStrategyCandidate(
  state: CompactStrategyState,
  boundary: CompactStrategyDecisionBoundary,
  candidate: CompactStrategyCandidate,
): CompactStrategyApplicationResult {
  const operation = operationForBoundary(boundary);
  const field = operation === "delta" ? "strategyDelta" : "strategy";
  const disallowedField = operation === "delta" ? "strategy" : "strategyDelta";

  if (hasOwn(candidate, disallowedField)) {
    return rejected(
      state,
      boundary,
      operation,
      "boundary_field_not_allowed",
      `${disallowedField} is not accepted at this boundary`,
    );
  }

  if (operation === "delta" && state.lifecycle !== "opening" && state.lifecycle !== "active") {
    return rejected(
      state,
      boundary,
      operation,
      "lifecycle_operation_not_allowed",
      `a delta cannot update ${state.lifecycle} state`,
    );
  }
  if (operation === "replace"
    && state.lifecycle !== "reconciliation_required"
    && state.lifecycle !== "repair_required") {
    return rejected(
      state,
      boundary,
      operation,
      "lifecycle_operation_not_allowed",
      `a replacement cannot update ${state.lifecycle} state`,
    );
  }

  const rawValue = candidate[field];
  if (rawValue == null || (typeof rawValue === "string" && rawValue.trim().length === 0)) {
    if (operation === "delta") {
      const unchanged = cloneCompactStrategyState(state);
      return {
        status: "no_change",
        operation,
        reason: "optional_value_absent",
        state: unchanged,
        previousRevision: state.revision,
        resultingRevision: state.revision,
      };
    }
    return rejected(
      state,
      boundary,
      operation,
      "required_value_missing",
      "a non-empty full strategy is required",
    );
  }

  if (typeof rawValue !== "string") {
    return rejected(
      state,
      boundary,
      operation,
      "value_not_string",
      `${field} must be a string`,
    );
  }

  const value = rawValue.trim();
  const valueLimit = operation === "delta"
    ? COMPACT_STRATEGY_LIMITS.strategyDeltaCharacters
    : COMPACT_STRATEGY_LIMITS.fullStrategyCharacters;
  if (value.length > valueLimit) {
    return rejected(
      state,
      boundary,
      operation,
      "value_too_long",
      `${field} has ${value.length} characters; maximum is ${valueLimit}`,
    );
  }

  if (operation === "delta") {
    if (state.deltas.length >= COMPACT_STRATEGY_LIMITS.maximumDeltas) {
      return rejected(
        state,
        boundary,
        operation,
        "delta_limit_reached",
        `the current epoch already has ${state.deltas.length} deltas`,
      );
    }
    const deltas = [...state.deltas, value];
    const aggregateCharacters = compactStrategyAggregateCharacters(state.baseline, deltas);
    if (aggregateCharacters > COMPACT_STRATEGY_LIMITS.aggregateCharacters) {
      return rejected(
        state,
        boundary,
        operation,
        "aggregate_too_long",
        `the resulting epoch has ${aggregateCharacters} characters; maximum is ${COMPACT_STRATEGY_LIMITS.aggregateCharacters}`,
      );
    }
    const nextState: CompactStrategyState = {
      ...cloneCompactStrategyState(state),
      deltas,
      revision: state.revision + 1,
    };
    return {
      status: "accepted",
      operation,
      value,
      state: nextState,
      previousRevision: state.revision,
      resultingRevision: nextState.revision,
    };
  }

  if (value.length > COMPACT_STRATEGY_LIMITS.aggregateCharacters) {
    return rejected(
      state,
      boundary,
      operation,
      "aggregate_too_long",
      `the resulting epoch has ${value.length} characters; maximum is ${COMPACT_STRATEGY_LIMITS.aggregateCharacters}`,
    );
  }
  const nextState: CompactStrategyState = {
    lifecycle: "active",
    baseline: value,
    deltas: [],
    priorEpoch: null,
    revision: state.revision + 1,
  };
  return {
    status: "accepted",
    operation,
    value,
    state: nextState,
    previousRevision: state.revision,
    resultingRevision: nextState.revision,
  };
}
