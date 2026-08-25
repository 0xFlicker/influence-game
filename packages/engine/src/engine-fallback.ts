import type {
  EngineFallbackProvenance,
  EngineFallbackReason,
  PhaseContext,
  StrategicDecisionMetadata,
} from "./game-runner.types";

function fallbackSeed(
  context: Pick<PhaseContext, "gameId" | "round" | "phase">,
  actorId: string,
  action: string,
): string {
  return `${context.gameId}:${context.round}:${context.phase}:${actorId}:${action}`;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function engineFallbackMetadata(
  context: Pick<PhaseContext, "gameId" | "round" | "phase">,
  actorId: string,
  action: string,
  reason: EngineFallbackReason,
): StrategicDecisionMetadata & { engineFallback: EngineFallbackProvenance } {
  return {
    strategyGameplayAccepted: false,
    engineFallback: {
      source: "engine",
      reason,
      seed: fallbackSeed(context, actorId, action),
    },
  };
}

export function deterministicEngineFallback<T>(
  legalValues: readonly T[],
  context: Pick<PhaseContext, "gameId" | "round" | "phase">,
  actorId: string,
  action: string,
): T {
  if (legalValues.length === 0) {
    throw new Error(`No legal values available for engine fallback ${action}`);
  }
  const index = stableHash(fallbackSeed(context, actorId, action)) % legalValues.length;
  return legalValues[index]!;
}
